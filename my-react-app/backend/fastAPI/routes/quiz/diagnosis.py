"""句子填空題的「詞素錯誤診斷」：學習者選了某個選項，判斷錯在詞綴（wrong_affix）、中綴位置
（wrong_position）還是詞根（wrong_root）。

**診斷依據是「出題當下」的情況，不是事後重算**：出題時，伺服器知道每個選項是怎麼來的（正確答案、
引擎用哪條規則造的干擾項、隨機補上的別的詞），把這些資訊放進一個 token 隨題目送出；作答時
前端把 token 與所選選項送回來，伺服器解開 token 後直接查表，不依賴之後詞庫有沒有變動。

token 用 Fernet（AES 加密 + HMAC 驗證）：前端既看不到內容（選項來源、規則 ID、出題策略、詞庫版本、
擁有者），也無法竄改或自行簽發。token 綁定出題時登入的使用者（uid）、題目 ID、族語與目標詞，
換人、換題目都驗證失敗。token 只能證明「這是伺服器為這位使用者出的這一題」，一次性使用（同一個
nonce 只能更新一次熟練度）由 rule_state_store 的 nonce 去重負責。

沒有 token（沒設定密鑰、token 過期或不合）時，只做「高信心的重算」：把所選詞形跟正確答案的詞根
重新用引擎造一遍比對，剛好吻合才分類，其餘一律回「無法分類」，信心標 medium，而且不更新熟練度、
不寫研究事件（因為無法確認那個選項真的是這一題出現過的）。

診斷的規則（順序重要）：
1. 所選選項不在這一題裡 → invalid_option；
2. 選了正解 → correct；
3. 選了引擎干擾項 → 依造法：換詞綴 = wrong_affix、中綴位置不同 = wrong_position；但如果正確答案
   自己的規則歸屬有歧義（同一個詞有不只一條規則能解釋），不硬分類，回 ambiguous；
4. 選了隨機補上的詞 → 兩個詞辭典標註的詞根沒有交集才算 wrong_root（選了別的詞根的詞）；有交集
   可能其實是詞綴錯誤，回 ambiguous。
重疊（R）不在診斷範圍內。
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets as _secrets
import time
from dataclasses import dataclass
from typing import Sequence

from cryptography.fernet import Fernet, InvalidToken

from config import rule_skill_model as R
from config import translation_lexicon as lexicon

from . import distractors as D

SECRET_ENV = "QUIZ_TOKEN_SECRET"
PREVIOUS_SECRET_ENV = "QUIZ_TOKEN_SECRET_PREVIOUS"      # 換密鑰期間，舊密鑰簽的 token 還能驗證
MIN_SECRET_LEN = 32
MIN_SECRET_DISTINCT_CHARS = 10
TOKEN_TTL_SECONDS = 2 * 60 * 60
CLOCK_SKEW_SECONDS = 300
TOKEN_VERSION = 2
MAX_OPTIONS = 8
MAX_TOKEN_LEN = 8192
MAX_WORD_LEN = 200

ROLE_TARGET = "target"
ROLE_ENGINE = "engine"
ROLE_RANDOM = "random"
_ROLES = (ROLE_TARGET, ROLE_ENGINE, ROLE_RANDOM)

ERR_AFFIX = "wrong_affix"
ERR_POSITION = "wrong_position"
ERR_ROOT = "wrong_root"

STATUS_CORRECT = "correct"
STATUS_CLASSIFIED = "classified"
STATUS_AMBIGUOUS = "ambiguous"
STATUS_UNCLASSIFIED = "unclassified"
STATUS_INVALID = "invalid_option"

POLICY_BASELINE = "baseline"


@dataclass(frozen=True)
class OptionInfo:
    word: str
    role: str
    kind: str | None = None          # 引擎干擾項的造法（distractors.KIND_*）
    rule_id: str | None = None       # 引擎干擾項用到的規則技能 ID
    shares_root: bool = False        # 隨機補上的詞，跟目標詞的辭典詞根有沒有交集


@dataclass(frozen=True)
class QuestionContext:
    question_id: str
    tribe: str
    target: str
    options: tuple[OptionInfo, ...]
    target_rule_id: str | None
    ambiguous: bool
    kit_version: str
    policy: str
    nonce: str
    expires_at: int
    uid: str = ""                    # 出題時登入的使用者；作答時必須是同一個人
    issued_at: int = 0

    @property
    def probe(self) -> bool:
        """這一題真的在測「目標詞的那條規則」：規則歸屬明確，而且選項裡至少有一個引擎干擾項。
        只有這種題目的答對／答錯才是這條規則的證據；全是隨機干擾項的題目，答對只代表認得那個詞。"""
        return (self.target_rule_id is not None and not self.ambiguous
                and any(o.role == ROLE_ENGINE for o in self.options))


@dataclass(frozen=True)
class Diagnosis:
    status: str
    error_type: str | None
    target_rule_id: str | None
    selected_rule_id: str | None
    confidence: str                  # "high"（token 驗證過）｜"medium"（重算）
    reason: str
    probe: bool = False
    kit_version: str = ""
    policy: str = POLICY_BASELINE
    nonce: str = ""
    expires_at: int = 0              # 這題 token 的到期時間；一次性消費（nonce）要保留到這個時間

    def as_dict(self) -> dict:
        return {"status": self.status, "errorType": self.error_type, "targetRule": self.target_rule_id,
                "selectedRule": self.selected_rule_id, "confidence": self.confidence, "reason": self.reason,
                "probe": self.probe, "kitVersion": self.kit_version, "policy": self.policy}


def rule_id_for(tribe: str, rule) -> str:
    return R.rule_id(tribe, rule.kind, rule.a, rule.b, rule.k)


# ---------------------------------------------------------------------------
# 出題時：建立題目的診斷資訊
# ---------------------------------------------------------------------------

def _norm(text: str) -> str:
    return lexicon.normalize_token(text or "")


def _roots_of(kit: D.TribeKit, norm: str) -> set[str]:
    return set(kit.roots_by_derived.get(norm, ())) | {norm}


def build_context(question_id: str, tribe: str, target: str, option_words: Sequence[str],
                  engine: Sequence[D.Distractor], kit: D.TribeKit, *, uid: str = "",
                  policy: str = POLICY_BASELINE, now: float | None = None) -> QuestionContext:
    """option_words 是這一題實際顯示的全部選項（含正解）；engine 是其中由引擎造的那幾個。"""
    now = time.time() if now is None else now
    target_norm = _norm(target)
    detail = D.recover_rule_detail(kit, target_norm)
    target_rule_id = rule_id_for(tribe, detail[1]) if detail else None
    ambiguous = bool(detail and detail[2])
    engine_by_word = {d.word: d for d in engine}
    target_roots = _roots_of(kit, target_norm)

    options: list[OptionInfo] = []
    for word in option_words:
        if word == target:
            options.append(OptionInfo(word, ROLE_TARGET))
        elif word in engine_by_word:
            d = engine_by_word[word]
            options.append(OptionInfo(word, ROLE_ENGINE, d.kind,
                                      rule_id_for(tribe, d.used_rule) if d.used_rule is not None else None))
        else:
            options.append(OptionInfo(word, ROLE_RANDOM, shares_root=bool(target_roots & _roots_of(kit, _norm(word)))))
    return QuestionContext(question_id, tribe, target, tuple(options), target_rule_id, ambiguous,
                           kit.version, policy, _secrets.token_hex(8), int(now) + TOKEN_TTL_SECONDS,
                           uid=uid, issued_at=int(now))


# ---------------------------------------------------------------------------
# token（Fernet：AES 加密 + HMAC 驗證）
# ---------------------------------------------------------------------------

def _usable(secret: str | None) -> bool:
    """密鑰至少 32 個字元、且不只是幾個字元的重複（'0000…' 之類）。正式環境請用隨機產生的長字串。"""
    return bool(secret) and len(secret) >= MIN_SECRET_LEN and len(set(secret)) >= MIN_SECRET_DISTINCT_CHARS


def signing_secret() -> str | None:
    secret = os.getenv(SECRET_ENV, "")
    return secret if _usable(secret) else None


def verification_secrets() -> list[str]:
    return [s for s in (os.getenv(SECRET_ENV, ""), os.getenv(PREVIOUS_SECRET_ENV, "")) if _usable(s)]


def _fernet(secret: str) -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(("quiz-token-v2|" + secret).encode("utf-8")).digest())
    return Fernet(key)


def _encrypt(data: dict, secret: str) -> str:
    return _fernet(secret).encrypt(json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).decode("ascii")


def encode_token(ctx: QuestionContext, secret: str | None = None) -> str | None:
    """沒有可用的密鑰就回傳 None（功能降級為沒有 token，不是出題失敗）。"""
    secret = secret if secret is not None else signing_secret()
    if not _usable(secret):
        return None
    return _encrypt({
        "v": TOKEN_VERSION, "q": ctx.question_id, "t": ctx.tribe, "w": ctx.target, "u": ctx.uid,
        "r": ctx.target_rule_id, "a": int(ctx.ambiguous),
        "o": [[o.word, o.role, o.kind, o.rule_id, int(o.shares_root)] for o in ctx.options],
        "k": ctx.kit_version, "p": ctx.policy, "n": ctx.nonce, "i": ctx.issued_at, "e": ctx.expires_at,
    }, secret)


def _is_str(value: object, limit: int = MAX_WORD_LEN) -> bool:
    return isinstance(value, str) and len(value) <= limit


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def decode_token(token: object, *, secrets: Sequence[str] | None = None, now: float | None = None) -> QuestionContext | None:
    """解密、驗證並還原；任何一步不合（密鑰不對、被竄改、過期、發行時間不合理、格式不對）都回傳
    None，不丟例外。"""
    if not isinstance(token, str) or not token or len(token) > MAX_TOKEN_LEN:
        return None
    keys = [k for k in (verification_secrets() if secrets is None else secrets) if _usable(k)]
    raw = None
    for key in keys:
        try:
            raw = _fernet(key).decrypt(token.encode("ascii"))
            break
        except (InvalidToken, UnicodeEncodeError):
            continue
    if raw is None:
        return None
    now = time.time() if now is None else now
    try:
        data = json.loads(raw.decode("utf-8"))
        if data["v"] != TOKEN_VERSION or not _is_int(data["e"]) or not _is_int(data["i"]):
            return None
        if now >= data["e"] or data["i"] > now + CLOCK_SKEW_SECONDS or not 0 < data["e"] - data["i"] <= TOKEN_TTL_SECONDS:
            return None
        raw_options = data["o"]
        if not isinstance(raw_options, list) or not 1 <= len(raw_options) <= MAX_OPTIONS:
            return None
        options = []
        for item in raw_options:
            word, role, kind, rid, shares = item
            if (not _is_str(word) or role not in _ROLES or not (kind is None or _is_str(kind, 40))
                    or not (rid is None or R.parse_rule_id(rid) is not None) or shares not in (0, 1)):
                return None
            options.append(OptionInfo(word, role, kind, rid, bool(shares)))
        rid = data["r"]
        if not (rid is None or R.parse_rule_id(rid) is not None) or data["a"] not in (0, 1):
            return None
        if not (_is_str(data["q"]) and _is_str(data["t"], 20) and _is_str(data["w"]) and _is_str(data["u"], 200)
                and _is_str(data["k"], 40) and _is_str(data["p"], 40) and _is_str(data["n"], 40)):
            return None
        if sum(1 for o in options if o.role == ROLE_TARGET) != 1:
            return None
        return QuestionContext(data["q"], data["t"], data["w"], tuple(options), rid, bool(data["a"]),
                               data["k"], data["p"], data["n"], data["e"], uid=data["u"], issued_at=data["i"])
    except (ValueError, KeyError, TypeError, UnicodeDecodeError):
        return None


def verify_for_answer(token: object, *, question_id: str, tribe: str, word_name: str, uid: str,
                      secrets: Sequence[str] | None = None, now: float | None = None) -> QuestionContext | None:
    """token 有效，而且確實是替「這位使用者」出的「這一題、這個族語、這個目標詞」。"""
    ctx = decode_token(token, secrets=secrets, now=now)
    if (ctx is None or not uid or ctx.uid != uid or ctx.question_id != question_id
            or ctx.tribe != tribe or ctx.target != word_name):
        return None
    return ctx


# ---------------------------------------------------------------------------
# 作答時：診斷
# ---------------------------------------------------------------------------

def diagnose_with_context(ctx: QuestionContext, selected: str) -> Diagnosis:
    common = dict(target_rule_id=ctx.target_rule_id, probe=ctx.probe, kit_version=ctx.kit_version,
                  policy=ctx.policy, nonce=ctx.nonce, expires_at=ctx.expires_at, confidence="high")
    chosen = next((o for o in ctx.options if o.word == selected), None)
    if chosen is None:
        return Diagnosis(STATUS_INVALID, None, selected_rule_id=None, reason="option_not_in_question", **common)
    if chosen.role == ROLE_TARGET:
        return Diagnosis(STATUS_CORRECT, None, selected_rule_id=ctx.target_rule_id, reason="selected_target", **common)
    if chosen.role == ROLE_ENGINE:
        error = {D.KIND_SWAP: ERR_AFFIX, D.KIND_SHIFT: ERR_POSITION}.get(chosen.kind or "")
        if error is None or chosen.rule_id is None:
            return Diagnosis(STATUS_UNCLASSIFIED, None, selected_rule_id=chosen.rule_id, reason="unknown_distractor_kind", **common)
        if ctx.ambiguous or ctx.target_rule_id is None:
            return Diagnosis(STATUS_AMBIGUOUS, None, selected_rule_id=chosen.rule_id, reason="target_rule_ambiguous", **common)
        return Diagnosis(STATUS_CLASSIFIED, error, selected_rule_id=chosen.rule_id, reason="engine_distractor", **common)
    if chosen.shares_root:
        return Diagnosis(STATUS_AMBIGUOUS, None, selected_rule_id=None, reason="random_shares_root", **common)
    return Diagnosis(STATUS_CLASSIFIED, ERR_ROOT, selected_rule_id=None, reason="random_distractor", **common)


def diagnose_by_recompute(kit: D.TribeKit | None, tribe: str, target: str, selected: str) -> Diagnosis:
    """沒有可信 token 時的備援：只在「所選詞形剛好就是引擎會為這個目標詞造的某個候選」時分類。
    不判 wrong_root（無法確認所選詞形是不是這題的隨機選項），也不更新熟練度。"""
    base = dict(confidence="medium", probe=False)
    if kit is None:
        return Diagnosis(STATUS_UNCLASSIFIED, None, None, None, reason="no_kit", **base)
    target_norm, selected_norm = _norm(target), _norm(selected)
    if not target_norm or not selected_norm:
        return Diagnosis(STATUS_UNCLASSIFIED, None, None, None, reason="empty_form", **base)
    detail = D.recover_rule_detail(kit, target_norm)
    if detail is None:
        return Diagnosis(STATUS_UNCLASSIFIED, None, None, None, reason="target_rule_unknown", kit_version=kit.version, **base)
    root, rule0, ambiguous = detail
    target_id = rule_id_for(tribe, rule0)
    common = dict(target_rule_id=target_id, kit_version=kit.version, **base)
    if selected_norm == target_norm:
        return Diagnosis(STATUS_CORRECT, None, selected_rule_id=target_id, reason="recomputed", **common)
    matches = {}
    for form, used in D._swap_candidates(kit, root, rule0) + D._shift_candidates(root, rule0):
        if form == selected_norm and form != target_norm:
            matches[used] = ERR_POSITION if (used.kind == "I" and used.a == rule0.a and used.k != rule0.k) else ERR_AFFIX
    if not matches:
        return Diagnosis(STATUS_UNCLASSIFIED, None, selected_rule_id=None, reason="no_matching_candidate", **common)
    if ambiguous or len(matches) > 1:
        return Diagnosis(STATUS_AMBIGUOUS, None, selected_rule_id=None, reason="ambiguous_rule", **common)
    (used, error), = matches.items()
    return Diagnosis(STATUS_CLASSIFIED, error, selected_rule_id=rule_id_for(tribe, used), reason="recomputed", **common)


def skill_observation(diagnosis: Diagnosis) -> tuple[str, bool] | None:
    """這次作答該不該更新哪條規則的熟練度：回傳 (規則 ID, 是否答對)，或 None（不更新）。
    只有 token 驗證過（high）、而且這一題真的在測那條規則（probe）才更新；選到別的詞根、歧義、
    無法分類的錯誤都只記錄事件，不扣熟練度（錯在詞根不代表不會這條詞綴）。"""
    if diagnosis.confidence != "high" or not diagnosis.probe or diagnosis.target_rule_id is None:
        return None
    if diagnosis.status == STATUS_CORRECT:
        return diagnosis.target_rule_id, True
    if diagnosis.status == STATUS_CLASSIFIED and diagnosis.error_type in (ERR_AFFIX, ERR_POSITION):
        return diagnosis.target_rule_id, False
    return None
