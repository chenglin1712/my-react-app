"""詞素級學習者模型（M4）的純函式核心：規則技能 ID、簡化 BKT 熟練度估計、混淆計數、
輸入清洗。不碰 DB、不碰網路，FastAPI 出題／作答端點、Django 的模擬與評估指令共用同一份。

**這是「熟練度估計」，不是已驗證的認知診斷模型**：
- 參數（猜對率、失誤率…）是先驗，不是從資料校準出來的；選項外觀、詞彙熟悉度都會影響猜對率，
  固定 0.25 只是弱假設；
- 技能不是互相獨立的（詞根辨識、詞綴功能、位置會共同影響答案），這裡每題只更新「目標詞的那一條
  規則」一次；
- p 不是「真的掌握的機率」，n（觀察次數）太少時 p 幾乎只是先驗，所以 n < MIN_OBS_FOR_ESTIMATE 時
  呼叫端應該顯示「資料不足」，不要顯示數字。

資料由伺服器持有（Firestore users/{uid}/quizRuleState/{族語}，見 routes/quiz/rule_state_store.py），
一份文件三個欄位：
- skills：{規則 ID: {"p": 熟練度估計, "n": 觀察次數, "c": 答對次數, "v": 模型版本}}
- confusions：{"目標規則 ID>選到的規則 ID": 次數}，例如「你常把 pa- 當成 ma-」
- overall：{"n": 作答次數, "c": 答對次數}，這位學習者在這個族語所有「token 驗證過的句子填空題」的整體表現

**預測答對機率用的是「規則估計與整體表現的混合」，不是單獨的 BKT**：模擬顯示，只靠 BKT 的規則估計在
觀察次數少時校準很差（比直接用這個人的整體答對率還差）；所以規則觀察少的時候預測靠近整體表現，
觀察越多才越相信規則本身的估計（見 blended_prediction）。

資料讀自 Firestore 時一律「清洗」而不是拒絕：壞掉的項目直接丟棄、超過上限的截斷，不能因為毀損的資料
讓出題或作答失敗。
"""
from __future__ import annotations

import math
from urllib.parse import quote, unquote

MODEL_VERSION = "bkt-blend-1"

P_INIT = 0.35        # 沒有任何觀察時的先驗熟練度
P_LEARN = 0.08       # 每次練習後學會的機率
P_SLIP = 0.10        # 已經會卻答錯
P_GUESS = 0.25       # 還不會卻猜對（四選一的弱先驗）

BLEND_K = 6                     # 規則觀察次數 n 的可信度權重 = n / (n + BLEND_K)
OVERALL_PRIOR_N = 4             # 整體答對率的 Beta 先驗：相當於已看過 4 題、答對 2 題（先驗平均 0.5）
MIN_OBS_FOR_ESTIMATE = 5        # 觀察次數少於這個，不顯示熟練度數字
WEAK_THRESHOLD = 0.5            # 熟練度估計低於這個且資料足夠，才算「待加強」
MAX_RULE_SKILLS = 300
MAX_CONFUSIONS = 300
MAX_COUNT = 100_000
ID_VERSION = "v1"
RULE_KINDS = ("P", "S", "I", "C")      # 重疊（R）目前不支援診斷
_TRIBE_SLUGS = ("tayal", "amis", "bunun", "kavalan", "paiwan")
_MAX_AFFIX_LEN = 32
_MAX_POSITION = 16


# ---------------------------------------------------------------------------
# 規則技能 ID：版本｜族語｜種類｜詞綴 a｜詞綴 b｜位置 k
# ---------------------------------------------------------------------------

def _enc(text: str) -> str:
    # 欄位內容一律百分比編碼（連 "|" 與 ">" 都會被編掉），再把 "." 也編掉：Firestore 的欄位路徑
    # 會把 "." 當成巢狀分隔，鍵裡不放它最保險。
    return quote(text, safe="").replace(".", "%2E")


def rule_id(tribe: str, kind: str, a: str = "", b: str = "", k: int = 0) -> str:
    """規則技能的正規 ID。族語、種類、位置都放進去：不同族語的同一個詞綴、同一個中綴放在不同位置
    都是不同技能，只用 "pa-" 會互相碰撞。"""
    return f"{ID_VERSION}|{tribe}|{kind}|{_enc(a)}|{_enc(b)}|{int(k)}"


def parse_rule_id(value: object) -> tuple[str, str, str, str, int] | None:
    """解析並驗證規則 ID，回傳 (族語, 種類, a, b, k)；不是這個版本的正規寫法就回傳 None。"""
    if not isinstance(value, str) or len(value) > 200:
        return None
    parts = value.split("|")
    if len(parts) != 6 or parts[0] != ID_VERSION:
        return None
    _, tribe, kind, a_enc, b_enc, k_text = parts
    if tribe not in _TRIBE_SLUGS or kind not in RULE_KINDS or not k_text.isdigit():
        return None
    a, b, k = unquote(a_enc), unquote(b_enc), int(k_text)
    if not a or len(a) > _MAX_AFFIX_LEN or len(b) > _MAX_AFFIX_LEN or k > _MAX_POSITION:
        return None
    if (kind == "C") != bool(b):                 # 只有環綴有後半詞綴
        return None
    if (kind == "I") != (k > 0):                 # 只有中綴有位置
        return None
    if rule_id(tribe, kind, a, b, k) != value:   # 必須是唯一的正規寫法，不接受等價的別寫
        return None
    return tribe, kind, a, b, k


def rule_label(value: str) -> str:
    """給人看的標記，例如 "pa-"、"-in-"、"u-…-an"；解析失敗就回傳原字串。"""
    parsed = parse_rule_id(value)
    if parsed is None:
        return str(value)
    _, kind, a, b, k = parsed
    if kind == "P":
        return f"{a}-"
    if kind == "S":
        return f"-{a}"
    if kind == "I":
        return f"-{a}-（第 {k} 個字母後）"
    return f"{a}-…-{b}"


def tribe_of(value: str) -> str | None:
    parsed = parse_rule_id(value)
    return parsed[0] if parsed else None


# ---------------------------------------------------------------------------
# 簡化 BKT
# ---------------------------------------------------------------------------

def predict_correct(p: float) -> float:
    """在熟練度估計為 p 時，預期答對這類題的機率。"""
    return p * (1.0 - P_SLIP) + (1.0 - p) * P_GUESS


def bkt_update(p: float, correct: bool) -> float:
    """一次觀察後的新熟練度估計（先用答題結果更新後驗，再加上這次練習的學習機率）。"""
    if correct:
        num = p * (1.0 - P_SLIP)
        den = num + (1.0 - p) * P_GUESS
    else:
        num = p * P_SLIP
        den = num + (1.0 - p) * (1.0 - P_GUESS)
    posterior = num / den if den > 0 else p
    updated = posterior + (1.0 - posterior) * P_LEARN
    return min(max(updated, 0.0), 1.0)


def overall_rate(overall: dict | None) -> float:
    """這位學習者整體的答對率（Beta 平滑）；沒有資料就是 0.5。"""
    n = (overall or {}).get("n", 0)
    c = (overall or {}).get("c", 0)
    return (c + OVERALL_PRIOR_N / 2.0) / (n + OVERALL_PRIOR_N)


def blended_prediction(skills: dict, rid: str, overall: dict | None) -> float:
    """預測這位學習者答對「測這條規則的題目」的機率：規則估計與整體表現的加權平均。
    規則觀察次數 n 越多，越相信規則自己的估計（權重 n / (n + BLEND_K)）；沒觀察過就完全用整體表現。"""
    skill = skills.get(rid)
    n = skill["n"] if skill else 0
    weight = n / (n + BLEND_K)
    rule_part = predict_correct(skill["p"]) if skill else predict_correct(P_INIT)
    return weight * rule_part + (1.0 - weight) * overall_rate(overall)


def add_overall(overall: dict, correct: bool) -> None:
    """就地記一次整體作答（任何 token 驗證過的句子填空題，不論有沒有測到規則）。"""
    overall["n"] = min(int(overall.get("n", 0)) + 1, MAX_COUNT)
    overall["c"] = min(int(overall.get("c", 0)) + (1 if correct else 0), MAX_COUNT)


def sanitize_overall(raw: object) -> dict:
    if not isinstance(raw, dict):
        return {"n": 0, "c": 0}
    n, c = _int_in_range(raw.get("n"), 0, MAX_COUNT), _int_in_range(raw.get("c"), 0, MAX_COUNT)
    return {"n": n, "c": c} if n is not None and c is not None and c <= n else {"n": 0, "c": 0}


def smoothed_rate(skill: dict) -> float:
    """對照用基線：答對率的 Beta(1,1) 平滑，只靠 n、c，不假設任何學習模型。"""
    return (skill.get("c", 0) + 1.0) / (skill.get("n", 0) + 2.0)


def new_skill() -> dict:
    return {"p": P_INIT, "n": 0, "c": 0, "v": MODEL_VERSION}


def has_enough_data(skill: dict | None) -> bool:
    return bool(skill) and skill.get("n", 0) >= MIN_OBS_FOR_ESTIMATE


def estimate_of(skills: dict, rid: str) -> float:
    """目前對某條規則的熟練度估計；沒觀察過就是先驗。"""
    skill = skills.get(rid)
    return float(skill["p"]) if skill else P_INIT


def apply_observation(skills: dict, rid: str, correct: bool) -> tuple[float, float]:
    """對 skills（會被就地修改）加入一次觀察，回傳 (更新前 p, 更新後 p)。
    技能數超過上限時，先淘汰證據最少（n 最小）的技能。"""
    skill = skills.get(rid)
    if skill is None:
        _make_room(skills)
        skill = skills[rid] = new_skill()
    before = float(skill["p"])
    skill["p"] = bkt_update(before, correct)
    skill["n"] = min(int(skill["n"]) + 1, MAX_COUNT)
    skill["c"] = min(int(skill["c"]) + (1 if correct else 0), MAX_COUNT)
    skill["v"] = MODEL_VERSION
    return before, float(skill["p"])


def _make_room(skills: dict) -> None:
    while len(skills) >= MAX_RULE_SKILLS:
        weakest = min(skills, key=lambda key: (skills[key].get("n", 0), key))
        del skills[weakest]


def add_confusion(confusions: dict, target_id: str, selected_id: str) -> None:
    """記一次「該選目標規則、卻選了另一條」。超過上限時淘汰次數最少的。"""
    key = f"{target_id}>{selected_id}"
    if key not in confusions:
        while len(confusions) >= MAX_CONFUSIONS:
            lowest = min(confusions, key=lambda k: (confusions[k], k))
            del confusions[lowest]
        confusions[key] = 0
    confusions[key] = min(confusions[key] + 1, MAX_COUNT)


def split_confusion_key(key: str) -> tuple[str, str] | None:
    left, sep, right = key.partition(">")
    if not sep or parse_rule_id(left) is None or parse_rule_id(right) is None:
        return None
    return left, right


# ---------------------------------------------------------------------------
# 輸入清洗（壞資料丟棄、超量截斷，不拒絕整份模型）
# ---------------------------------------------------------------------------

def _int_in_range(value: object, low: int, high: int) -> int | None:
    # bool 是 int 的子類別，True 不能當成計數
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if isinstance(value, float) and (not math.isfinite(value) or value != int(value)):
        return None
    number = int(value)
    return number if low <= number <= high else None


def sanitize_rule_skills(raw: object) -> dict:
    if not isinstance(raw, dict):
        return {}
    out: dict = {}
    for key, value in raw.items():
        if len(out) >= MAX_RULE_SKILLS:
            break
        if parse_rule_id(key) is None or not isinstance(value, dict):
            continue
        p = value.get("p")
        if isinstance(p, bool) or not isinstance(p, (int, float)) or not math.isfinite(p) or not 0.0 <= p <= 1.0:
            continue
        n = _int_in_range(value.get("n"), 0, MAX_COUNT)
        c = _int_in_range(value.get("c"), 0, MAX_COUNT)
        if n is None or c is None or c > n:
            continue
        version = value.get("v")
        out[key] = {"p": float(p), "n": n, "c": c,
                    "v": version if isinstance(version, str) and len(version) <= 32 else MODEL_VERSION}
    return out


def sanitize_rule_confusions(raw: object) -> dict:
    if not isinstance(raw, dict):
        return {}
    out: dict = {}
    for key, value in raw.items():
        if len(out) >= MAX_CONFUSIONS:
            break
        if not isinstance(key, str) or len(key) > 420 or split_confusion_key(key) is None:
            continue
        count = _int_in_range(value, 1, MAX_COUNT)
        if count is not None:
            out[key] = count
    return out


# ---------------------------------------------------------------------------
# 依熟練度挑「該練的規則」出題（適性選題）
# ---------------------------------------------------------------------------

EXPLORATION_RATE = 0.25     # 這個比例的題目，優先挑「還沒有足夠資料」的規則，不然新規則永遠收不到資料
MAX_PER_RULE = 2            # 同一份測驗裡，同一條規則最多出幾題，避免連續狂練同一件事
RANK_DECAY = 0.15           # 候選字原本的難度排序名次越後面，被選中的權重越低（1 / (1 + 0.15 * 名次)）
NEED_FLOOR = 0.2            # 已經很熟的規則仍保留的最低權重，不會完全不出
MODE_EXPLORE = "explore"
MODE_EXPLOIT = "exploit"


def rank_weight(rank: int) -> float:
    return 1.0 / (1.0 + RANK_DECAY * rank)


def choose_candidate(candidates: list[dict], skills: dict, rule_counts: dict, rng,
                     exploration_rate: float = EXPLORATION_RATE) -> tuple[int, str] | None:
    """從候選清單挑下一題的目標詞，回傳 (在清單中的位置, "explore" | "exploit")，沒有合適的候選就回傳 None
    （呼叫端退回原本的難度排序）。

    candidates 每一項是 {"rank": 原本排序名次, "rule": 規則 ID 或 None}；rule 是 None（這個詞測不到
    任何規則）或該規則在這份測驗已經出滿 MAX_PER_RULE 題的，不參與。
    - 探索：以 exploration_rate 的機率，只在「觀察次數還不夠給出估計」的規則裡挑，權重只看原本名次；
    - 其餘（或沒有可探索的規則時）：權重 = 名次權重 × (NEED_FLOOR + 1 - 熟練度估計)，估計越低越常出。"""
    eligible = [(i, c) for i, c in enumerate(candidates)
                if c.get("rule") is not None and rule_counts.get(c["rule"], 0) < MAX_PER_RULE]
    if not eligible:
        return None
    if rng.random() < exploration_rate:
        unexplored = [(i, c) for i, c in eligible if skills.get(c["rule"], {}).get("n", 0) < MIN_OBS_FOR_ESTIMATE]
        if unexplored:
            return _weighted(unexplored, lambda c: rank_weight(c["rank"]), rng), MODE_EXPLORE
    return _weighted(eligible, lambda c: rank_weight(c["rank"]) * (NEED_FLOOR + 1.0 - estimate_of(skills, c["rule"])),
                     rng), MODE_EXPLOIT


def _weighted(items: list[tuple[int, dict]], weight, rng) -> int:
    chosen = rng.choices(items, weights=[weight(c) for _, c in items], k=1)[0]
    return chosen[0]


# ---------------------------------------------------------------------------
# 給結果頁用的摘要
# ---------------------------------------------------------------------------

def weakest_rules(skills: dict, limit: int = 3) -> list[dict]:
    """資料足夠、而且熟練度估計偏低的規則，由弱到強。資料不足的規則不列。"""
    rows = [{"rule": rid, "label": rule_label(rid), "p": s["p"], "n": s["n"], "c": s["c"]}
            for rid, s in skills.items() if has_enough_data(s) and s["p"] < WEAK_THRESHOLD]
    rows.sort(key=lambda r: (r["p"], -r["n"], r["rule"]))
    return rows[:limit]


def top_confusions(confusions: dict, limit: int = 3) -> list[dict]:
    rows = []
    for key, count in confusions.items():
        pair = split_confusion_key(key)
        if pair:
            rows.append({"target": pair[0], "selected": pair[1], "count": count,
                         "targetLabel": rule_label(pair[0]), "selectedLabel": rule_label(pair[1])})
    rows.sort(key=lambda r: (-r["count"], r["target"], r["selected"]))
    return rows[:limit]
