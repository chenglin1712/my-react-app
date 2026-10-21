"""用真實的 Anthropic API 驗證「讀書計畫」的結構化輸出（路線圖 #10 的驗收）。

單元測試用模擬物件，證明不了 API 接不接受 output_config 的 effort 加 format 同時出現，
也證明不了真實輸出能通過伺服器端驗證。這個指令會實際呼叫 API（花一點點費用），
用目前環境變數設定的模型與 effort（LLM_MODEL／LLM_EFFORT_PLAN 等）跑 plan 流程。

  python manage.py verify_llm_plan            # 跑 1 次
  python manage.py verify_llm_plan --count 50  # 驗收條件：連續 50 次都能解析

每次呼叫都會寫進後台「AI 用量」頁（功能 plan）。需要先設定 ANTHROPIC_API_KEY。
"""
import datetime
import json

import anthropic
from django.core.management.base import BaseCommand, CommandError

from AIModel.schemas import PLAN_SCHEMA
from AIModel.services import TAIPEI, build_plan_prompt, validate_study_plan
from config.llm import LLMRefusalError, call_claude, extract_text, get_llm_client, get_settings

MAX_COUNT = 100
CONFIRM_ABOVE = 5  # 超過這個次數要加 --yes
_FATAL_API_ERRORS = (
    anthropic.AuthenticationError, anthropic.PermissionDeniedError,
    anthropic.BadRequestError, anthropic.NotFoundError,
)

PROMPTS = [
    "幫我排一個一週讀書計畫",
    "我想在兩週內準備族語認證，幫我規劃每天的複習",
    "幫我安排三天的詞彙練習，每天晚上八點",
]


class Command(BaseCommand):
    help = "用真實 API 驗證讀書計畫的結構化輸出（會產生少量費用）"

    def add_arguments(self, parser):
        parser.add_argument("--count", type=int, default=1, help=f"要呼叫幾次（1~{MAX_COUNT}，預設 1）")
        parser.add_argument("--yes", action="store_true", help=f"次數超過 {CONFIRM_ABOVE} 次時必須加上，表示知道會產生費用")

    def handle(self, *args, count, yes=False, **options):
        if not 1 <= count <= MAX_COUNT:
            raise CommandError(f"--count 必須在 1~{MAX_COUNT} 之間")
        if count > CONFIRM_ABOVE and not yes:
            raise CommandError(f"即將呼叫真實的付費 API {count} 次，確認後請加上 --yes")
        try:
            client = get_llm_client()
            settings = get_settings("plan")
        except (EnvironmentError, ValueError) as exc:
            raise CommandError(str(exc))

        self.stdout.write(self.style.WARNING(
            f"將呼叫真實的付費 API：模型={settings.model} effort={settings.effort} "
            f"max_tokens={settings.max_tokens}，共 {count} 次"
        ))

        today = datetime.datetime.now(TAIPEI).date()
        tomorrow = (today + datetime.timedelta(days=1)).isoformat()
        system = build_plan_prompt(
            "泰雅語", {"level": "beginner", "correct": 12, "incorrect": 5, "common_errors": ["lokah（答錯2次）"]},
            today, tomorrow,
        )

        passed = 0
        total_in = total_out = 0
        for i in range(count):
            text = PROMPTS[i % len(PROMPTS)]
            try:
                response = call_claude(
                    client, feature="plan", uid="", system=system,
                    messages=[{"role": "user", "content": text}], output_schema=PLAN_SCHEMA,
                )
                # 先記 token 再驗證內容：解析或驗證失敗的回應一樣會計費
                usage = getattr(response, "usage", None)
                tokens_in, tokens_out = getattr(usage, "input_tokens", 0), getattr(usage, "output_tokens", 0)
                total_in += tokens_in if isinstance(tokens_in, int) else 0
                total_out += tokens_out if isinstance(tokens_out, int) else 0
                if response.stop_reason == "max_tokens":
                    raise ValueError("輸出被 max_tokens 截斷")
                plan = validate_study_plan(json.loads(extract_text(response)), today)
            except LLMRefusalError:
                self.stdout.write(self.style.WARNING(f"[{i + 1}/{count}] 模型拒答：{text}"))
                continue
            except _FATAL_API_ERRORS as exc:
                # 金鑰錯、沒權限、參數不被接受：每次都會一樣，跑完全部只是白花錢
                raise CommandError(f"[{i + 1}/{count}] API 拒絕了請求，已中止：{type(exc).__name__}: {exc}")
            except Exception as exc:  # 其他失敗（解析、驗證、暫時性錯誤）逐次記錄，繼續下一次
                self.stdout.write(self.style.ERROR(f"[{i + 1}/{count}] 失敗：{type(exc).__name__}: {exc}"))
                continue
            passed += 1
            self.stdout.write(f"[{i + 1}/{count}] 通過：{plan['title']}（{len(plan['events'])} 個任務）")

        self.stdout.write(f"成功的呼叫共用了輸入 {total_in:,} / 輸出 {total_out:,} token（費用見後台「AI 用量」頁）")
        summary = f"{passed}/{count} 次通過"
        if passed == count:
            self.stdout.write(self.style.SUCCESS(summary))
        else:
            raise CommandError(summary)
