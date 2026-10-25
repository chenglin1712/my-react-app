import "../../static/css/_quiz/plan_tracker.css";
import PropTypes from "prop-types";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { apiPost } from "../../utils/apiClient";
import { formatEventTime, TAIPEI_TIME_ZONE } from "../../utils/calendarEvents";
import { progressOf, withTaskDone } from "../../utils/studyPlan";
import { applyReplan, getTrackedPlan, ReplanConflictError, setTaskDone, stopTracking } from "../../src/userServives/studyPlanService";
import { announce } from "@utils/announce";

const REPLAN_URL = import.meta.env.VITE_API_REPLAN_STUDY_PLAN_URL || "/AIModel/replan_study_plan/";

// 依錯誤類型給學生看得懂的說明與下一步（不顯示後端的原始訊息）
const replanErrorMessage = (err) => {
    if (err instanceof ReplanConflictError) {
        if (err.reason === "changed") return "計畫在重排期間有變動，沒有更動任何任務，請再試一次。";
        if (err.reason === "overlap") return "這次排出的時間和已完成的任務重疊，沒有更動任何任務，請再試一次。";
        return "這次排出的結果不完整，請再試一次。";
    }
    const code = err?.data?.code;
    if (code === "ai_plan_replan_disabled") return "計畫重排目前尚未開放。";
    if (code === "ai_assistant_disabled") return "AI 助手目前暫停服務，請稍後再試。";
    if (code === "study_plan_all_done") return "所有任務都完成了，沒有需要重排的。";
    if (err?.status === 404) return "找不到追蹤中的計畫。";
    if (err?.status === 429) return code === "ai_daily_quota_exceeded" ? "今天的提問次數已經用完了，明天 00:00 重置。" : "請求太頻繁，請稍等一下再試。";
    if (err?.status === 422) return "這次沒有排出有效的新時間，請再試一次。";
    return "暫時無法重排，請稍後再試。";
};

const dayText = (iso) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
        ? ""
        : date.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric", weekday: "short", timeZone: TAIPEI_TIME_ZONE });
};

// 追蹤中的讀書計畫（路線圖 #26）：顯示完成進度、勾選任務、請助手重排還沒完成的任務。
// 計畫存在 Firestore（本人才讀得到）；勾選不用 AI，永遠可用，「重排」才會呼叫後端（受旗標與每日額度控制）。
// 沒有追蹤中的計畫、沒登入、讀取失敗都是整塊不顯示：這是輔助資訊，不能影響聊天。
const TrackedStudyPlan = ({ refreshKey = 0, replanEnabled = false, tribe, onQuota = null }) => {
    const [plan, setPlan] = useState(null);
    const [expanded, setExpanded] = useState(false);
    const [replanOpen, setReplanOpen] = useState(false);
    const [availability, setAvailability] = useState("");
    const [replanning, setReplanning] = useState(false);
    const [confirmingStop, setConfirmingStop] = useState(false);
    const [notice, setNotice] = useState("");
    const mountedRef = useRef(true);
    const writeChainRef = useRef(Promise.resolve());     // 勾選依點擊順序一筆一筆寫，最後的資料一定是最後一次點擊
    const pendingWritesRef = useRef(0);
    const loadSeqRef = useRef(0);                        // 載入的世代：只有最新一次載入的結果可以套用
    const editsRef = useRef(0);                          // 本機勾選的次數：載入期間有人勾選，那份載入結果就是舊的
    const loadDroppedRef = useRef(false);                // 有載入結果因為太舊被丟掉：寫入全部結束後要重讀一次
    const controllerRef = useRef(null);
    const listId = useId();
    const availabilityId = useId();
    const hintId = useId();

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            controllerRef.current?.abort();
        };
    }, []);

    const load = useCallback(async () => {
        // 最多重讀兩次：連續勾選時不要一直重讀；放棄時畫面維持本機的最新狀態（每次勾選寫入後也都對齊過資料庫）
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const seq = ++loadSeqRef.current;
            const edits = editsRef.current;
            let loaded = null;
            try {
                loaded = await getTrackedPlan();
            } catch {
                loaded = null;
            }
            if (!mountedRef.current || seq !== loadSeqRef.current) return;      // 已卸載，或有較新的載入
            if (edits === editsRef.current && pendingWritesRef.current === 0) {
                setPlan(loaded);
                return;
            }
            // 讀的是勾選前的快照：不能蓋掉畫面。寫入還在跑就等它結束後再讀（toggle 的 finally 會補讀）；已經結束了就現在重讀
            if (pendingWritesRef.current > 0) {
                loadDroppedRef.current = true;
                return;
            }
        }
    }, []);

    // refreshKey 變動（剛按了「開始追蹤」）時重新讀；開始追蹤後直接展開讓學生看到
    useEffect(() => { load(); }, [load, refreshKey]);
    useEffect(() => { if (refreshKey > 0) setExpanded(true); }, [refreshKey]);

    if (!plan) return null;
    const { done, total, undone, ratio } = progressOf(plan.tasks);

    const toggle = async (task) => {
        const next = !task.done;
        editsRef.current += 1;
        setNotice("");
        setPlan((current) => ({ ...current, tasks: withTaskDone(current.tasks, task.id, next) }));      // 先反映在畫面上
        pendingWritesRef.current += 1;
        const write = writeChainRef.current.then(() => setTaskDone(task.id, next));
        writeChainRef.current = write.catch(() => {});
        try {
            const saved = await write;
            // 後面還有排隊的寫入時先不用回來的快照蓋畫面，等最後一筆完成再對齊資料庫
            if (mountedRef.current && pendingWritesRef.current === 1) setPlan((current) => ({ ...current, tasks: saved }));
        } catch {
            if (mountedRef.current) {
                setPlan((current) => ({ ...current, tasks: withTaskDone(current.tasks, task.id, !next) }));
                setNotice("沒有儲存成功，請稍後再試。");
            }
        } finally {
            pendingWritesRef.current -= 1;
            if (pendingWritesRef.current === 0 && loadDroppedRef.current && mountedRef.current) {
                loadDroppedRef.current = false;
                load();
            }
        }
    };

    const replan = async () => {
        if (replanning) return;
        setReplanning(true);
        setNotice("");
        const controller = new AbortController();
        controllerRef.current = controller;
        try {
            const result = await apiPost(REPLAN_URL, { tribe, availability: availability.trim() }, { signal: controller.signal });
            if (controller.signal.aborted) return;
            if (result?.refused) {
                setNotice(result.message || "這次沒有重排。");
            } else {
                const tasks = await applyReplan(result);
                if (!mountedRef.current) return;
                editsRef.current += 1;                                  // 重排前就開始的載入結果是舊的，不能蓋掉
                setPlan((current) => ({ ...current, tasks }));
                setReplanOpen(false);
                setAvailability("");
                setNotice("已重新安排還沒完成的任務，完成的任務沒有更動。");
                announce("已重新安排還沒完成的任務");
            }
            if (result?.quota) onQuota?.(result.quota);
        } catch (err) {
            if (controller.signal.aborted || !mountedRef.current) return;
            setNotice(replanErrorMessage(err));
            if (err instanceof ReplanConflictError) load();          // 畫面上的狀態是舊的，重新讀
        } finally {
            if (mountedRef.current) setReplanning(false);
        }
    };

    const stop = async () => {
        try {
            await stopTracking();
            if (!mountedRef.current) return;
            editsRef.current += 1;                                      // 結束追蹤前就開始的載入不能讓計畫重新出現
            loadSeqRef.current += 1;
            loadDroppedRef.current = false;
            setPlan(null);
            announce("已結束追蹤這份計畫");
        } catch {
            if (mountedRef.current) {
                setConfirmingStop(false);
                setNotice("沒有結束成功，請稍後再試。");
            }
        }
    };

    return (
        <section className="plan-tracker" aria-label="追蹤中的讀書計畫">
            <button
                type="button"
                className="plan-tracker-head"
                aria-expanded={expanded}
                aria-controls={listId}
                onClick={() => setExpanded((open) => !open)}
            >
                <span className="plan-tracker-title">{plan.title}</span>
                <span className="plan-tracker-count">{done}／{total} 完成</span>
                <ChevronDown size={18} aria-hidden="true" className="plan-tracker-chevron" />
                <span className="plan-tracker-bar" aria-hidden="true" style={{ transform: `scaleX(${ratio})` }} />
            </button>

            <div id={listId} hidden={!expanded} className="plan-tracker-body">
                <ul className="plan-tracker-list" aria-label="計畫任務">
                    {plan.tasks.map((task) => (
                        <li key={task.id}>
                            <label className="plan-tracker-task" data-done={task.done || undefined}>
                                <input type="checkbox" checked={task.done} onChange={() => toggle(task)} />
                                <span className="plan-tracker-box" aria-hidden="true"><Check size={14} strokeWidth={3} /></span>
                                <span className="plan-tracker-text">
                                    <span className="plan-tracker-summary">{task.summary}</span>
                                    <span className="plan-tracker-when">{dayText(task.start)} {formatEventTime(task)}</span>
                                </span>
                            </label>
                        </li>
                    ))}
                </ul>

                {replanOpen && (
                    <div className="plan-tracker-form" role="group" aria-label="重排未完成的任務">
                        <label htmlFor={availabilityId}>可用時間（選填）</label>
                        <input
                            id={availabilityId}
                            type="text"
                            maxLength={200}
                            value={availability}
                            onChange={(event) => setAvailability(event.target.value)}
                            aria-describedby={hintId}
                            autoComplete="off"
                        />
                        <p id={hintId} className="plan-tracker-hint">例如：平日晚上八點後、週末整天。不填就平均排在接下來幾天，已完成的任務不會更動。</p>
                        <div className="plan-tracker-actions">
                            <button type="button" className="plan-tracker-primary" onClick={replan} aria-disabled={replanning}>
                                {replanning ? "助手重排中…" : "重排"}
                            </button>
                            <button type="button" className="plan-tracker-secondary" onClick={() => { if (!replanning) setReplanOpen(false); }} aria-disabled={replanning}>取消</button>
                        </div>
                    </div>
                )}

                {confirmingStop ? (
                    <div className="plan-tracker-form" role="group" aria-label="確認結束追蹤">
                        <p className="plan-tracker-hint">結束追蹤會刪除這份計畫的完成紀錄，行事曆裡的行程不會被刪除。</p>
                        <div className="plan-tracker-actions">
                            <button type="button" className="plan-tracker-danger" onClick={stop}>結束追蹤</button>
                            <button type="button" className="plan-tracker-secondary" onClick={() => setConfirmingStop(false)}>取消</button>
                        </div>
                    </div>
                ) : (
                    !replanOpen && (
                        <div className="plan-tracker-actions">
                            {replanEnabled && undone > 0 && (
                                <button type="button" className="plan-tracker-primary" aria-expanded={false} onClick={() => setReplanOpen(true)}>請助手重排未完成的任務</button>
                            )}
                            <button type="button" className="plan-tracker-secondary" aria-expanded={false} onClick={() => setConfirmingStop(true)}>結束追蹤</button>
                        </div>
                    )
                )}

                <p className="plan-tracker-status" role="status" aria-live="polite">{notice}</p>
            </div>
        </section>
    );
};

TrackedStudyPlan.propTypes = {
    refreshKey: PropTypes.number,
    replanEnabled: PropTypes.bool,
    tribe: PropTypes.string.isRequired,
    onQuota: PropTypes.func,
};

export default TrackedStudyPlan;
