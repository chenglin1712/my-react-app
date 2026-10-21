"""用真實 API 評測意圖路由的分類準確率（路線圖 #8 的驗收）。

啟用 AI_INTENT_ROUTING 之前先跑這個指令。分類錯誤有兩種代價不同：
- 一般答錯（例如把文化問題當成詞彙問題）：兩者都交給大模型，影響很小。
- 危險答錯：真正的問題被分到「閒聊／離題／不當」，學生會得到固定說明而不是答案。這個數字應該是 0。

  python manage.py check_intent_routing                  # 只檢查題組格式，不呼叫 API
  python manage.py check_intent_routing --live           # 逐題呼叫分類器（Haiku，每題約 US$0.0003）
  python manage.py check_intent_routing --live --min-accuracy 0.9

題組在 AIModel/route_eval.json，可以直接加題。這是小型煙霧測試，不是統計上可靠的評測：
題數少，只能抓出明顯的問題；正式啟用後以真實對話的抽樣檢查為準。
需要先設定 ANTHROPIC_API_KEY。
"""
import json
from collections import Counter
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from AIModel.router import INTENTS, NO_ROUTE, route_message
from config.llm import get_llm_client

EVAL_PATH = Path(__file__).resolve().parents[2] / "route_eval.json"
# 真正的問題被擋掉：不論信心高低，只要分類結果「可用」且屬於這三類就算危險答錯
_SKIPS_THE_BIG_MODEL = ("chitchat", "off_topic", "unsafe")


def load_cases() -> list[dict]:
    cases = json.loads(EVAL_PATH.read_text(encoding="utf-8"))
    for case in cases:
        if case.get("intent") not in INTENTS or not str(case.get("text", "")).strip():
            raise CommandError(f"題組格式錯誤：{case!r}")
    return cases


def _messages(case: dict) -> list:
    """context 是「學生：…\n助手：…」的簡單文字，轉成與正式流程相同的 messages 形狀。"""
    messages = []
    for line in (case.get("context") or "").splitlines():
        speaker, _, text = line.partition("：")
        messages.append({"role": "user" if speaker == "學生" else "assistant", "content": text})
    messages.append({"role": "user", "content": case["text"]})
    return messages


class Command(BaseCommand):
    help = "評測意圖路由的分類準確率（--live 才會呼叫付費 API）"

    def add_arguments(self, parser):
        parser.add_argument("--live", action="store_true", help="實際呼叫分類器（付費、每題很小）")
        parser.add_argument("--min-accuracy", type=float, default=0.9, help="低於這個準確率就以失敗結束（預設 0.9）")

    def handle(self, *args, live=False, min_accuracy=0.9, **options):
        cases = load_cases()
        counts = Counter(c["intent"] for c in cases)
        self.stdout.write(f"題組 {len(cases)} 題：" + "、".join(f"{k} {counts[k]}" for k in INTENTS if counts[k]))
        if not live:
            self.stdout.write("加上 --live 才會實際呼叫分類器。")
            return

        try:
            client = get_llm_client()
        except EnvironmentError as exc:
            raise CommandError(str(exc))

        correct = unusable = 0
        wrong, dangerous = [], []
        for case in cases:
            route = route_message(client, _messages(case), uid="")
            if route is NO_ROUTE or route.intent is None:
                unusable += 1
                wrong.append((case, "（呼叫失敗或輸出無效）", "-"))
                continue
            if route.intent == case["intent"]:
                correct += 1
                continue
            wrong.append((case, route.intent, route.confidence))
            takes_over = route.usable and route.intent in _SKIPS_THE_BIG_MODEL
            # 兩種危險答錯：真正的問題被固定說明／輕量模型取代；以及不當請求被當成閒聊交給輕量模型回答
            # （主模型自己的安全機制就不會參與）。不當請求被分到其他類別則仍由主模型處理，只算一般答錯。
            if takes_over and case["intent"] not in _SKIPS_THE_BIG_MODEL:
                dangerous.append((case, route.intent, route.confidence))
            elif takes_over and case["intent"] == "unsafe" and route.intent == "chitchat":
                dangerous.append((case, route.intent, route.confidence))

        accuracy = correct / len(cases)
        self.stdout.write(f"\n準確率 {accuracy:.1%}（{correct}/{len(cases)}），呼叫失敗 {unusable} 題")
        for case, got, confidence in wrong:
            self.stdout.write(f"  × 「{case['text']}」應為 {case['intent']}，得到 {got}（信心 {confidence}）")
        if dangerous:
            self.stdout.write(self.style.ERROR(f"\n危險答錯 {len(dangerous)} 題（真正的問題會被固定說明取代）："))
            for case, got, confidence in dangerous:
                self.stdout.write(self.style.ERROR(f"  ! 「{case['text']}」→ {got}（信心 {confidence}）"))
        else:
            self.stdout.write(self.style.SUCCESS("\n沒有危險答錯。"))

        if accuracy < min_accuracy or dangerous:
            raise CommandError(f"未達標：準確率 {accuracy:.1%}（門檻 {min_accuracy:.0%}），危險答錯 {len(dangerous)} 題。先不要啟用 AI_INTENT_ROUTING。")
        self.stdout.write(self.style.SUCCESS("達標。可以考慮設定 AI_INTENT_ROUTING=1。"))
