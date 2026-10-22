"""一鍵跑 AI 助手評測、產出分數報告並和基準比較（路線圖 #29）。

  python manage.py run_ai_eval                    # 只檢查題組格式、列出題數，不呼叫 API
  python manage.py run_ai_eval --live             # 實際跑（付費）：每題一次對話，加上評審
  python manage.py run_ai_eval --live --judge batch   # 評審用 Batch API（約 5 折，非即時，通常一小時內完成）
  python manage.py run_ai_eval --live --save-baseline # 把這次的分數存成基準（人工確認過品質後才存）

改 prompt、換模型、加功能之前先跑一次存基準，改完再跑：任一類別退步超過容許值，指令以失敗結束。
題組：AIModel/evals/cases.json（人工撰寫）＋ 從辭典抽樣的詞彙題（標準答案來自辭典，--dictionary-cases）。
回答模型沿用 LLM_MODEL／LLM_MODEL_CHAT；評審固定 Opus 5.5（LLM_MODEL_EVAL_JUDGE 可覆寫）。
評測的對話用量記在 uid=eval，後台「AI 用量」頁看得到；Batch 評審的費用不在那裡，請看 Anthropic Console。
需要先設定 ANTHROPIC_API_KEY（不要把金鑰貼進對話或提交進版本控制）。
"""
import datetime
from collections import Counter

from django.core.management.base import BaseCommand, CommandError

from AIModel.evals import report as report_module
from AIModel.evals.cases import CaseError, load_cases
from AIModel.evals.dictionary_cases import sample_dictionary_cases
from AIModel.evals.feedback_cases import load_feedback_cases
from AIModel.evals.judge import judge_batch, judge_sync
from AIModel.evals.runner import current_prompt_text, default_lookup, run_case
from AIModel.evals.scoring import CheckContext, score_rules
from AIModel.prompt_version import prompt_version
from config.llm import get_llm_client
from config.llm_settings import get_settings
from config.tribes import TRIBE_IDS


class Command(BaseCommand):
    help = "跑 AI 助手評測並和基準比較（--live 才會呼叫付費 API）"

    def add_arguments(self, parser):
        parser.add_argument("--live", action="store_true", help="實際呼叫模型（付費）")
        parser.add_argument("--label", default="", help="這次評測的名稱，例如 before-prompt-change")
        parser.add_argument("--tribe", default="tayal", choices=sorted(TRIBE_IDS))
        parser.add_argument("--dictionary-cases", type=int, default=10, help="從辭典抽幾個詞彙題（0＝不抽）")
        parser.add_argument("--include-feedback", action="store_true",
                            help="加入後台標成『加入評測題組』的使用者倒讚案例（類別 feedback）")
        parser.add_argument("--seed", type=int, default=1, help="辭典抽樣的亂數種子（同種子抽到同樣的詞）")
        parser.add_argument("--judge", choices=("batch", "sync", "none"), default="sync")
        parser.add_argument("--save-baseline", action="store_true", help="把這次的分數存成基準（baseline.json）")
        parser.add_argument("--rule-tolerance", type=float, default=report_module.DEFAULT_RULE_TOLERANCE)
        parser.add_argument("--judge-tolerance", type=float, default=report_module.DEFAULT_JUDGE_TOLERANCE)

    def handle(self, *args, live=False, label="", tribe="tayal", dictionary_cases=10, seed=1, judge="sync",
               save_baseline=False, include_feedback=False, rule_tolerance=report_module.DEFAULT_RULE_TOLERANCE,
               judge_tolerance=report_module.DEFAULT_JUDGE_TOLERANCE, **options):
        try:
            cases = load_cases()
        except CaseError as exc:
            raise CommandError(f"題組格式錯誤：{exc}")
        if include_feedback:
            cases = cases + load_feedback_cases()
        counts = Counter(c["category"] for c in cases)
        self.stdout.write(f"人工題組 {len(cases)} 題：" + "、".join(f"{k} {v}" for k, v in sorted(counts.items())))
        if not live:
            self.stdout.write(f"另外會從辭典抽 {dictionary_cases} 題詞彙題。加上 --live 才會實際跑（付費）。")
            return

        if dictionary_cases:
            try:
                sampled = sample_dictionary_cases(TRIBE_IDS[tribe], dictionary_cases, seed)
            except Exception as exc:  # noqa: BLE001
                raise CommandError(f"讀不到辭典，無法抽詞彙題（可用 --dictionary-cases 0 略過）：{type(exc).__name__}")
            self.stdout.write(f"從辭典抽到 {len(sampled)} 題詞彙題（seed={seed}）")
            cases = cases + sampled

        try:
            client = get_llm_client()
        except EnvironmentError as exc:
            raise CommandError(str(exc))                       # 沒設定 ANTHROPIC_API_KEY：說明原因，不丟一長串例外
        lookup = default_lookup(tribe)
        prompt_text = current_prompt_text()
        rows, jobs = [], {}
        for case in cases:
            self.stdout.write(f"  跑 {case['id']} …")
            obs = run_case(client, case, tribe=tribe, lookup=lookup)
            rules = score_rules(obs, case.get("checks", []), CheckContext(prompt_text=prompt_text, gold=case.get("gold")))
            rows.append({
                "id": case["id"], "category": case["category"], "message": case["message"], "reply": obs.message,
                "rules": rules, "judge": None, "judged": False, "gold": case.get("gold"),
                "tool_calls": obs.tool_calls, "error": obs.error,
            })
            if judge != "none" and case.get("judge") and not obs.error:
                rows[-1]["judged"] = True
                jobs[case["id"]] = (case, obs.message)

        judge_error = ""
        if jobs:
            self.stdout.write(f"評審 {len(jobs)} 題（{judge}）…")
            try:
                judgements = (judge_batch if judge == "batch" else judge_sync)(client, jobs)
            except Exception as exc:  # noqa: BLE001 - 評審失敗不能讓前面花錢跑出的對話結果全部消失
                judgements, judge_error = {}, f"{type(exc).__name__}: {str(exc)[:200]}"
                self.stderr.write(f"評審失敗，仍會存下規則判分的結果：{judge_error}")
            for row in rows:
                if row["id"] in judgements:
                    row["judge"] = judgements[row["id"]]

        meta = {
            "chat_model": get_settings("chat").model,
            "judge_model": get_settings("eval_judge").model,
            "prompt_version": prompt_version(),
            "tribe": tribe,
            "dictionary_cases": len(sampled) if dictionary_cases else 0,
            "dictionary_seed": seed,
            "judge_mode": judge,
            "judge_error": judge_error,
            "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }
        label = label or f"eval-{datetime.datetime.now():%Y%m%d-%H%M%S}"
        result = report_module.build_report(label=label, rows=rows, meta=meta)
        path = report_module.RESULTS_DIR / f"{label}.json"
        report_module.save_json(path, result)
        self._print(result, path)

        if save_baseline:
            report_module.save_json(
                report_module.BASELINE_PATH, {"label": label, "meta": meta, "summary": result["summary"]})
            self.stdout.write(self.style.SUCCESS(f"已存成基準：{report_module.BASELINE_PATH}"))
            return

        baseline = report_module.load_baseline()
        if baseline is None:
            self.stdout.write("還沒有基準可比較；確認品質後用 --save-baseline 存一份。")
            return
        for note in report_module.describe_change(result, baseline):
            self.stdout.write(f"和基準不同：{note}")
        problems = report_module.compare(result, baseline, rule_tolerance=rule_tolerance, judge_tolerance=judge_tolerance)
        if problems:
            raise CommandError("和基準相比有退步：\n  " + "\n  ".join(problems))
        self.stdout.write(self.style.SUCCESS("沒有退步（相對於基準）。"))

    def _print(self, result: dict, path) -> None:
        summary = result["summary"]
        self.stdout.write("\n類別            題數  規則通過  評審平均")
        for category, s in summary["categories"].items():
            judge_mean = f"{s['judge_mean']:.2f}" if s["judge_mean"] is not None else "-"
            self.stdout.write(f"{category:<16}{s['n']:>4}  {s['rule_pass_rate']:>7.0%}  {judge_mean:>8}")
        overall = summary["overall"]
        judge_mean = f"{overall['judge_mean']:.2f}" if overall["judge_mean"] is not None else "-"
        self.stdout.write(f"{'整體':<14}{overall['n']:>4}  {overall['rule_pass_rate']:>7.0%}  {judge_mean:>8}")
        self.stdout.write(f"\n完整報告：{path}")
        if result["human_review"]:
            ids = "、".join(r["id"] for r in result["human_review"])
            self.stdout.write(f"請人工核對評審（報告的 human_review）：{ids}")
