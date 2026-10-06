"""句子填空題依「規則熟練度」挑目標詞（適性選題，旗標 quiz_rule_adaptive_selection）。

做法：從難度排序（IRT 分數）的前 LOOKAHEAD 個未用過的候選字裡，找出「這個字測得到某條規則」的
（規則歸屬明確、而且引擎造得出干擾項），再依 config/rule_skill_model.choose_candidate 的規則挑一個——
熟練度估計低的規則較常被選中，並保留探索比例與同規則題數上限。

不改動共用的 _CandidatePicker 排序：沒挑到任何合適候選時（沒有規則資料、候選都測不到規則…）
呼叫端照舊用 picker.next()，行為跟旗標關閉時完全一樣。其他三種題型完全不受影響。
"""
from __future__ import annotations

import logging
import random

from config import rule_skill_model as R
from config import translation_lexicon as lexicon

from . import diagnosis as G
from . import distractors as D

logger = logging.getLogger(__name__)

LOOKAHEAD = 40
POLICY_FALLBACK = "adaptive-fallback"        # 旗標開著，但這一題沒挑到合適的規則，照原本排序出


def policy_name(mode: str) -> str:
    return f"adaptive-{mode}"


class RulePolicy:
    def __init__(self, kit: D.TribeKit, tribe: str, skills: dict, rng: random.Random | None = None,
                 lookahead: int = LOOKAHEAD):
        self.kit, self.tribe, self.skills = kit, tribe, skills
        self.rng = rng or random
        self.lookahead = lookahead
        self.rule_counts: dict[str, int] = {}
        self._rule_cache: dict[str, str | None] = {}

    def rule_of(self, name: str) -> str | None:
        """這個詞若用來出題，會測到哪條規則；測不到（沒有明確規則、造不出干擾項）回傳 None。"""
        if name not in self._rule_cache:
            rid = None
            try:
                norm = lexicon.normalize_token(name)
                detail = D.recover_rule_detail(self.kit, norm)
                # 預檢只問「造不造得出」，用獨立、固定的亂數；不能消耗選題用的 self.rng，
                # 否則每個候選有幾條可換的規則會悄悄影響選題的分布與重現性。
                if detail and not detail[2] and D.distractors_for(self.kit, name, 3, rng=random.Random(0)):
                    rid = G.rule_id_for(self.tribe, detail[1])
            except Exception:
                logger.exception("rule lookup failed for %r", name)
            self._rule_cache[name] = rid
        return self._rule_cache[name]

    def pick(self, picker):
        """回傳 (候選, 規則 ID, 政策名稱)；沒有合適的就回傳 None（呼叫端退回 picker.next()）。
        選中的候選會從 picker 取走（標記為已用）。"""
        candidates = picker.peek(self.lookahead)
        annotated = [{"rank": rank, "rule": self.rule_of(c["word"].name)} for rank, c in enumerate(candidates)]
        choice = R.choose_candidate(annotated, self.skills, self.rule_counts, self.rng)
        if choice is None:
            return None
        index, mode = choice
        picker.take(candidates[index])
        return candidates[index], annotated[index]["rule"], policy_name(mode)

    def commit(self, rule: str | None) -> None:
        """題目真的建出來了才計入這條規則的題數（沒有例句建不出題的候選不算）。"""
        if rule is not None:
            self.rule_counts[rule] = self.rule_counts.get(rule, 0) + 1
