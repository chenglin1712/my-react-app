"""把初級（is_true_false）／中級（三選一圖片選擇題）題庫從即時代理第三方
政府合作單位 API（https://api.lokahsu.org.tw ）搬進資料庫，取代
crawler/views.py 對 get_quiz_data level=1/2 的即時代理做法。

背景（P2.5 規劃調查結論，詳見 structured-twirling-scone.md）：
1. 對方 start_exam 端點無論 level 傳 1 還是 2，一次都會回傳 part1～part4
   四個部分；本專案原本只各自截取 part1（初級／是非題）與 part2（中級／
   選擇題），一直沒有用到 part3／part4。
2. 對方伺服器端每次呼叫都是隨機抽樣（同一個 dialect_id 打兩次，題目、
   音檔、圖片完全不同），程式碼原本假設的「固定不隨機」並不成立——這代表
   沒有一次呼叫能代表對方完整題庫，必須重複呼叫、用音檔檔名當穩定的
   題目身分鍵（origin_key）去重取樣，逼近對方題庫的實際樣貌。
3. 音檔／圖片一律重新上傳到本專案自己的 Cloudinary（沿用前端既有的
   VITE_CLOUDINARY_CLOUD_NAME／VITE_CLOUDINARY_UPLOAD_PRESET 免簽章
   preset，用 Cloudinary 的「file=遠端網址」直傳功能，後端不需要另外
   安裝 cloudinary SDK 或設定 API secret），存成自己的副本——不能讓學生
   測驗長期依賴第三方網址，對方網站改版或下架就會讓已發布的題目全部
   顯示失敗。

用法：
    python manage.py migrate_quiz_level12_to_db
    python manage.py migrate_quiz_level12_to_db --tribes tayal,amis --max-calls 15

遷移進去的資料狀態一律是 pending_review（待審核），理由跟
migrate_quiz_bank_to_db 相同：需要族語老師審定過才能讓學生看到。

冪等：(tribe, origin_key) 是資料庫層級的 unique 約束，重複執行不會建立
重複列；已存在的 origin_key 在取樣階段就會被跳過，不會重複上傳到 Cloudinary。
"""
import os
import time

import requests
from django.core.management.base import BaseCommand, CommandError

from adminapi.models import QuizChoiceItem, QuizSourceConfig, QuizTrueFalseItem

MIGRATED_BY = "system:migration"

_EXTERNAL_TIMEOUT = 10
_EXTERNAL_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
    "Accept": "application/json",
}
_POLITE_DELAY_SECONDS = 0.5

# 連續幾次呼叫都沒有發現任何新題目，就視為已經取樣到對方題庫的極限，停止
# 該族語的取樣（而不是每個族語都硬打滿 max-calls 次，浪費對方資源）。
_STOP_AFTER_CONSECUTIVE_MISSES = 6


def _origin_key_from_url(url):
    """從音檔網址取出檔名（去掉副檔名）當穩定的題目身分鍵，
    例如 ".../3recognize/1_8.mp3" -> "1_8"。"""
    basename = url.rsplit("/", 1)[-1]
    return basename.rsplit(".", 1)[0][:100]


def _cloudinary_upload(remote_url, resource_type, folder, cloud_name, upload_preset, public_id=None):
    """把第三方網址的檔案透過免簽章 preset 重新上傳到本專案 Cloudinary，
    回傳新的 secure_url。resource_type 是 "image" 或 "video"（Cloudinary
    把音訊檔歸類在 video 資源類型底下）。Cloudinary 這端要先自己從
    remote_url 抓檔案再存進自己的空間，比一般 API 呼叫慢，偶發逾時重試一次
    再放棄（呼叫端已經有更外層的「跳過這一題」保護，這裡只處理最常見的
    單次逾時，不是要做到完全不失敗）。

    public_id 帶入以 origin_key 為基礎的固定值（呼叫端組出），不用
    Cloudinary 預設的隨機檔名——上傳成功但 DB 建立失敗、下次重跑會重新
    上傳同一題時，固定 public_id 讓新的上傳落在同一個位置（多數免簽章
    preset 預設允許覆蓋，即使某個 preset 設定成一定要唯一檔名，固定的
    命名規則至少讓孤兒資產能靠 public_id 規律搜尋/比對出來，不會完全找
    不到——比每次都是隨機檔名好稽核（獨立審查找到的問題）。"""
    last_exc = None
    for attempt in range(2):
        try:
            data = {"upload_preset": upload_preset, "file": remote_url, "folder": folder}
            if public_id:
                data["public_id"] = public_id
            resp = requests.post(
                f"https://api.cloudinary.com/v1_1/{cloud_name}/{resource_type}/upload",
                data=data,
                timeout=60,
            )
            resp.raise_for_status()
            return resp.json()["secure_url"]
        except requests.RequestException as exc:
            last_exc = exc
    raise last_exc


class Command(BaseCommand):
    help = "把初級/中級題庫從即時代理外部 API 遷移成本地資料庫（狀態為待審核）"

    def add_arguments(self, parser):
        parser.add_argument(
            "--tribes", type=str, default=None,
            help="只處理指定族語（逗號分隔，例如 tayal,amis），預設處理全部已設定外部題源的族語",
        )
        parser.add_argument(
            "--max-calls", type=int, default=25,
            help="每個族語最多呼叫外部 API 幾次（預設 25，實際會提早在連續無新題目時停止）",
        )

    def handle(self, *args, **options):
        cloud_name = os.getenv("VITE_CLOUDINARY_CLOUD_NAME")
        upload_preset = os.getenv("VITE_CLOUDINARY_UPLOAD_PRESET")
        if not cloud_name or not upload_preset:
            raise CommandError(
                "尚未設定 VITE_CLOUDINARY_CLOUD_NAME／VITE_CLOUDINARY_UPLOAD_PRESET，"
                "無法重新上傳音檔/圖片，請先在 .env 補上這兩個既有的 Cloudinary 設定值"
            )

        source_configs = QuizSourceConfig.objects.all()
        if options["tribes"]:
            wanted = {t.strip() for t in options["tribes"].split(",") if t.strip()}
            source_configs = source_configs.filter(tribe__in=wanted)
        if not source_configs.exists():
            raise CommandError("找不到符合條件的 QuizSourceConfig，請確認族語代稱或先執行外部題源設定")

        total_tf_created = total_choice_created = 0
        for source_config in source_configs:
            try:
                tf_created, choice_created = self._migrate_tribe(
                    source_config, options["max_calls"], cloud_name, upload_preset,
                )
            except Exception as exc:
                # 單一族語遇到未預期的錯誤（例如 Cloudinary 罕見逾時）不該讓
                # 其餘族語整批放棄——已寫入資料庫的題目不受影響（逐題交易），
                # 記下錯誤後繼續下一個族語，需要補的部分之後可以只用
                # --tribes 重跑那一個族語（origin_key 去重確保不會重複匯入）。
                self.stderr.write(self.style.ERROR(f"  {source_config.tribe}: 發生未預期錯誤，跳過剩餘取樣：{exc}"))
                continue
            total_tf_created += tf_created
            total_choice_created += choice_created

        self.stdout.write(self.style.SUCCESS(
            f"是非題（初級）：新增 {total_tf_created} 筆\n"
            f"選擇題（中級）：新增 {total_choice_created} 筆"
        ))

    def _migrate_tribe(self, source_config, max_calls, cloud_name, upload_preset):
        tribe = source_config.tribe
        known_tf_keys = set(QuizTrueFalseItem.objects.filter(tribe=tribe).values_list("origin_key", flat=True))
        known_choice_keys = set(QuizChoiceItem.objects.filter(tribe=tribe).values_list("origin_key", flat=True))

        tf_created = choice_created = 0
        consecutive_misses = 0

        for call_index in range(max_calls):
            if consecutive_misses >= _STOP_AFTER_CONSECUTIVE_MISSES:
                break

            data = self._fetch_once(source_config.dialect_id)
            if data is None:
                consecutive_misses += 1
                continue

            found_new = False

            part1 = data.get("part1", {})
            part1_answers = part1.get("answers", [])
            for question, answer in zip(part1.get("questions", []), part1_answers):
                origin_key = _origin_key_from_url(question.get("audio", ""))
                if not origin_key or origin_key in known_tf_keys:
                    continue
                try:
                    self._import_true_false_item(tribe, question, answer, origin_key, cloud_name, upload_preset)
                except requests.RequestException as exc:
                    # Cloudinary 偶發逾時／連線問題不該讓整個族語的取樣中斷——
                    # 這一題這次跳過，origin_key 沒有加進 known_tf_keys（也沒有
                    # 寫進資料庫），下次重跑同一族語會自然重試，不會被誤判成
                    # 「已存在」而永久漏掉。
                    self.stderr.write(self.style.WARNING(f"  {tribe}: 是非題 {origin_key} 上傳失敗，跳過：{exc}"))
                    continue
                known_tf_keys.add(origin_key)
                found_new = True
                tf_created += 1

            part2 = data.get("part2", {})
            part2_answers = part2.get("answers", [])
            for question, answer in zip(part2.get("questions", []), part2_answers):
                origin_key = _origin_key_from_url(question.get("audio", ""))
                if not origin_key or origin_key in known_choice_keys:
                    continue
                try:
                    self._import_choice_item(tribe, question, answer, origin_key, cloud_name, upload_preset)
                except requests.RequestException as exc:
                    self.stderr.write(self.style.WARNING(f"  {tribe}: 選擇題 {origin_key} 上傳失敗，跳過：{exc}"))
                    continue
                known_choice_keys.add(origin_key)
                found_new = True
                choice_created += 1

            consecutive_misses = 0 if found_new else consecutive_misses + 1
            time.sleep(_POLITE_DELAY_SECONDS)

        self.stdout.write(f"  {tribe}: 呼叫 {call_index + 1} 次，是非題新增 {tf_created} 筆、選擇題新增 {choice_created} 筆")
        return tf_created, choice_created

    def _fetch_once(self, dialect_id):
        url = f"https://api.lokahsu.org.tw/api/front_end/start_exam?dialect_id={dialect_id}&level=1"
        try:
            response = requests.get(url, headers=_EXTERNAL_HEADERS, timeout=_EXTERNAL_TIMEOUT)
            response.raise_for_status()
            return response.json().get("data")
        except (requests.RequestException, ValueError) as exc:
            self.stderr.write(self.style.WARNING(f"  外部 API 呼叫失敗（dialect_id={dialect_id}）：{exc}"))
            return None

    def _import_true_false_item(self, tribe, question, answer, origin_key, cloud_name, upload_preset):
        folder = f"quizbank/{tribe}/true_false"
        uploaded = []
        try:
            audio_url = _cloudinary_upload(
                question["audio"], "video", folder, cloud_name, upload_preset,
                public_id=f"{origin_key}-audio",
            )
            uploaded.append(audio_url)
            image_url = _cloudinary_upload(
                question["image"], "image", folder, cloud_name, upload_preset,
                public_id=f"{origin_key}-image",
            )
            uploaded.append(image_url)
        except requests.RequestException:
            # 這一題的媒體檔案上傳到一半失敗——前面已經成功上傳的檔案
            # （例如音檔成功、圖片失敗）不會被用到（這一題整題跳過，見
            # 呼叫端的例外處理），但已經真的存在 Cloudinary 上，成了孤兒
            # 資產。deterministic public_id 讓它至少能靠這裡印出來的網址
            # 規律搜尋到，不是完全無跡可循（獨立審查找到的問題）。
            if uploaded:
                self.stderr.write(self.style.WARNING(
                    f"  {tribe}: 是非題 {origin_key} 部分媒體已上傳但整題失敗，"
                    f"可能留下孤兒資產：{uploaded}"
                ))
            raise

        QuizTrueFalseItem.objects.create(
            tribe=tribe, origin_key=origin_key,
            question_ab=question.get("question_ab", ""), question_ch=question.get("question_ch", ""),
            audio_url=audio_url, image_url=image_url,
            # 官方介面的 O/X 答案就是 1/2（跟 TrueFalseQuestion 前端元件的
            # 按鈕值一致），直接照抄對方 answers 陣列裡對應這一題的值。
            answer=answer,
            status=QuizTrueFalseItem.STATUS_PENDING_REVIEW, created_by=MIGRATED_BY,
        )

    def _import_choice_item(self, tribe, question, answer, origin_key, cloud_name, upload_preset):
        folder = f"quizbank/{tribe}/choice"
        uploaded = []
        try:
            image_a = _cloudinary_upload(
                question["imageA"], "image", folder, cloud_name, upload_preset,
                public_id=f"{origin_key}-a",
            )
            uploaded.append(image_a)
            image_b = _cloudinary_upload(
                question["imageB"], "image", folder, cloud_name, upload_preset,
                public_id=f"{origin_key}-b",
            )
            uploaded.append(image_b)
            image_c = _cloudinary_upload(
                question["imageC"], "image", folder, cloud_name, upload_preset,
                public_id=f"{origin_key}-c",
            )
            uploaded.append(image_c)
        except requests.RequestException:
            if uploaded:
                self.stderr.write(self.style.WARNING(
                    f"  {tribe}: 選擇題 {origin_key} 部分媒體已上傳但整題失敗，"
                    f"可能留下孤兒資產：{uploaded}"
                ))
            raise

        QuizChoiceItem.objects.create(
            tribe=tribe, origin_key=origin_key,
            question_ab=question.get("question_ab", ""), question_ch=question.get("question_ch", ""),
            image_a_url=image_a, image_b_url=image_b, image_c_url=image_c,
            answer=answer,
            status=QuizChoiceItem.STATUS_PENDING_REVIEW, created_by=MIGRATED_BY,
        )
