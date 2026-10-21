import "../../static/css/_quiz/bot.css"
import { useId, useState, useRef, useEffect } from "react";
import { Bot, ChevronDown } from "lucide-react"
import { useNavigate } from "react-router-dom";
import StudyPlanComponent from "./bot_study_plan"
import WordEntryCards from "./WordEntryCards"
import UnverifiedWordsNote from "./UnverifiedWordsNote"
import useAuthorizedAudioPlayback from "../../hooks/useAuthorizedAudioPlayback";
import { buildHistory } from "./botHistory"
import { TRIBES } from "../../src/constants/tribes";
import { scrollBehavior } from "../../src/hooks/useReducedMotion";
import { apiGet, apiPost, apiStream } from "../../utils/apiClient";
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

// 剩餘次數 ≤ 這個數字時改用提醒樣式並讓報讀器念出來；平常不打擾
const LOW_QUOTA = 5;

// 串流中離底部多遠以內才自動跟著捲動（像素）；超過代表使用者正在往上看舊訊息
const STREAM_FOLLOW_PX = 120;

const INTERRUPTED_TEXT = {
    stopped: "已停止回覆",
    failed: "回覆中斷了",
};

// 後端只會在 tracked 為 true 時給可信的剩餘次數（計數失敗而放行時為 false，這時不顯示）
const readQuota = (raw) => {
    if (!raw || raw.tracked === false || !Number.isFinite(Number(raw.remaining))) return null;
    return { remaining: Math.max(0, Number(raw.remaining)), resetsAt: raw.resetsAt ?? null };
};

// 重置時間一律是台灣午夜；用台灣時區格式化，人在國外也看到同一個時間
const resetTimeText = (iso) => {
    const date = iso ? new Date(iso) : null;
    if (!date || Number.isNaN(date.getTime())) return "台灣時間 00:00";
    return `台灣時間 ${date.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" })}`;
};

const quotaMessage = (quota) => `今天的提問次數已用完，${resetTimeText(quota?.resetsAt)}重置。`;

// 右下角懸浮聊天視窗（類似 Messenger）：非 modal，背景頁面仍可操作。
// open=false 時視窗收合但保持掛載，對話內容與進行中的請求都不會遺失。
const AIAssistantOverlay = ({ onClose, open = true, returnFocusRef = null }) => {
    const navigate = useNavigate();
    const disclaimerId = useId();
    // 直接從網址進到 /bot（沒有帶 onClose）時用 navigate(-1) 可能把使用者導到
    // 應用程式以外的頁面（例如瀏覽器歷史紀錄的上一頁是外部網站），改成固定
    // 導回測驗首頁，行為可預期。
    const handleClose = onClose ?? (() => navigate("/quiz"));
    const [tribe, setTribe] = useState("tayal");
    // 詞條卡片的發音：整個視窗共用一個播放器，按下新的就停掉舊的
    const { playAudio, failedAudio } = useAuthorizedAudioPlayback();
    // 開場白記錄它是為哪個族語寫的（greetingFor），對話還沒開始時換族語就跟著換
    const [messages, setMessages] = useState([
        { id: 1, text: greetingText("tayal"), role: "bot", greetingFor: "tayal" }
    ]);
    const [input, setInput] = useState("");
    const [isPending, setIsPending] = useState(false);
    const messageEndRef = useRef(null);
    const messagesBoxRef = useRef(null);
    const dialogRef = useRef(null);
    const inputRef = useRef(null);
    const mountedRef = useRef(true);
    const abortControllerRef = useRef(null);
    const sendingRef = useRef(false);
    const quotaLoadedRef = useRef(false);
    // 今天剩餘的提問次數；null＝還不知道（尚未載入、載入失敗，或伺服器沒有可信的計數），這時不顯示也不擋送出
    const [quota, setQuota] = useState(null);
    const quotaUsedUp = quota !== null && quota.remaining === 0;

    // 第一次展開時讀一次剩餘次數（只讀不扣）。失敗就不顯示，剩餘次數是輔助資訊，不能影響提問。
    useEffect(() => {
        if (!open || quotaLoadedRef.current) return;
        quotaLoadedRef.current = true;
        (async () => {
            try {
                const data = await apiGet("/AIModel/quota/");
                if (mountedRef.current) setQuota(readQuota(data));
            } catch {
                quotaLoadedRef.current = false; // 下次展開再試
            }
        })();
    }, [open]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            // 對話框關掉/元件卸載時，還在進行中的請求就不用等了——中止它，
            // 避免回應回來時對著已經卸載的元件呼叫 setMessages/setIsPending。
            abortControllerRef.current?.abort();
            // 還排著的畫面更新也取消，不要對已卸載的元件寫 state
            if (frameRef.current) (window.cancelAnimationFrame ?? clearTimeout)(frameRef.current);
        };
    }, []);

    // 非 modal 的懸浮視窗：不鎖背景、不困住 Tab，只在焦點位於視窗內時 Esc 才收合，
    // 開啟時焦點直接放在輸入框，收合後焦點回到右下角的啟動鈕。
    useDialog(dialogRef, { active: open, onClose: handleClose, initialFocusRef: inputRef, modal: false, returnFocusRef });

    // 新訊息或「輸入中」指示器出現/消失時自動捲到底部，messageEndRef 原本宣告了
    // 卻從沒呼叫 scrollIntoView，訊息一多使用者得自己手動往下滑。
    useEffect(() => {
        if (messages.some((m) => m.streaming)) {
            // 串流中文字一直在長：用即時捲動（平滑捲動會一直被打斷、追不上），
            // 而且使用者往上翻舊訊息時不要把畫面拉回底部。
            const box = messagesBoxRef.current;
            if (box && box.scrollHeight - box.scrollTop - box.clientHeight > STREAM_FOLLOW_PX) return;
            messageEndRef.current?.scrollIntoView({ behavior: "auto" });
            return;
        }
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

    // 串流回覆時文字是一小段一小段進來的，累積在 ref 裡，每個畫面更新週期才寫進 state 一次，
    // 避免每個片段都重新渲染整份對話。
    const streamTextRef = useRef("");
    const frameRef = useRef(0);
    const stoppedRef = useRef(false);
    const lastUserTextRef = useRef("");

    // 下面三個函式只在事件與串流回呼裡執行（不在渲染期間），ref 的寫入是刻意的；
    // react-hooks/immutability 無法分辨回呼與渲染期間的呼叫，會誤報。
    /* eslint-disable react-hooks/immutability */
    const flushStream = (id) => {
        frameRef.current = 0;
        const text = streamTextRef.current;
        setMessages((prev) => (prev.some((m) => m.id === id)
            ? prev.map((m) => (m.id === id ? { ...m, text } : m))
            : [...prev, { id, role: "bot", text, streaming: true }]));
    };

    const pushDelta = (id, piece) => {
        streamTextRef.current += piece;
        if (!frameRef.current) {
            const schedule = window.requestAnimationFrame ?? ((cb) => setTimeout(cb, 16));
            frameRef.current = schedule(() => flushStream(id));
        }
    };

    const cancelPendingFlush = () => {
        if (frameRef.current) {
            (window.cancelAnimationFrame ?? clearTimeout)(frameRef.current);
            frameRef.current = 0;
        }
    };
    /* eslint-enable react-hooks/immutability */

    // 回覆沒有完整結束（使用者按停止，或中途斷線）：已經顯示的文字留著，但標成「中斷」。
    // 這則沒有後端的簽章，所以不會被當成對話記憶送回去（botHistory.js 只收有簽章的助手訊息）。
    const markInterrupted = (id, reason) => {
        cancelPendingFlush();
        const text = streamTextRef.current;
        setMessages((prev) => {
            if (text === "") {
                return reason === "stopped"
                    ? [...prev, { id, role: "bot", text: "已停止回覆。", isError: true }]
                    : prev;
            }
            const finished = { id, role: "bot", text, interrupted: reason };
            return prev.some((m) => m.id === id)
                ? prev.map((m) => (m.id === id ? { ...m, ...finished, streaming: false } : m))
                : [...prev, finished];
        });
        if (text !== "" && reason !== "stopped") announce("回覆中斷，可以按重試再問一次", { assertive: true });
    };

    // 傳送訊息。retry：重送上一句（中斷的那則回覆會被拿掉，使用者的問題不重複顯示）。
    const send = async (text, { retry = false } = {}) => {
        // isPending 是 state，同一個事件迴圈內連按兩次還看不到更新，用 ref 同步擋住重複送出
        if (text.trim() === "" || isPending || sendingRef.current || quotaUsedUp) return;
        sendingRef.current = true;

        // 送出鈕與輸入框都不再用 disabled 擋住等待中的狀態（disabled 會讓焦點掉回 body，
        // 每則訊息都得重新點輸入框），改成 aria-disabled / aria-busy，並把焦點留在輸入框（審查項 P1-6）。
        inputRef.current?.focus({ preventScroll: true });
        const userText = text;
        lastUserTextRef.current = userText;
        stoppedRef.current = false;
        streamTextRef.current = "";
        const history = buildHistory(messages.filter((m) => !m.interrupted));
        if (retry) {
            setMessages((prev) => prev.filter((m) => !m.interrupted));
        } else {
            setMessages(prev => [...prev, { id: crypto.randomUUID(), text: userText, role: "user" }]);
            setInput("");
        }
        setIsPending(true);

        const controller = new AbortController();
        abortControllerRef.current = controller;
        const streamUrl = import.meta.env.VITE_API_AI_BOT_STREAM_URL;
        const botId = crypto.randomUUID();

        try {
            const body = { message: userText, tribe, history };
            const data = streamUrl
                ? await apiStream(streamUrl, body, { signal: controller.signal, onDelta: (piece) => pushDelta(botId, piece) })
                : await apiPost(import.meta.env.VITE_API_AI_BOT_URL, body, { signal: controller.signal });
            if (!mountedRef.current) return;

            cancelPendingFlush();
            const botResponse = {
                id: botId,
                // 以後端的 done 事件為準：串流中已顯示的文字若和它不同（例如拒答），這裡會整個換成它
                text: data?.message || "很抱歉，沒有取得有效的回應。",
                role: "bot",
                studyPlan: data?.study_plan || null,
                sig: data?.sig || "", // 助手回覆的簽章，下次送對話紀錄時帶回，見 botHistory.js
                isRefusal: data?.refused === true, // 模型拒答：固定說明，不是錯誤，樣式上區分
                // 這則回覆提到、而且辭典查到的詞條（後端 entries.py）；連結要用「提問當下」的族語，之後換族語不影響舊訊息
                entries: Array.isArray(data?.entries) && data.entries.length > 0 ? data.entries : null,
                entriesTribe: tribe,
                // 回覆裡辭典查無的詞形（後端 validators.py）；只提醒，不改回覆
                unverified: Array.isArray(data?.unverified) && data.unverified.length > 0 ? data.unverified : null,
            };

            const alreadyShown = streamTextRef.current !== "";
            setMessages(prev => (prev.some((m) => m.id === botId)
                ? prev.map((m) => (m.id === botId ? botResponse : m))
                : [...prev, botResponse]));
            // 串流中的氣泡對報讀器是隱藏的（避免每個字都被念一次），完成後念一次完整內容；
            // 沒有串流過的回覆（讀書計畫、固定說明）是新增的訊息，對話紀錄區會自己念。
            if (alreadyShown) announce(botResponse.text);
            if (data && "quota" in data) setQuota(readQuota(data.quota));
        } catch (error) {
            if (controller.signal.aborted) {
                // 離開頁面／卸載：不用再顯示任何東西。使用者自己按了停止：保留已經收到的文字。
                if (mountedRef.current && stoppedRef.current) markInterrupted(botId, "stopped");
                return;
            }
            if (!mountedRef.current) return;

            // 串流中途斷線或後端回報失敗，而且已經顯示了一部分：保留文字並提供重試
            if (streamTextRef.current !== "") {
                markInterrupted(botId, "failed");
                console.error("串流回覆中斷:", error);
                return;
            }
            cancelPendingFlush();

            // 管理者關閉了 AI 助手（總開關）：後端用 code 明確標示，照它給的說明顯示，
            // 不要讓人以為是自己網路的問題；其他 403（例如代理層擋下）仍走通用訊息
            const serviceOff = error?.status === 403 && error?.data?.code === "ai_assistant_disabled";
            // 今天的提問次數用完：後端回 429 並附上最新的額度，照它的重置時間說明
            const quotaExceeded = error?.status === 429 && error?.data?.code === "ai_daily_quota_exceeded";
            if (quotaExceeded) setQuota(readQuota(error.data.quota) ?? { remaining: 0, resetsAt: null });
            const errorResponse = {
                id: crypto.randomUUID(),
                text: serviceOff
                    ? (error?.data?.detail || "AI 助手目前暫停服務，請稍後再試。")
                    : quotaExceeded
                        ? quotaMessage(readQuota(error.data.quota))
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

    const handleSend = () => send(input);
    const handleRetry = () => send(lastUserTextRef.current, { retry: true });

    // 停止串流：中止請求，後端偵測到連線關閉就會中止對模型的串流
    const handleStop = () => {
        stoppedRef.current = true;
        abortControllerRef.current?.abort();
        // 「停止」鈕馬上會被「發送」鈕取代；焦點先回到輸入框，不然鍵盤使用者的焦點會掉到頁面最上面
        inputRef.current?.focus({ preventScroll: true });
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
                <div ref={messagesBoxRef} className="messages-container" role="log" aria-live="polite" aria-relevant="additions" aria-label="對話紀錄">
                    {messages.map((message, index) => (
                        <div key={message.id} className={`bot-message ${message.role}`}>
                            {message.role === "bot" && (
                                <div className="avatar-small">
                                    <Bot />
                                </div>
                            )}
                            <div
                                className="message-bubble"
                                data-kind={message.isRefusal ? "refusal" : message.interrupted ? "interrupted" : undefined}
                                aria-busy={message.streaming || undefined}
                            >
                                {/* 串流中對報讀器隱藏：文字每幾十毫秒長一點，逐段念出來只是噪音；完成後由 announce 念一次完整內容 */}
                                <p aria-hidden={message.streaming || undefined}>{message.text}</p>
                                {message.streaming && <span className="visually-hidden">助手正在回覆</span>}
                                {message.interrupted && (
                                    <div className="bot-interrupted">
                                        <span>{INTERRUPTED_TEXT[message.interrupted]}</span>
                                        {index === messages.length - 1 && !isPending && !quotaUsedUp && (
                                            <button type="button" className="bot-retry" onClick={handleRetry}>重試</button>
                                        )}
                                    </div>
                                )}
                                {message.entries && (
                                    <WordEntryCards
                                        entries={message.entries}
                                        tribe={message.entriesTribe}
                                        playAudio={playAudio}
                                        failedAudio={failedAudio}
                                    />
                                )}
                                {message.unverified && (
                                    <UnverifiedWordsNote words={message.unverified} tribe={message.entriesTribe} />
                                )}
                                {message.studyPlan && (
                                    <StudyPlanComponent plan={message.studyPlan} onClose={handleClose} />
                                )}
                            </div>
                        </div>
                    ))}
                    {isPending && !messages.some((m) => m.streaming) && (
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

                {quota && (
                    <p
                        className="bot-quota"
                        data-state={quotaUsedUp ? "empty" : quota.remaining <= LOW_QUOTA ? "low" : "ok"}
                        role={quota.remaining <= LOW_QUOTA ? "status" : undefined}
                    >
                        {quotaUsedUp
                            ? quotaMessage(quota)
                            : `今天還可以問 ${quota.remaining} 次`}
                    </p>
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
                        placeholder={quotaUsedUp ? "今天的提問次數已用完" : "輸入您的訊息..."}
                        className="message-input"
                        aria-label="輸入訊息"
                        aria-describedby={disclaimerId}
                        aria-busy={isPending}
                    />
                    {isPending && import.meta.env.VITE_API_AI_BOT_STREAM_URL ? (
                        // 回覆進行中，同一個位置變成「停止」：不必找別的按鈕，也不會誤按到發送
                        <button type="button" className="send-button stop" onClick={handleStop}>
                            停止
                        </button>
                    ) : (
                        <button
                            type="button"
                            className={`send-button ${input.trim() && !isPending && !quotaUsedUp ? 'active' : ''}`}
                            onClick={handleSend}
                            aria-disabled={input.trim() === "" || isPending || quotaUsedUp}
                        >
                            發送
                        </button>
                    )}
                </div>
            </div>
        </div >
    );
};
export default AIAssistantOverlay;
