"""評估詞素學習的研究事件：規則熟練度 vs 單一能力值，誰更能預測下一題對錯（唯讀）。

用法：
    python manage.py evaluate_rule_skill_events [--tribe amis] [--json]

只讀 QuizSkillEvent（經學習者同意、假名化的事件，見 adminapi/models/quiz_research.py），不寫入任何資料。
解讀方式與限制見 adminapi/rule_skill_evaluation.py：這是預測準確度的比較，不是學習成效的證據。
"""
import json

from django.core.management.base import BaseCommand

from adminapi import rule_skill_evaluation as EV
from adminapi.models import QuizSkillEvent


class Command(BaseCommand):
    help = "比較規則熟練度與單一能力值預測下一題對錯的準確度（唯讀，含 cluster bootstrap 信賴區間）"

    def add_arguments(self, parser):
        parser.add_argument("--tribe", default=None, help="只看單一族語（slug）")
        parser.add_argument("--resamples", type=int, default=500, help="bootstrap 重抽樣次數（預設 500）")
        parser.add_argument("--seed", type=int, default=7)
        parser.add_argument("--json", action="store_true", help="輸出 JSON")

    def handle(self, *args, **opts):
        queryset = QuizSkillEvent.objects.filter(probe=True).order_by("pseudonym", "id")
        if opts["tribe"]:
            queryset = queryset.filter(tribe=opts["tribe"])
        events = [{"pseudonym": e.pseudonym, "order": e.id, "tribe": e.tribe, "target_rule_id": e.target_rule_id,
                   "correct": e.correct, "probe": e.probe, "pred_skill": e.pred_skill, "pred_ability": e.pred_ability}
                  for e in queryset.iterator()]
        report = EV.evaluate(events, resamples=opts["resamples"], seed=opts["seed"])
        self.stdout.write(json.dumps(report, ensure_ascii=False, indent=2) if opts["json"] else EV.format_report(report))
