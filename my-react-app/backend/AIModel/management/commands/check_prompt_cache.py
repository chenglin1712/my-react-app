"""用真實 API 檢查「提示快取」有沒有生效（路線圖 #4 的驗收）。

單元測試只能證明固定段落不會變；快取有沒有真的命中，要看 API 回傳的 usage。
常見原因是固定前綴（工具定義加固定段落）短於該模型的最小可快取長度，這時加了 cache_control
也不會有任何錯誤，只是 cache_creation_input_tokens 一直是 0。

  python manage.py check_prompt_cache          # 只量前綴長度（呼叫 count_tokens，不產生對話費用）
  python manage.py check_prompt_cache --live   # 再實際連送三次請求：第二次要讀到快取，
                                               # 第三次把 tool_choice 改成 none（工具迴圈最後一輪），快取仍要能重用

--live 會呼叫三次付費的對話 API（輸出很短），並寫進後台「AI 用量」頁（功能 chat）。
需要先設定 ANTHROPIC_API_KEY。
"""
import datetime
import time

import anthropic
from django.core.management.base import BaseCommand, CommandError

from AIModel.services import TAIPEI, _chat_static_prompt, build_chat_system
from AIModel.tools import TOOLS
from config.llm import LLMRefusalError, LLMUnavailableError, call_claude, get_llm_client, get_settings

# 官方文件載明的最小可快取長度（token）。文件註明新模型的數字請以最新的提示快取文件為準，
# 所以這裡只是參考；真正的依據是 --live 的結果。
DOCUMENTED_MINIMUMS = (
    ("claude-sonnet-5-5", 512), ("claude-opus-5", 512), ("claude-fable-5", 512), ("claude-haiku-5-5", 512),
    ("claude-sonnet-5", 1024),
)
SLOW_RUN_SECONDS = 240          # 5 分鐘快取的有效時間是 300 秒；超過這個長度的測試結果不具判定力
_PROBE_MESSAGES = [{"role": "user", "content": "你好"}]
_OTHER_PROBE_MESSAGES = [{"role": "user", "content": "謝謝，再見"}]


def documented_minimum(model: str):
    # 較長的名稱先比（claude-sonnet-5-5 要在 claude-sonnet-5 之前）
    for prefix, minimum in sorted(DOCUMENTED_MINIMUMS, key=lambda item: -len(item[0])):
        if model.startswith(prefix):
            return minimum
    return None


class Command(BaseCommand):
    help = "檢查提示快取的固定前綴長度，並可選擇實際連送兩次請求確認 cache_read"

    def add_arguments(self, parser):
        parser.add_argument("--live", action="store_true", help="實際送兩次對話請求（付費、輸出很短）")

    def handle(self, *args, live=False, **options):
        try:
            client = get_llm_client()
            settings = get_settings("chat")
        except (EnvironmentError, ValueError) as exc:
            raise CommandError(str(exc))

        today = datetime.datetime.now(TAIPEI).date()
        system = build_chat_system("泰雅語", None, today, with_dictionary=True)

        # count_tokens 只能量整個請求，量不出「快取點以前」的精確長度。這裡用兩次差分近似：
        # 含工具與固定段落的請求，減去只有那句「你好」的請求，剩下的約等於可快取的固定前綴。
        try:
            with_prefix = client.messages.count_tokens(
                model=settings.model, system=[system[0]], tools=TOOLS, messages=_PROBE_MESSAGES,
            ).input_tokens
            message_only = client.messages.count_tokens(model=settings.model, messages=_PROBE_MESSAGES).input_tokens
        except anthropic.APIError as exc:
            raise CommandError(f"count_tokens 失敗（{type(exc).__name__}）：{exc}")
        prefix_tokens = max(with_prefix - message_only, 0)
        minimum = documented_minimum(settings.model)
        self.stdout.write(f"模型 {settings.model}：固定前綴（工具定義加固定段落）約 {prefix_tokens} token（差分估算，非精確值）")
        if minimum is None:
            self.stdout.write(self.style.WARNING("這個模型的最小可快取長度不在內建清單，請查官方提示快取文件，或直接用 --live 確認"))
        else:
            self.stdout.write(f"文件載明的最小可快取長度：{minimum} token（模型表會更新，僅供參考；最後以 --live 為準）")
            if prefix_tokens < minimum:
                self.stdout.write(self.style.WARNING(
                    "估算的固定前綴比最小可快取長度短，快取很可能不會生效（不會報錯）。"
                    "可改用最小長度較短的模型，或接受不快取；不建議為了快取硬把 prompt 灌長。"
                ))

        if not live:
            self.stdout.write("加上 --live 可實際連送三次請求確認 cache_read。")
            return

        self.stdout.write(self.style.WARNING("將呼叫三次真實的付費 API（輸出很短）"))
        # 第 3 次模擬工具迴圈的最後一輪（tool_choice 改成 none）：確認工具與固定段落的快取沒有因此失效
        # 第 3 次刻意換一句不同的使用者訊息：訊息層的快取必然不會命中，讀到的快取就只可能來自工具與固定段落。
        steps = (
            ("一般請求", _PROBE_MESSAGES, None),
            ("同樣的請求", _PROBE_MESSAGES, None),
            ("tool_choice 改成 none、換一句話", _OTHER_PROBE_MESSAGES, {"type": "none"}),
        )
        usages = []
        started_at = time.monotonic()
        for attempt, (label, messages, tool_choice) in enumerate(steps, start=1):
            try:
                response = call_claude(
                    client, feature="chat", uid="", system=system, messages=messages, tools=TOOLS,
                    tool_choice=tool_choice,
                )
            except (anthropic.APIError, LLMRefusalError, LLMUnavailableError) as exc:
                raise CommandError(f"第 {attempt} 次請求（{label}）失敗（{type(exc).__name__}）：{exc}")
            usage = response.usage
            created = getattr(usage, "cache_creation_input_tokens", 0) or 0
            read = getattr(usage, "cache_read_input_tokens", 0) or 0
            usages.append((created, read))
            self.stdout.write(
                f"[{attempt}/3] {label}：輸入 {usage.input_tokens} / 寫入快取 {created} / "
                f"讀取快取 {read} / 輸出 {usage.output_tokens}"
            )

        elapsed = time.monotonic() - started_at
        slow = elapsed > SLOW_RUN_SECONDS
        slow_note = (
            f"（三次請求共花了 {elapsed:.0f} 秒，接近或超過 5 分鐘快取時間，結果可能是假陰性，請重跑）" if slow else ""
        )
        (created1, _), (_, read2), (_, read3) = usages
        if read2 <= 0:
            if created1 > 0:
                raise CommandError(f"有寫入快取但第二次未觀察到讀取：檢查固定段落是否有隨請求變動的內容{slow_note}")
            raise CommandError(
                f"完全沒有寫入快取：固定前綴很可能低於該模型的最小可快取長度（見上方數字），或模型不支援{slow_note}"
            )
        self.stdout.write(self.style.SUCCESS("第二次請求讀到快取，提示快取有生效"))
        # 第三次換了使用者訊息，讀到的快取只可能是更早的前綴；至少要讀到第二次讀量的一半，才算與「整段保留」相符
        if read3 < read2 * 0.5:
            raise CommandError(
                f"tool_choice 改成 none 後只讀到 {read3} token（基準 {read2}）：未觀察到工具與固定段落被完整重用，"
                f"與文件說法不符，或這次結果受外部流量／間隔影響{slow_note}"
            )
        self.stdout.write(self.style.SUCCESS(
            f"tool_choice 改成 none、換一句話後仍讀到 {read3} token（基準 {read2}）：與「工具與固定段落的快取保留」相符"
            "（usage 只有總數，無法分別證明工具與 system 各自保留）"
        ))
