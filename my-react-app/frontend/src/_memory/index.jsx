import "../../static/css/_memory/memory.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiDelete, apiGet, apiPost, apiPut } from "../../utils/apiClient";
import { apiUrl } from "../../utils/apiUrls";

const MEMORY_URL = apiUrl('LEARNER_MEMORY');

// 同意說明的版本，必須跟後端 backend/AIModel/memory_store.py 的 CONSENT_VERSION 一致。
// 不一致（後端改了記錄內容、這裡的文字還沒更新）時不讓人按同意，避免同意到跟實際不符的說明。
export const MEMORY_TEXT_VERSION = "2026-10-v1";

const formatDate = (iso) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("zh-TW");
};

// 稽核 WP-10 驗證後：同意時說明版本跟後端不符（409 consent_version_mismatch）的說明文字，
// 與後端 memory_views.py 的訊息一致；收到時除了顯示，還會自動重新載入設定。
const CONSENT_MISMATCH_TEXT = "說明已更新，請重新整理頁面後再同意";

const errorText = (err, fallback) => {
    if (err?.data?.code === "learner_memory_disabled") return "學習記憶目前尚未開放。";
    if (err?.status === 429) return "操作太頻繁，請稍等一下再試。";
    if (err?.status === 409 && err?.data?.code === "consent_version_mismatch") return CONSENT_MISMATCH_TEXT;
    if (err?.status === 400 && typeof err?.data?.detail === "string") return err.data.detail;   // 內容或路徑不合規定的說明，是給使用者看的
    return fallback;
};

// 兩段式確認取代 window.confirm：第一下變成「確定…／取消」，不開對話框，焦點留在同一組按鈕
function ConfirmButton({ label, confirmLabel, onConfirm, disabled, danger = true }) {
    const [asking, setAsking] = useState(false);
    const confirmRef = useRef(null);
    const triggerRef = useRef(null);
    const restoreFocus = useRef(false);

    useEffect(() => {
        if (asking) {
            confirmRef.current?.focus();
        } else if (restoreFocus.current) {
            restoreFocus.current = false;
            triggerRef.current?.focus();          // 取消後焦點回到原本的按鈕，鍵盤使用者不會掉到頁面頂端
        }
    }, [asking]);

    if (!asking) {
        return (
            <button ref={triggerRef} type="button" className="memory-btn" aria-disabled={disabled} onClick={() => !disabled && setAsking(true)}>
                {label}
            </button>
        );
    }
    return (
        <span className="memory-confirm" role="group" aria-label={`確認${label}`}>
            <button
                ref={confirmRef}
                type="button"
                className={`memory-btn ${danger ? "memory-btn-danger" : "memory-btn-primary"}`}
                aria-disabled={disabled}
                onClick={() => { if (!disabled) { setAsking(false); onConfirm(); } }}
            >
                {confirmLabel}
            </button>
            <button type="button" className="memory-btn" onClick={() => { restoreFocus.current = true; setAsking(false); }}>取消</button>
        </span>
    );
}

function NoteItem({ file, busy, onSave, onDelete }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(file.content);
    const [problem, setProblem] = useState("");
    const textareaRef = useRef(null);
    const editButtonRef = useRef(null);
    const errorId = `memory-edit-error-${file.path}`;

    useEffect(() => {
        if (editing) textareaRef.current?.focus();
    }, [editing]);

    const save = async () => {
        setProblem("");
        const result = await onSave(file.path, draft);
        if (result === true) {
            setEditing(false);
            requestAnimationFrame(() => editButtonRef.current?.focus());     // 儲存後焦點回到編輯鈕，鍵盤使用者不會掉到頁面頂端
        } else {
            setProblem(result);
        }
    };

    const cancel = () => {
        setEditing(false);
        setDraft(file.content);
        setProblem("");
        requestAnimationFrame(() => editButtonRef.current?.focus());
    };

    return (
        <li className="memory-note">
            <div className="memory-note-head">
                <h3>{file.path}</h3>
                <span className="memory-note-date">更新於 {formatDate(file.updated_at)}</span>
            </div>
            {editing ? (
                <>
                    <label className="visually-hidden" htmlFor={`memory-edit-${file.path}`}>編輯 {file.path}</label>
                    <textarea
                        id={`memory-edit-${file.path}`}
                        ref={textareaRef}
                        className="memory-textarea"
                        value={draft}
                        rows={Math.min(12, Math.max(4, draft.split("\n").length + 1))}
                        onChange={(e) => setDraft(e.target.value)}
                        aria-invalid={Boolean(problem)}
                        aria-describedby={problem ? errorId : undefined}
                    />
                    {problem && <p id={errorId} className="memory-error" role="alert">{problem}</p>}
                    <div className="memory-actions">
                        <button type="button" className="memory-btn memory-btn-primary" aria-disabled={busy} onClick={() => !busy && save()}>儲存</button>
                        <button type="button" className="memory-btn" onClick={cancel}>取消</button>
                    </div>
                </>
            ) : (
                <>
                    <p className="memory-note-body">{file.content}</p>
                    <div className="memory-actions">
                        <button ref={editButtonRef} data-note-edit type="button" className="memory-btn" onClick={() => setEditing(true)}>
                            <span className="visually-hidden">編輯 {file.path}</span><span aria-hidden="true">編輯</span>
                        </button>
                        <ConfirmButton label="刪除" confirmLabel="確定刪除" disabled={busy} onConfirm={() => onDelete(file.path)} />
                    </div>
                </>
            )}
        </li>
    );
}

// 「我的學習記憶」（路線圖 #21）：看助手記了你什麼、改掉不對的、刪掉不想留的，或整個關掉。
export default function LearnerMemoryPage() {
    const [data, setData] = useState(null);
    const [loadFailed, setLoadFailed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [status, setStatus] = useState("");
    const [agree, setAgree] = useState(false);
    const notesListRef = useRef(null);
    const notesTitleRef = useRef(null);
    // FE3-21：刪除後要把焦點放到哪（刪掉的那一則原本的位置）；資料更新、DOM 重畫完才能動焦點
    const focusAfterRef = useRef(null);

    useEffect(() => {
        const pending = focusAfterRef.current;
        if (!pending || !data) return;
        focusAfterRef.current = null;
        const edits = notesListRef.current?.querySelectorAll("[data-note-edit]") ?? [];
        // 優先移到「下一則」（刪掉後同一個位置），刪的是最後一則就移到上一則；一則都不剩就移到區段標題
        const target = pending.index == null ? null : edits[Math.min(pending.index, edits.length - 1)];
        (target || notesTitleRef.current)?.focus();
    }, [data]);

    const load = useCallback(async () => {
        setLoadFailed(false);
        try {
            setData(await apiGet(MEMORY_URL));
        } catch {
            setLoadFailed(true);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const run = async (action, doneMessage, failMessage, onFail) => {
        if (busy) return false;
        setBusy(true);
        setError("");
        setStatus("");                       // 先清空，連續兩次相同的成功訊息才會再次被朗讀
        try {
            setData(await action());
            setStatus(doneMessage);
            return true;
        } catch (err) {
            setError(errorText(err, failMessage));
            onFail?.(err);
            return false;
        } finally {
            setBusy(false);
        }
    };

    const saveNote = async (path, content) => {
        if (busy) return "處理中，請稍等。";
        setBusy(true);
        setStatus("");
        try {
            setData(await apiPut(`${MEMORY_URL}file/`, { path, content }));
            setStatus("已儲存修改。");
            return true;
        } catch (err) {
            return errorText(err, "儲存失敗，請稍後再試。");
        } finally {
            setBusy(false);
        }
    };

    const deleteNote = async (path) => {
        const index = (data?.files || []).findIndex((f) => f.path === path);
        const ok = await run(
            () => apiDelete(`${MEMORY_URL}file/`, { params: { path } }), "已刪除這則筆記。", "刪除失敗，請稍後再試。");
        // 先記下要移焦點，等 setData 之後的那次 render 再由 effect 執行
        if (ok) focusAfterRef.current = { index: index >= 0 ? index : null };
        return ok;
    };
    // FE3-22：同意請求帶上使用者實際看到的說明版本（MEMORY_TEXT_VERSION）；撤回不需要版本。
    // 不論開啟或關閉成功都把勾選框清掉：關閉後要重新開啟，必須重新勾選同意，不能一鍵重開。
    const setConsent = async (granted) => {
        const ok = await run(
            () => apiPost(`${MEMORY_URL}consent/`, granted ? { granted, version: MEMORY_TEXT_VERSION } : { granted }),
            granted ? "已開啟學習記憶。" : "已關閉學習記憶，所有筆記都已刪除。",
            "更新失敗，請稍後再試。",
            (err) => {
                // 說明版本過期：重新取得 consentVersion 與說明文字，勾選框清空，要看過新說明再同意
                if (err?.status === 409 && err?.data?.code === "consent_version_mismatch") {
                    setAgree(false);
                    load();
                }
            });
        if (ok) setAgree(false);
        return ok;
    };
    const clearAll = async () => {
        const ok = await run(() => apiDelete(MEMORY_URL), "已清除全部筆記。", "清除失敗，請稍後再試。");
        if (ok) focusAfterRef.current = { index: null };   // 筆記全沒了，按鈕也跟著消失，焦點移到區段標題
        return ok;
    };

    if (loadFailed) {
        return (
            <main className="memory-page">
                <h1>我的學習記憶</h1>
                <p role="alert">目前無法讀取，請稍後再試。</p>
                <button type="button" className="memory-btn memory-btn-primary" onClick={load}>重新讀取</button>
            </main>
        );
    }
    if (!data) {
        return (
            <main className="memory-page" aria-busy="true">
                <h1>我的學習記憶</h1>
                <p className="memory-muted">讀取中…</p>
            </main>
        );
    }

    const versionMatches = data.consentVersion === MEMORY_TEXT_VERSION;
    const files = data.files || [];

    return (
        <main className="memory-page">
            <h1>我的學習記憶</h1>
            <p className="memory-lead">
                開啟後，AI 助手會把你的學習狀況（目標、容易搞混的地方、進度）寫成簡短筆記，下次聊天時接著幫你。
                預設是關閉的，不開也不影響任何功能。
            </p>

            <section aria-labelledby="memory-consent-title" className="memory-section">
                <h2 id="memory-consent-title">是否開啟</h2>
                <details className="memory-details">
                    <summary>查看完整說明</summary>
                    <p>
                        助手只會記學習相關的內容。它被要求不記姓名、聯絡方式、網址等個人資料，伺服器也會擋下含有這些內容的筆記。
                        筆記存在我們的資料庫，只有你自己看得到、改得到，下一次聊天時助手會讀取它來回答你。
                    </p>
                    <p>
                        超過 {data.retentionDays} 天沒有更新的筆記會自動刪除。你可以在這一頁隨時修改或刪除筆記；
                        關閉學習記憶會刪除全部筆記。刪除帳號時筆記也會一併刪除。
                    </p>
                </details>

                {!data.enabled && !data.consented ? (
                    <p className="memory-muted">學習記憶目前尚未開放。</p>
                ) : data.consented ? (
                    <div className="memory-actions">
                        <p className="memory-state" role="status">目前狀態：已開啟</p>
                        <ConfirmButton
                            label="關閉並刪除全部筆記"
                            confirmLabel="確定關閉並刪除"
                            disabled={busy}
                            onConfirm={() => setConsent(false)}
                        />
                    </div>
                ) : (
                    <div className="memory-actions">
                        <p className="memory-state" role="status">目前狀態：已關閉</p>
                        {!versionMatches ? (
                            <p className="memory-muted">說明文字正在更新，請稍後再試。</p>
                        ) : (
                            <>
                                <label className="memory-check">
                                    <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                                    <span>我已看過說明，同意讓 AI 助手儲存我的學習記憶</span>
                                </label>
                                <button
                                    type="button"
                                    className="memory-btn memory-btn-primary"
                                    aria-disabled={!agree || busy}
                                    onClick={() => agree && !busy && setConsent(true)}
                                >
                                    開啟學習記憶
                                </button>
                            </>
                        )}
                    </div>
                )}
            </section>

            <section aria-labelledby="memory-notes-title" className="memory-section">
                <h2 id="memory-notes-title" ref={notesTitleRef} tabIndex={-1}>助手記下的筆記</h2>
                {files.length === 0 ? (
                    <p className="memory-muted">
                        {data.consented ? "還沒有筆記。和助手聊聊學習狀況，它會視情況記下重點。" : "沒有任何筆記。"}
                    </p>
                ) : (
                    <>
                        <ul className="memory-notes" ref={notesListRef}>
                            {files.map((file) => (
                                <NoteItem key={file.path} file={file} busy={busy} onSave={saveNote} onDelete={deleteNote} />
                            ))}
                        </ul>
                        <ConfirmButton label="清除全部筆記" confirmLabel="確定清除全部" disabled={busy} onConfirm={clearAll} />
                    </>
                )}
            </section>

            <p className="memory-error" role="alert">{error}</p>
            <p className="visually-hidden" role="status" aria-live="polite">{status}</p>
            <p className="memory-muted">
                更多關於資料的說明，見<Link to="/privacy">隱私與資料</Link>。
            </p>
        </main>
    );
}
