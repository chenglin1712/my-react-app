import { db, auth } from "../../../firebase";
import { deleteDoc, doc, getDoc, runTransaction, serverTimestamp } from "firebase/firestore";
import { normalizeCalendarEvent } from "../../utils/calendarEvents";
import { cleanTasks, mergeReplan, newTrackedPlan, withTaskDone } from "../../utils/studyPlan";

// 追蹤中的讀書計畫（路線圖 #26）：users/{uid}/studyPlans/current，每人只有一份，新的取代舊的。
// 規則見 firestore.rules。計畫與行事曆是兩份文件，套用重排時在同一個 transaction 裡改，不會一半一半。

export class ReplanConflictError extends Error {
    constructor(reason) {
        super(reason === "changed" ? "計畫在重排期間有變動" : "重排結果不完整");
        this.name = "ReplanConflictError";
        this.reason = reason;
    }
}

/** 已經有還沒做完的追蹤計畫，而呼叫端沒有確認要取代。 */
export class ExistingPlanError extends Error {
    constructor() {
        super("已有追蹤中的計畫");
        this.name = "ExistingPlanError";
    }
}

const planRef = (uid) => doc(db, "users", uid, "studyPlans", "current");

const requireUser = () => {
    const user = auth.currentUser;
    if (!user) throw new Error("請先登入");
    return user;
};

/** 讀目前追蹤中的計畫；沒有或沒有可用的任務回 null。 */
export async function getTrackedPlan() {
    const user = auth.currentUser;
    if (!user) return null;
    const snap = await getDoc(planRef(user.uid));
    if (!snap.exists()) return null;
    const data = snap.data();
    const tasks = cleanTasks(data?.tasks);
    return tasks.length === 0 ? null : { title: typeof data.title === "string" && data.title ? data.title : "讀書計畫", tasks };
}

/**
 * 開始追蹤一份助手排出的計畫（取代目前追蹤中的）。calendarIds：事件序號 → 行事曆事件 id。
 * 已有還沒做完的計畫且沒有 replace: true 時丟 ExistingPlanError（由畫面請使用者確認）。
 * 規則要求更新時 createdAt 不能變，所以已有文件時沿用它原本的 createdAt。
 */
export async function startTracking(plan, calendarIds = {}, { replace = false } = {}) {
    const user = requireUser();
    const tracked = newTrackedPlan(plan, calendarIds);
    if (tracked.tasks.length === 0) throw new Error("這份計畫沒有可追蹤的任務");
    const ref = planRef(user.uid);
    await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        // 是否要先確認，在 transaction 裡用最新的文件判斷：另一個分頁剛建立的計畫也擋得住
        if (!replace && snap.exists() && cleanTasks(snap.data().tasks).some((task) => !task.done)) throw new ExistingPlanError();
        const createdAt = snap.exists() ? snap.data().createdAt : serverTimestamp();
        tx.set(ref, { title: tracked.title, tasks: tracked.tasks, createdAt, updatedAt: serverTimestamp() });
    });
    return tracked;
}

/** 勾選或取消勾選一個任務；回傳更新後的完整任務清單（以資料庫裡最新的為準，不是畫面上舊的）。 */
export async function setTaskDone(taskId, done) {
    const user = requireUser();
    const ref = planRef(user.uid);
    return runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("找不到追蹤中的計畫");
        const tasks = withTaskDone(cleanTasks(snap.data().tasks), taskId, done);
        tx.update(ref, { tasks, updatedAt: serverTimestamp() });
        return tasks;
    });
}

export async function stopTracking() {
    const user = requireUser();
    await deleteDoc(planRef(user.uid));
}

/**
 * 套用後端回來的重排結果：只換掉 replaced_ids 的未完成任務（已完成的完全不動），並在同一個 transaction 裡
 * 處理行事曆：被取代的任務若加入過行事曆，舊事件刪掉、新的時間加進去並記下新的事件 id。
 * 重排期間任務狀態變了（例如在別的分頁勾掉）就丟 ReplanConflictError，什麼都不改。
 */
export async function applyReplan(result) {
    const user = requireUser();
    const ref = planRef(user.uid);
    const calendarRef = doc(db, "calendar", user.uid);
    return runTransaction(db, async (tx) => {
        const planSnap = await tx.get(ref);
        const calendarSnap = await tx.get(calendarRef);
        if (!planSnap.exists()) throw new ReplanConflictError("changed");
        const merge = mergeReplan(cleanTasks(planSnap.data().tasks), result);
        if (!merge.ok) throw new ReplanConflictError(merge.reason);

        let tasks = merge.tasks;
        if (merge.hadCalendarLink || merge.removedCalendarEventIds.length > 0) {
            const existing = calendarSnap.exists() ? (calendarSnap.data().events || []) : [];
            const removed = new Set(merge.removedCalendarEventIds);
            const fresh = new Set(merge.freshIds);
            const added = [];
            tasks = tasks.map((task) => {
                if (!fresh.has(task.id)) return task;
                const event = { ...normalizeCalendarEvent({ summary: task.summary, description: task.description, start: task.start, end: task.end }), id: crypto.randomUUID() };
                added.push(event);
                return { ...task, calendarEventId: event.id };
            });
            const events = [...existing.filter((event) => !removed.has(event.id)), ...added];
            if (calendarSnap.exists()) tx.update(calendarRef, { events });
            else tx.set(calendarRef, { events });
        }
        tx.update(ref, { tasks, updatedAt: serverTimestamp() });
        return tasks;
    });
}
