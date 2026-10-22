"""追蹤中的讀書計畫（路線圖 #26）：伺服器端讀取。

計畫存在 Firestore 的 users/{uid}/studyPlans/current（每人同時只追蹤一份，新的取代舊的），前端寫入
（開始追蹤、勾選完成、套用重排）。助手要「重排」或「參考完成狀況」時，由伺服器依已驗證的 uid 用 Admin SDK
自己讀，前端不傳任務內容：
  - 重排只會處理伺服器讀到的「未完成」任務，已完成的任務不經過模型、也不會被回傳的結果改動；
  - 讀不到或格式不合的任務一律丟掉，不嘗試修補。

誠實的限制：這份文件本人在 Firestore 規則下改得動（要能勾選完成），所以任務文字對「有心人改自己的資料」
並非完全可信；它們只影響他自己的重排，這裡把每段文字清成單行、限制長度與數量後才放進 prompt，並在 prompt
標示為資料。
"""
import datetime
import logging

from .learner_profile import _client, _one_line

logger = logging.getLogger(__name__)

MAX_TASKS = 14               # 與 services._MAX_PLAN_EVENTS 一致：一份計畫最多這麼多筆
_MAX_TITLE = 100
_MAX_SUMMARY = 100
_MAX_DESCRIPTION = 300
_MAX_ID = 64


class PlanNotFound(LookupError):
    """這位使用者目前沒有追蹤中的計畫，或計畫裡沒有任何合法的任務。"""


def _parse_time(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


def clean_plan(raw) -> dict:
    """純函式：把 Firestore 文件內容整理成 {title, tasks:[{id, summary, description, start, end, done}]}。
    不合法的任務丟掉；一個任務都沒有就丟 PlanNotFound。"""
    if not isinstance(raw, dict):
        raise PlanNotFound("沒有追蹤中的計畫")
    tasks, seen = [], set()
    for item in raw.get("tasks") if isinstance(raw.get("tasks"), list) else []:
        if len(tasks) == MAX_TASKS:
            break
        if not isinstance(item, dict):
            continue
        task_id = item.get("id")
        summary = _one_line(item.get("summary"), _MAX_SUMMARY) if isinstance(item.get("summary"), str) else ""
        start, end = _parse_time(item.get("start")), _parse_time(item.get("end"))
        if not isinstance(task_id, str) or not task_id or len(task_id) > _MAX_ID or task_id in seen:
            continue
        if not summary or start is None or end is None or end <= start:
            continue
        seen.add(task_id)
        description = item.get("description")
        tasks.append({
            "id": task_id,
            "summary": summary,
            "description": _one_line(description, _MAX_DESCRIPTION) if isinstance(description, str) else "",
            "start": item["start"].strip(),
            "end": item["end"].strip(),
            "done": item.get("done") is True,
        })
    if not tasks:
        raise PlanNotFound("計畫裡沒有任何合法的任務")
    title = raw.get("title")
    return {"title": _one_line(title, _MAX_TITLE) if isinstance(title, str) and title.strip() else "讀書計畫", "tasks": tasks}


def load_current_plan(uid: str) -> dict:
    """讀這位使用者目前追蹤中的計畫。沒有就丟 PlanNotFound；Firestore 本身的錯誤原樣往上丟，由呼叫端決定怎麼回應。"""
    if not uid:
        raise PlanNotFound("沒有追蹤中的計畫")
    snapshot = _client().collection("users").document(uid).collection("studyPlans").document("current").get()
    if not snapshot.exists:
        raise PlanNotFound("沒有追蹤中的計畫")
    return clean_plan(snapshot.to_dict())


def progress_line(plan: dict) -> str:
    """給「下一份計畫」參考的一行完成狀況，例如：上一份計畫「泰雅語一週」：已完成 3／7 個任務，未完成的有：…"""
    tasks = plan["tasks"]
    done = sum(1 for t in tasks if t["done"])
    line = f"上一份追蹤中的計畫「{plan['title']}」：已完成 {done}／{len(tasks)} 個任務"
    undone = [t["summary"] for t in tasks if not t["done"]][:5]
    return line + (f"，還沒完成的有：{'、'.join(undone)}" if undone else "")


def load_progress_line(uid: str) -> str:
    """讀不到、沒有計畫、Firestore 出錯都回空字串：少了這一行只是計畫沒有參考上次的完成狀況，不能讓排計畫壞掉。"""
    try:
        return progress_line(load_current_plan(uid))
    except PlanNotFound:
        return ""
    except Exception as exc:
        logger.warning("[AIModel] 讀取追蹤中的計畫失敗，排計畫時不參考完成狀況：%s: %s", type(exc).__name__, exc)
        return ""
