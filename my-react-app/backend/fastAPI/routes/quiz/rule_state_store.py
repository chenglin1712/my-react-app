"""每位學習者的規則熟練度狀態：由【伺服器】持有並以交易更新，不再由前端帶來帶去。

為什麼不放進前端的 quiz_model：整份 quiz_model 由前端讀出、帶到 API、再整份寫回 Firestore，
使用者能自己改數字、兩個分頁同時作答會互相覆蓋（lost update）、同一個 token 可以重送。
規則熟練度要拿來影響出題與做研究，這幾個問題都不能接受，所以：
- 存在 Firestore `users/{uid}/quizRuleState/{族語}`（每族語一份文件，技能數上限按族語計算；文件內容見
  config/rule_skill_model.py），
  Firestore 安全規則禁止前端寫入，只有 Admin SDK（這支後端）能寫；
- 更新在 Firestore 交易裡進行：讀取、檢查 nonce、套用觀察、寫回（revision 加一）是原子的；
- 每份文件記下已處理過的題目 nonce【以及它的 token 到期時間】，到期前同一題的 token 重送會被偵測並略過；
  到期後 token 本身就驗證不過，所以只清除已到期的 nonce，不用固定筆數的「最近 N 筆」（那樣只要塞滿 N 個
  別的 nonce 就能擠掉舊的、重放還沒到期的 token）；
- 讀取（出題時）不需要交易，讀到的是最近一次寫入的快照。

Firestore 沒設定（沒有服務帳戶金鑰，例如本機開發）時 get_store() 回傳 None，依賴熟練度狀態的功能
（更新、適性選題、摘要）一律視為關閉，診斷本身仍可使用。
"""
from __future__ import annotations

import copy
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Callable

from config import rule_skill_model as R

logger = logging.getLogger(__name__)

COLLECTION = "quizRuleState"
MAX_NONCES = 1000                 # 文件內未到期 nonce 的上限（正常使用遠低於此）；滿了就拒絕新的更新，絕不淘汰還有效的 nonce
NONCE_RETENTION_SECONDS = 2 * 60 * 60 + 300      # 呼叫端沒給到期時間時的預設保留期：token 有效期 + 5 分鐘
MAX_TRANSACTION_ATTEMPTS = 5      # 呼叫端另外有等待上限（deadline.py），多試幾次只佔背景執行緒，不會拖慢作答回應
_MAX_NONCE_LEN = 40


class StoreError(Exception):
    """狀態讀寫失敗（沒有可用的儲存、uid 不合法、Firestore 錯誤）。呼叫端一律當成功能關閉處理。"""


class StoreFull(StoreError):
    """這份文件裡未到期的 nonce 已達上限：為了不讓有效的 nonce 被擠掉（會讓還沒到期的 token 能重放），
    寧可拒絕這次更新。正常使用的人 2 小時內不可能答到這麼多題；等最早的 nonce 到期就會恢復。"""


@dataclass
class RuleState:
    skills: dict = field(default_factory=dict)
    confusions: dict = field(default_factory=dict)
    overall: dict = field(default_factory=lambda: {"n": 0, "c": 0})
    revision: int = 0
    nonces: dict = field(default_factory=dict)       # {nonce: token 到期時間（epoch 秒）}


def state_from_doc(data: object) -> RuleState:
    """從儲存的文件還原；任何欄位毀損都丟棄或歸零，不讓壞資料擋住出題。"""
    if not isinstance(data, dict):
        return RuleState()
    revision = data.get("revision")
    raw_nonces = data.get("nonces")
    pairs = [(n, e) for n, e in raw_nonces.items()
             if isinstance(n, str) and 0 < len(n) <= _MAX_NONCE_LEN and isinstance(e, int) and not isinstance(e, bool)] \
        if isinstance(raw_nonces, dict) else []
    nonces = dict(pairs)
    return RuleState(R.sanitize_rule_skills(data.get("skills")), R.sanitize_rule_confusions(data.get("confusions")),
                     R.sanitize_overall(data.get("overall")),
                     revision if isinstance(revision, int) and not isinstance(revision, bool) and revision >= 0 else 0,
                     nonces)


def state_to_doc(state: RuleState) -> dict:
    return {"skills": state.skills, "confusions": state.confusions, "overall": state.overall, "revision": state.revision,
            "nonces": state.nonces, "modelVersion": R.MODEL_VERSION}


def _apply_to_state(state: RuleState, nonce: str, mutate: Callable[[RuleState], object],
                    expires_at: int | None = None, now: float | None = None) -> tuple[bool, object]:
    """交易內共用的邏輯：清掉已到期的 nonce；未到期的重複 nonce 不套用；否則套用、記下 nonce 與它的到期時間、
    revision 加一。expires_at 是這題 token 的到期時間；沒給就保留 NONCE_RETENTION_SECONDS。"""
    if not nonce or len(nonce) > _MAX_NONCE_LEN:
        raise StoreError("invalid nonce")
    now = time.time() if now is None else now
    if expires_at is None:
        expires_at = int(now) + NONCE_RETENTION_SECONDS
    if not isinstance(expires_at, int) or isinstance(expires_at, bool):
        raise StoreError("invalid expiry")
    state.nonces = {n: e for n, e in state.nonces.items() if e > now}
    if nonce in state.nonces:
        return False, None
    if len(state.nonces) >= MAX_NONCES:
        raise StoreFull("too many unexpired nonces")
    result = mutate(state)
    state.nonces[nonce] = expires_at
    state.revision += 1
    return True, result


def _check_key(uid: str, tribe: str) -> None:
    if not uid or "/" in uid or len(uid) > 128 or tribe not in R._TRIBE_SLUGS:
        raise StoreError("invalid uid or tribe")


class MemoryStore:
    """測試與沒有 Firestore 時的行程內實作；行為與 FirestoreStore 相同（含 nonce 去重與原子更新）。"""

    def __init__(self):
        self._docs: dict[tuple[str, str], dict] = {}
        self._lock = threading.Lock()

    def load(self, uid: str, tribe: str) -> RuleState:
        _check_key(uid, tribe)
        with self._lock:
            return state_from_doc(copy.deepcopy(self._docs.get((uid, tribe))))

    def apply(self, uid: str, tribe: str, nonce: str, mutate: Callable[[RuleState], object],
              expires_at: int | None = None) -> tuple[bool, object]:
        _check_key(uid, tribe)
        with self._lock:
            state = state_from_doc(copy.deepcopy(self._docs.get((uid, tribe))))
            applied, result = _apply_to_state(state, nonce, mutate, expires_at)
            if applied:
                self._docs[(uid, tribe)] = copy.deepcopy(state_to_doc(state))
            return applied, result

    def delete(self, uid: str) -> None:
        with self._lock:
            for key in [k for k in self._docs if k[0] == uid]:
                del self._docs[key]


class FirestoreStore:
    def __init__(self, client=None):
        self._client = client

    def _db(self):
        if self._client is None:
            from firebase_admin import firestore
            self._client = firestore.client()
        return self._client

    def _ref(self, uid: str, tribe: str):
        return self._db().collection("users").document(uid).collection(COLLECTION).document(tribe)

    def load(self, uid: str, tribe: str) -> RuleState:
        _check_key(uid, tribe)
        try:
            snap = self._ref(uid, tribe).get()
            return state_from_doc(snap.to_dict() if snap.exists else None)
        except StoreError:
            raise
        except Exception as exc:
            raise StoreError(f"firestore read failed: {exc}") from exc

    def apply(self, uid: str, tribe: str, nonce: str, mutate: Callable[[RuleState], object],
              expires_at: int | None = None) -> tuple[bool, object]:
        _check_key(uid, tribe)
        try:
            from google.cloud import firestore as gc_firestore
            ref = self._ref(uid, tribe)

            @gc_firestore.transactional
            def run(transaction):
                snap = ref.get(transaction=transaction)
                state = state_from_doc(snap.to_dict() if snap.exists else None)
                applied, result = _apply_to_state(state, nonce, mutate, expires_at)
                if applied:
                    transaction.set(ref, state_to_doc(state))
                return applied, result

            # 最多嘗試 3 次（預設 5 次）：爭用時最壞等待約 6 秒；同一位使用者的作答是依序送出的，
            # 只有多分頁／多裝置同時作答才會爭用，失敗就當這次沒有更新（StoreError），不影響作答。
            return run(self._db().transaction(max_attempts=MAX_TRANSACTION_ATTEMPTS))
        except StoreError:
            raise
        except Exception as exc:
            raise StoreError(f"firestore transaction failed: {exc}") from exc


_override = None
_firestore_store: FirestoreStore | None = None
_lock = threading.Lock()


def set_store_for_tests(store) -> None:
    global _override
    _override = store


def get_store():
    """可用的儲存，或 None（沒有 Firestore 服務帳戶金鑰、初始化失敗）。"""
    global _firestore_store
    if _override is not None:
        return _override
    if _firestore_store is not None:
        return _firestore_store
    with _lock:
        if _firestore_store is None:
            try:
                from config.firebase_init import ensure_firebase_initialized
                ensure_firebase_initialized()
                _firestore_store = FirestoreStore()
            except Exception:
                logger.warning("rule state store unavailable (Firestore not configured)", exc_info=False)
                return None
    return _firestore_store


def summarize(state: RuleState) -> dict:
    """給結果頁用的摘要：待加強的規則（資料足夠才列）與常見混淆。"""
    return {
        "observedRules": len(state.skills),
        "answered": state.overall.get("n", 0),
        "weakest": R.weakest_rules(state.skills),
        "confusions": R.top_confusions(state.confusions),
        "minObservations": R.MIN_OBS_FOR_ESTIMATE,
        "modelVersion": R.MODEL_VERSION,
    }
