import "../../static/css/_quiz/bot.css"
import { useId, useState, useRef, useEffect } from "react";
import { Bot, ChevronDown } from "lucide-react"
import { useNavigate } from "react-router-dom";
import StudyPlanComponent from "./bot_study_plan"
import { buildHistory } from "./botHistory"
import { useAuth } from "../../src/userServives/authContext";
import { getUserSituation } from "../../src/userServives/uploadDb";
import { TRIBES } from "../../src/constants/tribes";
import { scrollBehavior } from "../../src/hooks/useReducedMotion";
import { apiPost } from "../../utils/apiClient";
import { useDialog } from "@hooks/useDialog";
import { announce } from "@utils/announce";

const SUGGESTIONS = [
    "我想了解我的學習狀況",
    "介紹這個族語的文化特色",
    "幫我排一週讀書計畫"
];

// 各族語的族語問候詞。目前只有泰雅語的 "lokah su"（專案內遊戲題庫把它標成泰雅語「你好」）有依據；
// 其他族語的問候詞還沒有對照官方來源（族語E樂園、線上辭典）核對，先不放，
// 開場白只用中文，避免 AI 助手一開口就寫錯族語。核對後在這裡補上即可（審查項 P2-74）。
const TRIBE_GREETING_WORDS = {
    tayal: "lokah su",
};

const tribeLabel = (slug) => {
    const found = TRIBES.find((t) => t.slug === slug);
    return found ? `${found.name}語` : "所選族語";
};

const greetingText = (slug) => {
    const word = TRIBE_GREETING_WORDS[slug];
    return `${word ? `${word} ` : ""}你好！我是您的${tribeLabel(slug)} AI 助手，有什麼我可以幫您的嗎？`;
};

// 右下角懸浮聊天視窗（類似 Messenger）：非 modal，背景頁面仍可操作。
// open=false 時視窗收合但保持掛載，對話內容與進行中的請求都不會遺失。
const AIAssistantOverlay = ({ onClose, open = true, returnFocusRef = null }) => {
    const navigate = useNavigate();
    const disclaimerId = useId();
    // 直接從網址進到 /bot（沒有帶 onClose）時用 navigate(-1) 可能把使用者導到
    // 應用程式以外的頁面（例如瀏覽器歷史紀錄的上一頁是外部網站），改成固定
    // 導回測驗首頁，行為可預期。
    const handleClose = onClose ?? (() => navigate("/quiz"));
    const { userData } = useAuth();
    const [tribe, setTribe] = useState("tayal");
    // 開場白記錄它是為哪個族語寫的（greetingFor），對話還沒開始時換族語就跟著換
    const [messages, setMessages] = useState([
        { id: 1, text: greetingText("tayal"), role: "bot", greetingFor: "tayal" }
    ]);
    const [input, setInput] = useState("");
    const [isPending, setIsPending] = useState(false);
    const messageEndRef = useRef(null);
    const dialogRef = useRef(null);
    const inputRef = useRef(null);
    const mountedRef = useRef(true);
    const abortControllerRef = useRef(null);
    const sendingRef = useRef(false);
    const [userStats, setUserStats] = useState({
        correct: 0, incorrect: 0, unanswered: 0, common_errors: [], level: "beginner"
    });

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            // 對話框關掉/元件卸載時，還在進行中的請求就不用等了——中止它，
            // 避免回應回來時對著已經卸載的元件呼叫 setMessages/setIsPending。
            abortControllerRef.current?.abort();
        };
    }, []);

    // 在元件掛載後，從 Firebase 讀取使用者真實學習資料
    useEffect(() => {
        if (!userData) return;
        let cancelled = false;
        // Firestore 裡的舊資料／異常資料可能含 null 或非數字，這個 effect 在 overlay
        // 一開啟就會跑，丟例外會讓整個助手（甚至整頁）掛掉，所以全部先正規化成數字。
        const toCount = (n) => (Number.isFinite(n) ? n : 0);
        const userErrors = userData?.firestoreData?.user_errors || {};
        const commonErrors = Object.entries(userErrors)
            .sort(([, a], [, b]) => toCount(b) - toCount(a))
            .slice(0, 3)
            .map(([word, cnt]) => `${word}（答錯${toCount(cnt)}次）`);
        const totalErrors = Object.values(userErrors).reduce((sum, n) => sum + toCount(n), 0);

        // 薦讀測驗（IRT）累積的 type_stats 內含每種題型的作答次數(n)與錯誤次數(e)，
        // 答對數 = 總作答次數 - 總錯誤次數，取代原本永遠是 0 的寫死值
        const typeStats = userData?.firestoreData?.quiz_model?.type_stats || {};
        const totalAttempts = Object.values(typeStats).reduce((sum, s) => sum + toCount(s?.n), 0);
        const totalTypeErrors = Object.values(typeStats).reduce((sum, s) => sum + toCount(s?.e), 0);
        const totalCorrect = Math.max(totalAttempts - totalTypeErrors, 0);

        getUserSituation()
            .then(sit => {
                if (cancelled) return;
                setUserStats({
                    correct: totalCorrect,
                    incorrect: totalErrors,
                    unanswered: 0,
                    common_errors: commonErrors,
                    level: sit?.level || "beginner",
                });
            })
            .catch(() => {
                if (cancelled) return;
                setUserStats({
                    correct: totalCorrect,
                    incorrect: totalErrors,
                    unanswered: 0,
                    common_errors: commonErrors,
                    level: "beginner",
                });
            });
        return () => { cancelled = true; };
    }, [userData]);

    // 非 modal 的懸浮視窗：不鎖背景、不困住 Tab，只在焦點位於視窗內時 Esc 才收合，
    // 開啟時焦點直接放在輸入框，收合後焦點回到右下角的啟動鈕。
    useDialog(dialogRef, { active: open, onClose: handleClose, initialFocusRef: inputRef, modal: false, returnFocusRef });

    // 新訊息或「輸入中」指示器出現/消失時自動捲到底部，messageEndRef 原本宣告了
    // 卻從沒呼叫 scrollIntoView，訊息一多使用者得自己手動往下滑。
    useEffect(() => {
        messageEndRef.current?.scrollIntoView({ behavior: scrollBehavior() });
    }, [messages, isPending, open]);

    // 換族語：對話還沒開始就直接換開場白；已經聊過了，保留對話紀錄，另外加一句說明
    // （live region 會念出來），讓使用者知道後面的回答改用哪個族語。
    const handleTribeChange = (e) => {
        const nextTribe = e.target.value;
        if (nextTribe === tribe) return;
        setTribe(nextTribe);
        // 對話還沒開始時只是就地改寫開場白那一則，live region 不一定會念出文字變更，另外公告一次；
        // 已經聊過時會新增一則說明訊息，live region 會自己念，不用重複公告
        if (messages.length === 1 && messages[0].greetingFor) announce(`已切換為${tribeLabel(nextTribe)}`);
        setMessages((prev) => {
            if (prev.length === 1 && prev[0].greetingFor) {
                return [{ ...prev[0], text: greetingText(nextTribe), greetingFor: nextTribe }];
            }
            return [...prev, {
                id: crypto.randomUUID(),
                text: `已切換為${tribeLabel(nextTribe)}，接下來的問題會以${tribeLabel(nextTribe)}回答。`,
                role: "bot",
                isNote: true, // 對話記憶的分隔線，見 botHistory.js
            }];
        });
    };

    const handleInputChange = (e) => {
        setInput(e.target.value);
    };

    //傳送訊息
    const handleSend = async () => {
        // isPending 是 state，同一個事件迴圈內連按兩次還看不到更新，用 ref 同步擋住重複送出
        if (input.trim() === "" || isPending || sendingRef.current) return;
        sendingRef.current = true;

        // 送出鈕與輸入框都不再用 disabled 擋住等待中的狀態（disabled 會讓焦點掉回 body，
        // 每則訊息都得重新點輸入框），改成 aria-disabled / aria-busy，並把焦點留在輸入框（審查項 P1-6）。
        inputRef.current?.focus({ preventScroll: true });
        const userText = input;
        const newUserMessage = { id: crypto.randomUUID(), text: userText, role: "user" };
        setMessages(prev => [...prev, newUserMessage]);
        setInput("");
        setIsPending(true);

        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            const data = await apiPost(
                import.meta.env.VITE_API_AI_BOT_URL,
                { message: userText, user_stats: userStats, tribe, history: buildHistory(messages) },
                { signal: controller.signal },
            );
            if (!mountedRef.current) return;

            const botResponse = {
                id: crypto.randomUUID(),
                text: data?.message || "很抱歉，沒有取得有效的回應。",
                role: "bot",
                studyPlan: data?.study_plan || null
            };

            setMessages(prev => [...prev, botResponse]);
        } catch (error) {
            // 手動中止（關閉對話框/卸載）不是真正的失敗，不用再顯示錯誤訊息，
            // 這時元件通常也已經卸載了。
            if (controller.signal.aborted) return;
            if (!mountedRef.current) return;

            // 管理者關閉了 AI 助手（總開關）：後端用 code 明確標示，照它給的說明顯示，
            // 不要讓人以為是自己網路的問題；其他 403（例如代理層擋下）仍走通用訊息
            const serviceOff = error?.status === 403 && error?.data?.code === "ai_assistant_disabled";
            const errorResponse = {
                id: crypto.randomUUID(),
                text: serviceOff
                    ? (error?.data?.detail || "AI 助手目前暫停服務，請稍後再試。")
                    : "很抱歉，無法取得回應，請稍後再試。",
                role: "bot",
                isError: true,
            };
            setMessages(prev => [...prev, errorResponse]);
            console.error("取得回應失敗:", error);
        } finally {
            sendingRef.current = false;
            if (mountedRef.current) setIsPending(false);
        }
    };

    const handleKeyDown = (e) => {
        // 中文/日文注音等輸入法用 Enter 確認候選字時也會觸發 keydown 的
        // Enter，這裡沒有排除的話，選字確認會被誤判成「送出訊息」，把還在
        // 組字中的內容提前送出去。keyCode 229 是部分瀏覽器（Safari）組字結束後那一下 Enter 的標記。
        if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
            handleSend();
        }
    };

    const handleSuggestionClick = (suggestion) => {
        setInput(suggestion);
    };

    return (
        <div className="bot-overlay" data-open={open} inert={!open}>
            <div
                ref={dialogRef}
                tabIndex={-1}
                className="chat-container"
                role="dialog"
                aria-modal="false"
                aria-label="族語 AI 助手"
            >
                <div className="chat-header">
                    <button
                        type="button"
                        onClick={handleClose}
                        className="chat-return"
                        aria-label="收合 AI 助手"
                    >
                        <ChevronDown size={22} />
                    </button>
                    <div className="bot-avatar">
                        <Bot />
                    </div>
                    <div className="header-info">
                        <h2>{TRIBES.find((t) => t.slug === tribe)?.name}智慧助手</h2>
                        <p className="bot-status online">{isPending ? "回覆中…" : "可以提問"}</p>
                    </div>
                    <select
                        value={tribe}
                        onChange={handleTribeChange}
                        disabled={isPending}
                        style={{ position: "relative", zIndex: 1, borderRadius: 6, border: "none", padding: "4px 6px" }}
                        aria-label="選擇族語"
                    >
                        {TRIBES.map((t) => (
                            <option key={t.slug} value={t.slug}>{t.name}語</option>
                        ))}
                    </select>
                </div>

                {/* role="log"：新訊息會被報讀器依序念出，不打斷使用者正在做的事 */}
                <div className="messages-container" role="log" aria-live="polite" aria-relevant="additions" aria-label="對話紀錄">
                    {messages.map((message) => (
                        <div key={message.id} className={`bot-message ${message.role}`}>
                            {message.role === "bot" && (
                                <div className="avatar-small">
                                    <Bot />
                                </div>
                            )}
                            <div className="message-bubble">
                                <p>{message.text}</p>
                                {message.studyPlan && (
                                    <StudyPlanComponent plan={message.studyPlan} onClose={handleClose} />
                                )}
                            </div>
                        </div>
                    ))}
                    {isPending && (
                        <div className="bot-message bot">
                            <div className="avatar-small">
                                <Bot />
                            </div>
                            <div className="message-bubble typing">
                                <span className="visually-hidden">助手正在輸入</span>
                                <div className="typing-indicator" aria-hidden="true">
                                    <span></span>
                                    <span></span>
                                    <span></span>
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={messageEndRef} />
                </div>

                {messages.length <= 2 && (
                    <div className="suggestions-container">
                        <p className="suggestions-title">您可能想問：</p>
                        <div className="suggestion-pills">
                            {SUGGESTIONS.map((suggestion, index) => (
                                <button
                                    type="button"
                                    key={index}
                                    className="suggestion-pill"
                                    onClick={() => handleSuggestionClick(suggestion)}
                                    disabled={isPending}
                                >
                                    {suggestion}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* 常駐的準確度提醒：語言學習工具的 AI 可能寫錯族語詞彙與拼寫 */}
                <p className="bot-disclaimer" id={disclaimerId}>AI 可能寫錯族語的詞彙或拼寫，學習時請以族語辭典為準。</p>
                <div className="input-area">
                    <input
                        ref={inputRef}
                        type="text"
                        value={input}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        placeholder="輸入您的訊息..."
                        className="message-input"
                        aria-label="輸入訊息"
                        aria-describedby={disclaimerId}
                        aria-busy={isPending}
                    />
                    <button
                        type="button"
                        className={`send-button ${input.trim() && !isPending ? 'active' : ''}`}
                        onClick={handleSend}
                        aria-disabled={input.trim() === "" || isPending}
                    >
                        發送
                    </button>
                </div>
            </div>
        </div >
    );
};
export default AIAssistantOverlay;
