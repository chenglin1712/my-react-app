"""用模擬學習者檢驗詞素熟練度模型的評估流程（不碰資料庫）。

用法：
    python manage.py simulate_rule_skill_learners [--scenario baseline ...] [--learners 60] [--seed 7]

這份報告只能說明：模型在「真實機制跟它不一樣」的模擬世界裡的表現與敏感度，以及評估流程本身沒有洩漏答案
（負對照 one_skill_control 不該讓規則熟練度模型贏過單一能力值）。它【不是】對真人有效的證據。
詳細說明見 adminapi/rule_skill_simulation.py。
"""
from django.core.management.base import BaseCommand, CommandError

from adminapi import rule_skill_simulation as SIM


class Command(BaseCommand):
    help = "模擬學習者，比較規則熟練度與單一能力值的預測（含負對照與敏感度分析）"

    def add_arguments(self, parser):
        parser.add_argument("--scenario", action="append", choices=sorted(SIM.SCENARIOS), help="只跑指定情境（可重複）")
        parser.add_argument("--learners", type=int, default=None)
        parser.add_argument("--seed", type=int, default=None)
        parser.add_argument("--resamples", type=int, default=200)

    def handle(self, *args, **opts):
        names = opts["scenario"] or list(SIM.SCENARIOS)
        for name in names:
            scenario = SIM.SCENARIOS.get(name)
            if scenario is None:
                raise CommandError(f"沒有這個情境：{name}")
            overrides = {k: v for k, v in (("learners", opts["learners"]), ("seed", opts["seed"])) if v is not None}
            self.stdout.write(SIM.format_scenario(SIM.evaluate_scenario(SIM.with_overrides(scenario, **overrides),
                                                                        resamples=opts["resamples"])))
            self.stdout.write("")
        self.stdout.write("注意：模擬只能檢驗評估流程與模型敏感度，不是對真人有效的證據。")
