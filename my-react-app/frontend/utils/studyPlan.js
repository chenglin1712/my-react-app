/**
 * 追蹤中的讀書計畫（路線圖 #26）的純邏輯。資料形狀與 Firestore 規則、後端 clean_plan 一致：
 *   users/{uid}/studyPlans/current = { title, tasks: [{ id, summary, description, start, end, done, calendarEventId? }], createdAt, updatedAt }
 * 這裡不碰 Firestore（見 src/userServives/studyPlanService.js），方便單獨測試。
 */

export const MAX_TASKS = 14;                       // 與規則、後端上限一致

const text = (value, limit) => (typeof value === "string" ? value.trim().slice(0, limit) : "");

/** 助手排出的計畫卡片 → 追蹤用的計畫。calendarIds 是「事件序號 → 行事曆事件 id」，已加入行事曆的任務才有。 */
export function newTrackedPlan(plan, calendarIds = {}) {
    const events = Array.isArray(plan?.events) ? plan.events.slice(0, MAX_TASKS) : [];
    const tasks = events.map((event, index) => ({
        id: crypto.randomUUID(),
        summary: text(event?.summary, 100),
        description: text(event?.description, 300),
        start: text(event?.start, 40),
        end: text(event?.end, 40),
        done: false,
        ...(typeof calendarIds[index] === "string" ? { calendarEventId: calendarIds[index] } : {}),
    })).filter((task) => task.summary && task.start && task.end);
    return { title: text(plan?.title, 100) || "讀書計畫", tasks };
}

/** 讀回來的資料整理成畫面用的任務清單：壞掉的項目丟掉（文件是本人可寫的，不信任形狀）。 */
export function cleanTasks(raw) {
    const seen = new Set();
    const tasks = [];
    for (const item of Array.isArray(raw) ? raw : []) {
        if (tasks.length === MAX_TASKS) break;
        if (!item || typeof item.id !== "string" || !item.id || seen.has(item.id)) continue;
        const summary = text(item.summary, 100);
        if (!summary || typeof item.start !== "string" || typeof item.end !== "string") continue;
        seen.add(item.id);
        tasks.push({
            id: item.id,
            summary,
            description: text(item.description, 300),
            start: item.start,
            end: item.end,
            done: item.done === true,
            ...(typeof item.calendarEventId === "string" ? { calendarEventId: item.calendarEventId } : {}),
        });
    }
    return tasks;
}

export function progressOf(tasks) {
    const total = tasks.length;
    const done = tasks.filter((task) => task.done).length;
    return { done, total, undone: total - done, ratio: total === 0 ? 0 : done / total };
}

export function withTaskDone(tasks, taskId, done) {
    return tasks.map((task) => (task.id === taskId ? { ...task, done } : task));
}

const byStart = (a, b) => new Date(a.start) - new Date(b.start) || a.id.localeCompare(b.id);

/**
 * 把後端回來的重排結果套到目前的計畫（路線圖 #26 的驗收：重排不會動到已完成的任務）。
 * result：{ events, replaced_ids }（後端 run_study_plan_replan）。
 * 只有「replaced_ids 裡的任務此刻都還在、而且都還沒完成」才套用；有任何一個已經完成或不見了（例如重排期間
 * 在別的分頁勾掉了），整個不套用，回 { ok: false, reason: "changed" }，由呼叫端請使用者再試一次。
 * 成功回 { ok: true, tasks, removedCalendarEventIds, hadCalendarLink }：
 *   removedCalendarEventIds：被取代的任務在行事曆裡的事件 id（要一併刪掉）；
 *   hadCalendarLink：被取代的任務有沒有加入過行事曆（有的話，新的時間也要加進行事曆）。
 */
export function mergeReplan(tasks, result) {
    const replacedIds = Array.isArray(result?.replaced_ids) ? result.replaced_ids : [];
    const events = Array.isArray(result?.events) ? result.events : [];
    if (replacedIds.length === 0 || events.length !== replacedIds.length) return { ok: false, reason: "invalid" };

    const replaced = new Set(replacedIds);
    const replacedTasks = tasks.filter((task) => replaced.has(task.id));
    if (replacedTasks.length !== replaced.size || replacedTasks.some((task) => task.done)) return { ok: false, reason: "changed" };

    const fresh = newTrackedPlan({ events }).tasks;
    if (fresh.length !== events.length) return { ok: false, reason: "invalid" };

    const kept = tasks.filter((task) => !replaced.has(task.id));
    // 新時間不能壓到保留下來的任務（尤其是已完成的）
    const clash = fresh.some((one) => kept.some((old) => new Date(one.start) < new Date(old.end) && new Date(old.start) < new Date(one.end)));
    if (clash) return { ok: false, reason: "overlap" };
    const merged = [...kept, ...fresh].sort(byStart);
    if (merged.length > MAX_TASKS) return { ok: false, reason: "invalid" };

    // 保留的任務仍引用的行事曆事件不能刪（舊資料或手動寫入可能讓兩個任務指向同一個事件）
    const stillUsed = new Set(kept.map((task) => task.calendarEventId).filter(Boolean));
    const removedCalendarEventIds = replacedTasks.map((task) => task.calendarEventId).filter((id) => id && !stillUsed.has(id));
    return { ok: true, tasks: merged, freshIds: fresh.map((task) => task.id), removedCalendarEventIds, hadCalendarLink: replacedTasks.some((task) => task.calendarEventId) };
}
