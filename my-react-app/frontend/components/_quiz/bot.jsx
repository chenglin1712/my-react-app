import "../../static/css/_quiz/bot.css"
import { useId, useState, useRef, useEffect } from "react";
import { Bot, Camera, ChevronDown, SquarePen, X } from "lucide-react"
import { useNavigate } from "react-router-dom";
import StudyPlanComponent from "./bot_study_plan"
import TrackedStudyPlan from "./TrackedStudyPlan";
import WeeklyDigestCard from "../WeeklyDigestCard";
import WordEntryCards from "./WordEntryCards"
import SourceLinks from "./SourceLinks";
import { cleanSources } from "../../utils/cleanSources";
import UnverifiedWordsNote from "./UnverifiedWordsNote"
import useAuthorizedAudioPlayback from "../../hooks/useAuthorizedAudioPlayback";
import { buildHistory } from "./botHistory"
import { prepareChatImage, ChatImageError, DEFAULT_IMAGE_PROMPT, IMAGE_ERROR_TEXT } from "./chatImage"
import { TRIBES } from "../../src/constants/tribes";
import { scrollBehavior } from "../../src/hooks/useReducedMotion";
import { apiGet, apiPost, apiStream } from "../../utils/apiClient";
import BotFeedback from "./BotFeedback";
import BotReplyActions from "./BotReplyActions";
import LightMarkdown from "./LightMarkdown";
import { stripLightMarkdown } from "./markdownBlocks";
import { describeChatError } from "./botErrors";
import { clearConversation, hasConversation, loadConversation, saveConversation, watchUid } from "./botStorage";
import { useDialog } from "@hooks/useDialog";
import { announce } from "@utils/announce";

// 預設的起始建議；後端 /AIModel/quota/ 會依學習資料回傳個人化的三句（#13），讀不到就用這三句
const SUGGESTIONS = [
    "我想了解我的學習狀況",
    "介紹這個族語的文化特色",
    "幫我排一週讀書計畫"
];

const cleanSuggestions = (list) => (Array.isArray(list)
    ? list.filter((s) => typeof s === "string" && s.trim() !== "" && s.length <= 60).slice(0, 3)
    : []);

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
    const tribeRef = useRef(tribe);
    useEffect(() => { tribeRef.current = tribe; }, [tribe]);
    // 詞條卡片的發音：整個視窗共用一個播放器，按下新的就停掉舊的
    const { playAudio, failedAudio } = useAuthorizedAudioPlayback();
    // 開場白記錄它是為哪個族語寫的（greetingFor），對話還沒開始時換族語就跟著換
    const [messages, setMessages] = useState([
        { id: 1, text: greetingText("tayal"), role: "bot", greetingFor: "tayal" }
    ]);
    const [input, setInput] = useState("");
    const [isPending, setIsPending] = useState(false);
    // 對話保存（路線圖 #32）：只存在這台裝置的瀏覽器；uid 取得前（或沒登入）不保存也不還原
    const uidRef = useRef(null);
    const [storageReady, setStorageReady] = useState(false);
    const [accountUid, setAccountUid] = useState(null);       // 給每週摘要卡片用（登入者 uid，沒登入或還不知道＝null）
    const [confirmingNew, setConfirmingNew] = useState(false);
    const cancelNewRef = useRef(null);
    const discardRef = useRef(null);         // 指向 discardInFlight（它定義在後面，登入監聽的 effect 只能經由 ref 呼叫）
    const accountEpochRef = useRef(0);       // 登出或換帳號時加一：舊帳號還沒回來的請求，回來後不能寫進新帳號的畫面
    const touchedRef = useRef(false);        // 使用者已送出訊息或換過族語：還原的舊對話不能再蓋上來
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
    const [starters, setStarters] = useState(SUGGESTIONS);
    const quotaUsedUp = quota !== null && quota.remaining === 0;

    // 圖片提問（路線圖 #24）：後端功能旗標開著才顯示拍照鈕；讀不到就當作沒開
    const [imageEnabled, setImageEnabled] = useState(false);
    // 回覆下方的讚／倒讚（路線圖 #30）：後端旗標沒開就不顯示
    const [feedbackEnabled, setFeedbackEnabled] = useState(false);
    // 讀書計畫重排（路線圖 #26）：後端旗標沒開就不顯示「請助手重排」；勾選進度不受旗標影響
    const [planReplanEnabled, setPlanReplanEnabled] = useState(false);
    const [trackedPlanKey, setTrackedPlanKey] = useState(0);      // 剛按了「開始追蹤」：通知追蹤區重新讀取並展開
    // 準備送出的圖片 { media_type, data, previewUrl }；只在記憶體裡，送出後由訊息泡泡的縮圖接手預覽網址
    const [attachment, setAttachment] = useState(null);
    const [attachBusy, setAttachBusy] = useState(false);
    const [attachError, setAttachError] = useState("");
    const fileInputRef = useRef(null);
    const attachButtonRef = useRef(null);
    const previewUrlsRef = useRef(new Set());
    const lastAttachmentRef = useRef(null);

    // 第一次展開時讀一次剩餘次數（只讀不扣）。失敗就不顯示，剩餘次數是輔助資訊，不能影響提問。
    useEffect(() => {
        if (!open || quotaLoadedRef.current) return;
        quotaLoadedRef.current = true;
        (async () => {
            try {
                const data = await apiGet("/AIModel/quota/");
                if (mountedRef.current) {
                    setQuota(readQuota(data));
                    setImageEnabled(data?.features?.imageInput === true);
                    setFeedbackEnabled(data?.features?.feedback === true);
                    setPlanReplanEnabled(data?.features?.planReplan === true);
                    const personal = cleanSuggestions(data?.suggestions);
                    if (personal.length > 0) setStarters(personal);
                }
            } catch {
                quotaLoadedRef.current = false; // 下次展開再試
            }
        })();
    }, [open]);

    // 開啟時還原這台裝置上最近一次的對話（7 天內）。使用者若已經開始送出訊息，就不覆蓋。
    useEffect(() => {
        let active = true;
        const stop = watchUid((uid) => {
            if (!active || uid === uidRef.current) return;
            const switched = uidRef.current !== null;      // 不是第一次解析出 uid：登出或換了帳號
            uidRef.current = uid;
            setAccountUid(uid);
            setStorageReady(false);                        // 先停止寫入，避免把上一位的對話存到新帳號
            if (switched) {
                // 上一位的對話不能留在畫面上，也不能帶進新帳號的請求
                discardRef.current?.();
                setConfirmingNew(false);                   // 上一位開著的「新對話」確認不能留到新帳號
                touchedRef.current = false;
                setMessages([{ id: crypto.randomUUID(), text: greetingText(tribeRef.current), role: "bot", greetingFor: tribeRef.current }]);
                setInput("");
                setAttachment(null);
            }
            if (!uid) return;
            const saved = loadConversation(uid);
            // 還原期間使用者已經送出訊息（或換了族語）就不覆蓋，族語也不能單獨換掉
            if (saved && !touchedRef.current) {
                setMessages(saved.messages);
                if (TRIBES.some((t) => t.slug === saved.tribe)) setTribe(saved.tribe);
                // 使用者可能已經開始打字：對話突然出現要讓他知道，輸入框裡的草稿則維持原樣
                announce("已還原先前的對話");
            }
            setStorageReady(true);
        });
        return () => { active = false; stop(); };
    }, []);

    // 視窗收合時，沒做完的「新對話」確認不留到下次打開
    useEffect(() => { if (!open) setConfirmingNew(false); }, [open]);

    // 對話有變動（且不在等待回覆）就存起來；只剩開場白時會刪除保存的內容
    useEffect(() => {
        if (!storageReady || isPending || !uidRef.current) return;
        saveConversation(uidRef.current, { tribe, messages });
    }, [messages, tribe, isPending, storageReady]);

    useEffect(() => {
        mountedRef.current = true;
        const previewUrls = previewUrlsRef.current;     // 同一個 Set 一直沿用，不會被換掉
        return () => {
            mountedRef.current = false;
            // 對話框關掉/元件卸載時，還在進行中的請求就不用等了——中止它，
            // 避免回應回來時對著已經卸載的元件呼叫 setMessages/setIsPending。
            abortControllerRef.current?.abort();
            // 還排著的畫面更新也取消，不要對已卸載的元件寫 state
            if (frameRef.current) (window.cancelAnimationFrame ?? clearTimeout)(frameRef.current);
            // 圖片只存在這個視窗的記憶體裡：關掉視窗時釋放所有預覽網址
            previewUrls.forEach((url) => URL.revokeObjectURL(url));
            previewUrls.clear();
        };
    }, []);

    // 非 modal 的懸浮視窗：不鎖背景、不困住 Tab，只在焦點位於視窗內時 Esc 才收合，
    // 開啟時焦點直接放在輸入框，收合後焦點回到右下角的啟動鈕。
    useDialog(dialogRef, { active: open, onClose: () => (confirmingNew ? cancelNewConversation() : handleClose()), initialFocusRef: inputRef, modal: false, returnFocusRef });

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
        touchedRef.current = true;
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

    // 換帳號／登出：作廢還在進行的請求（中止、取消排著的畫面更新、解除等待狀態）
    const discardInFlight = () => {
        accountEpochRef.current += 1;
        abortControllerRef.current?.abort();
        cancelPendingFlush();
        streamTextRef.current = "";
        sendingRef.current = false;
        setIsPending(false);
    };
    /* eslint-enable react-hooks/immutability */
    useEffect(() => { discardRef.current = discardInFlight; });

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

    // 預覽網址若還被某則訊息的縮圖用著就不釋放（否則那張縮圖會破掉）；視窗關閉時才統一釋放
    const releasePreview = (url) => {
        if (!url || messages.some((m) => m.imageUrl === url)) return;
        URL.revokeObjectURL(url);
        previewUrlsRef.current.delete(url);
    };

    const handleAttachClick = () => {
        if (isPending || attachBusy || quotaUsedUp) return;
        fileInputRef.current?.click();
    };

    // 選好檔案：在瀏覽器縮圖、轉 JPEG；失敗時說明原因，不送出任何東西
    const handleFileChosen = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = ""; // 同一張圖可以再選一次
        if (!file) return;
        setAttachError("");
        setAttachBusy(true);
        try {
            const prepared = await prepareChatImage(file);
            if (!mountedRef.current) {
                URL.revokeObjectURL(prepared.previewUrl);
                return;
            }
            previewUrlsRef.current.add(prepared.previewUrl);
            releasePreview(attachment?.previewUrl);
            setAttachment(prepared);
            announce("已附上圖片");
        } catch (error) {
            if (mountedRef.current) {
                setAttachError(error instanceof ChatImageError ? error.message : IMAGE_ERROR_TEXT.decode_failed);
            }
        } finally {
            if (mountedRef.current) setAttachBusy(false);
        }
    };

    const handleRemoveAttachment = () => {
        releasePreview(attachment?.previewUrl);
        setAttachment(null);
        setAttachError("");
        announce("已移除圖片");
        attachButtonRef.current?.focus({ preventScroll: true }); // 移除鈕會消失，焦點交還給拍照鈕
    };

    // 傳送訊息。retry：重送上一句（中斷的那則回覆會被拿掉，使用者的問題不重複顯示）。
    // regenerate：對最後一個問題重新要一次回覆，舊的回覆會被取代（不是疊在後面），也不會算進這次的對話記憶。
    const send = async (text, { retry = false, regenerate = false } = {}) => {
        const resend = retry || regenerate;
        const sendingImage = resend ? lastAttachmentRef.current : attachment;
        // isPending 是 state，同一個事件迴圈內連按兩次還看不到更新，用 ref 同步擋住重複送出
        if ((text.trim() === "" && !sendingImage) || isPending || sendingRef.current || attachBusy || quotaUsedUp) return;
        sendingRef.current = true;
        touchedRef.current = true;

        // 送出鈕與輸入框都不再用 disabled 擋住等待中的狀態（disabled 會讓焦點掉回 body，
        // 每則訊息都得重新點輸入框），改成 aria-disabled / aria-busy，並把焦點留在輸入框（審查項 P1-6）。
        inputRef.current?.focus({ preventScroll: true });
        // 只附圖片沒打字時，用預設的辨識問題（後端的 message 不能是空的）
        const userText = text.trim() === "" ? DEFAULT_IMAGE_PROMPT : text;
        lastUserTextRef.current = userText;
        lastAttachmentRef.current = sendingImage;
        stoppedRef.current = false;
        streamTextRef.current = "";
        const lastUserIndex = messages.map((m) => m.role).lastIndexOf("user");
        // 重新產生時，上一輪（問題與它的回覆）不能當成對話記憶送回去，否則模型會看到自己剛被否決的答案
        const base = regenerate ? messages.slice(0, lastUserIndex) : messages;
        const history = buildHistory(base.filter((m) => !m.interrupted));
        if (regenerate) {
            setMessages((prev) => prev.slice(0, prev.map((m) => m.role).lastIndexOf("user") + 1));
        } else if (retry) {
            // 只拿掉這次要重試的那則（最後一則）；更早的失敗或中斷紀錄是對話歷史，不能跟著消失
            setMessages((prev) => (prev.length > 0 && (prev[prev.length - 1].interrupted || prev[prev.length - 1].retryable) ? prev.slice(0, -1) : prev));
            // 失敗時圖片被放回輸入區；這次重試直接重送它，輸入區那份就不用留了
            if (sendingImage) setAttachment((prev) => (prev === sendingImage ? null : prev));
        } else {
            setMessages(prev => [...prev, {
                id: crypto.randomUUID(), text: userText, role: "user", imageUrl: sendingImage?.previewUrl ?? null,
            }]);
            setInput("");
            setAttachment(null);
            setAttachError("");
        }
        setIsPending(true);

        const controller = new AbortController();
        abortControllerRef.current = controller;
        const epoch = accountEpochRef.current;
        const streamUrl = import.meta.env.VITE_API_AI_BOT_STREAM_URL;
        const botId = crypto.randomUUID();

        try {
            const body = {
                message: userText, tribe, history,
                ...(sendingImage && { image: { media_type: sendingImage.media_type, data: sendingImage.data } }),
            };
            const data = streamUrl
                ? await apiStream(streamUrl, body, { signal: controller.signal, onDelta: (piece) => pushDelta(botId, piece) })
                : await apiPost(import.meta.env.VITE_API_AI_BOT_URL, body, { signal: controller.signal });
            if (!mountedRef.current || epoch !== accountEpochRef.current) return;

            cancelPendingFlush();
            const botResponse = {
                id: botId,
                // 以後端的 done 事件為準：串流中已顯示的文字若和它不同（例如拒答），這裡會整個換成它
                text: data?.message || "很抱歉，沒有取得有效的回應。",
                role: "bot",
                studyPlan: data?.study_plan || null,
                sig: data?.sig || "", // 助手回覆的簽章，下次送對話紀錄時帶回，見 botHistory.js
                meta: data?.meta || null, // 這則回覆用的模型、提示詞版本、request id，回饋時帶回去
                isRefusal: data?.refused === true, // 模型拒答：固定說明，不是錯誤，樣式上區分
                // 這則回覆提到、而且辭典查到的詞條（後端 entries.py）；連結要用「提問當下」的族語，之後換族語不影響舊訊息
                entries: Array.isArray(data?.entries) && data.entries.length > 0 ? data.entries : null,
                entriesTribe: tribe,
                // 回覆裡辭典查無的詞形（後端 validators.py）；只提醒，不改回覆
                unverified: Array.isArray(data?.unverified) && data.unverified.length > 0 ? data.unverified : null,
                // 接著可以問的建議（後端用模板產生，#13）；只在這則是最後一則時顯示
                followups: cleanSuggestions(data?.followups),
                // 官方網站查證引用的來源（#19）；只收 https 網址，沒有就是 null
                sources: cleanSources(data?.sources).length > 0 ? cleanSources(data.sources) : null,
            };

            const alreadyShown = streamTextRef.current !== "";
            setMessages(prev => (prev.some((m) => m.id === botId)
                ? prev.map((m) => (m.id === botId ? botResponse : m))
                : [...prev, botResponse]));
            // 串流中的氣泡對報讀器是隱藏的（避免每個字都被念一次），完成後念一次完整內容；
            // 沒有串流過的回覆（讀書計畫、固定說明）是新增的訊息，對話紀錄區會自己念。
            if (alreadyShown) announce(stripLightMarkdown(botResponse.text));
            if (data && "quota" in data) setQuota(readQuota(data.quota));
        } catch (error) {
            if (epoch !== accountEpochRef.current) return;      // 舊帳號的請求，結果與錯誤都不屬於現在的畫面
            if (controller.signal.aborted) {
                // 離開頁面／卸載：不用再顯示任何東西。使用者自己按了停止：保留已經收到的文字。
                if (mountedRef.current && stoppedRef.current) markInterrupted(botId, "stopped");
                return;
            }
            if (!mountedRef.current) return;

            // 串流中途斷線或後端回報失敗，而且已經顯示了一部分：保留文字並提供重試
            if (streamTextRef.current !== "") {
                markInterrupted(botId, "failed");
                // 串流中途收到的失敗也要照類型處理：額度用完要更新額度，重試不會有用的不再給重試鈕
                const partial = describeChatError(error);
                if (partial.kind === "quota") setQuota(readQuota(error.data?.quota) ?? { remaining: 0, resetsAt: null });
                if (!partial.retryable) setMessages((prev) => prev.map((m) => (m.id === botId ? { ...m, noRetry: true } : m)));
                console.error("串流回覆中斷:", error);
                return;
            }
            cancelPendingFlush();

            // 依錯誤類型說明並決定要不要給「重試」（botErrors.js）。額度用完要用後端給的最新額度與重置時間說明。
            const info = describeChatError(error, { image: !!sendingImage });
            if (info.kind === "quota") setQuota(readQuota(error.data.quota) ?? { remaining: 0, resetsAt: null });
            if (info.kind === "image_off") setImageEnabled(false);
            // 沒有成功送達：把圖片放回輸入區，學生補一句話或直接再送一次，不用重拍
            // （功能被關閉時不放回：留著只會讓學生一直重送一張必定被拒絕的圖）
            if (sendingImage && !resend && info.kind !== "image_off") setAttachment((prev) => prev ?? sendingImage);
            const errorResponse = {
                id: crypto.randomUUID(),
                text: info.kind === "quota" ? quotaMessage(readQuota(error.data.quota)) : info.text,
                role: "bot",
                isError: true,
                retryable: info.retryable,
            };
            setMessages(prev => [...prev, errorResponse]);
            console.error("取得回應失敗:", error);
        } finally {
            if (epoch === accountEpochRef.current) {
                sendingRef.current = false;
                if (mountedRef.current) setIsPending(false);
            }
        }
    };

    const handleSend = () => send(input);
    const handleRetry = () => send(lastUserTextRef.current, { retry: true });

    // 重新產生最後一則回覆：問題文字取自畫面上最後一個使用者訊息（重新整理還原後 ref 是空的）
    const handleRegenerate = () => {
        const lastUser = [...messages].reverse().find((m) => m.role === "user");
        if (lastUser) send(lastUser.text, { regenerate: true });
    };

    // 新對話：刪除這台裝置上保存的對話並回到開場白。沒有聊過就不需要確認；聊過了先確認，因為刪除後無法復原。
    const handleNewConversation = () => {
        if (isPending) return;
        if (!hasConversation(messages)) return;
        setConfirmingNew(true);
        announce("開始新對話會刪除目前的對話，無法復原。請確認。");
        setTimeout(() => cancelNewRef.current?.focus({ preventScroll: true }), 0);
    };

    const confirmNewConversation = () => {
        clearConversation(uidRef.current);
        setConfirmingNew(false);
        setMessages([{ id: crypto.randomUUID(), text: greetingText(tribe), role: "bot", greetingFor: tribe }]);
        setInput("");
        setAttachment(null);
        setAttachError("");
        lastUserTextRef.current = "";
        lastAttachmentRef.current = null;
        announce("已開始新對話，先前的對話已刪除");
        inputRef.current?.focus({ preventScroll: true });
    };

    const cancelNewConversation = () => {
        setConfirmingNew(false);
        inputRef.current?.focus({ preventScroll: true });
    };

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

    // 起始建議（還沒聊幾句）或上一則回覆帶來的後續建議；兩者都沒有就不顯示建議區
    const lastMessage = messages[messages.length - 1];
    const followups = lastMessage?.role === "bot" && !lastMessage.streaming && !lastMessage.interrupted && !lastMessage.isError
        && Array.isArray(lastMessage.followups) ? lastMessage.followups : [];
    const suggestionList = messages.length <= 2 ? starters : followups;

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
                    <button
                        type="button"
                        className="chat-new"
                        onClick={handleNewConversation}
                        aria-label="新對話"
                        title="新對話"
                        aria-disabled={isPending || !hasConversation(messages) || undefined}
                    >
                        <SquarePen size={20} aria-hidden="true" />
                    </button>
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

                {confirmingNew && (
                    <div className="bot-confirm" role="group" aria-label="確認開始新對話">
                        <p>開始新對話會刪除目前的對話，無法復原。</p>
                        <div className="bot-confirm-actions">
                            <button type="button" className="bot-confirm-danger" onClick={confirmNewConversation}>刪除並開始新對話</button>
                            <button type="button" ref={cancelNewRef} className="bot-confirm-cancel" onClick={cancelNewConversation}>取消</button>
                        </div>
                    </div>
                )}

                <WeeklyDigestCard variant="bot" uid={accountUid} />
                <TrackedStudyPlan
                    refreshKey={trackedPlanKey}
                    replanEnabled={planReplanEnabled}
                    tribe={tribe}
                    onQuota={(raw) => setQuota(readQuota(raw))}
                />

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
                                {message.imageUrl && (
                                    <img className="bot-message-image" src={message.imageUrl} alt="你附上的圖片" />
                                )}
                                {/* 串流中對報讀器隱藏：文字每幾十毫秒長一點，逐段念出來只是噪音；完成後由 announce 念一次完整內容 */}
                                {message.role === "bot" && !message.isError
                                    ? <LightMarkdown text={message.text} aria-hidden={message.streaming || undefined} />
                                    : <p aria-hidden={message.streaming || undefined}>{message.text}</p>}
                                {message.streaming && <span className="visually-hidden">助手正在回覆</span>}
                                {message.isError && message.retryable && index === messages.length - 1 && !isPending && !quotaUsedUp && (
                                    <div className="bot-interrupted">
                                        <button type="button" className="bot-retry" onClick={handleRetry}>重試</button>
                                    </div>
                                )}
                                {message.interrupted && (
                                    <div className="bot-interrupted">
                                        <span>{INTERRUPTED_TEXT[message.interrupted]}</span>
                                        {index === messages.length - 1 && !isPending && !quotaUsedUp && !message.noRetry && (
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
                                {message.sources && <SourceLinks sources={message.sources} />}
                                {message.studyPlan && (
                                    <StudyPlanComponent plan={message.studyPlan} onClose={handleClose} onTracked={() => setTrackedPlanKey((key) => key + 1)} />
                                )}
                                {message.role === "bot" && message.sig && !message.streaming && !message.interrupted && (() => {
                                    const precedingUser = messages.slice(0, index).reverse().find((m) => m.role === "user");
                                    const actions = (
                                        <BotReplyActions
                                            text={stripLightMarkdown(message.text)}
                                            // 只有最後一則回覆能重新產生，而且那一輪不能是附過圖片的（還原後圖片已不在）
                                            canRegenerate={index === messages.length - 1 && !!precedingUser && !precedingUser.hadImage && !precedingUser.imageUrl}
                                            onRegenerate={handleRegenerate}
                                            disabled={isPending || quotaUsedUp}
                                        />
                                    );
                                    return feedbackEnabled ? (
                                        <BotFeedback
                                            question={precedingUser?.text || ""}
                                            reply={message.text}
                                            sig={message.sig}
                                            meta={message.meta}
                                            tribe={message.entriesTribe || tribe}
                                            leading={actions}
                                        />
                                    ) : (
                                        <div className="bot-feedback"><div className="bot-feedback-row">{actions}</div></div>
                                    );
                                })()}
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

                {suggestionList.length > 0 && (
                    <div className="suggestions-container">
                        <p className="suggestions-title">您可能想問：</p>
                        <div className="suggestion-pills">
                            {suggestionList.map((suggestion, index) => (
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
                <p className="bot-disclaimer" id={disclaimerId}>AI 可能寫錯族語的詞彙或拼寫，學習時請以族語辭典為準。{storageReady && " 對話只暫存在這台裝置的瀏覽器 7 天，按上方「新對話」可刪除。"}</p>
                {(attachment || attachBusy || attachError) && (
                    <div className="bot-attachment" data-state={attachError ? "error" : attachBusy ? "busy" : "ready"}>
                        {attachment && (
                            <>
                                <img className="bot-attachment-thumb" src={attachment.previewUrl} alt="準備送出的圖片預覽" />
                                <span className="bot-attachment-label">已附上圖片，可以補充想問的問題</span>
                                <button
                                    type="button"
                                    className="bot-attachment-remove"
                                    onClick={handleRemoveAttachment}
                                    disabled={isPending}
                                    aria-label="移除圖片"
                                >
                                    <X size={18} aria-hidden="true" />
                                </button>
                            </>
                        )}
                        {attachBusy && <span className="bot-attachment-label" role="status">正在處理圖片…</span>}
                        {attachError && <span className="bot-attachment-label" role="alert">{attachError}</span>}
                    </div>
                )}
                <div className="input-area">
                    {imageEnabled && (
                        <>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                className="visually-hidden"
                                tabIndex={-1}
                                aria-hidden="true"
                                onChange={handleFileChosen}
                            />
                            <button
                                ref={attachButtonRef}
                                type="button"
                                className="attach-button"
                                onClick={handleAttachClick}
                                aria-label="拍照或選擇圖片"
                                aria-disabled={isPending || attachBusy || quotaUsedUp}
                            >
                                <Camera size={20} aria-hidden="true" />
                            </button>
                        </>
                    )}
                    <input
                        ref={inputRef}
                        type="text"
                        value={input}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        placeholder={quotaUsedUp ? "今天的提問次數已用完" : attachment ? "想問這張圖的什麼？（可不填）" : "輸入您的訊息..."}
                        className="message-input"
                        aria-label="輸入訊息"
                        aria-describedby={disclaimerId}
                        aria-busy={isPending}
                    />
                    {isPending ? (
                        // 回覆進行中，同一個位置變成「停止」：不必找別的按鈕，也不會誤按到發送
                        <button type="button" className="send-button stop" onClick={handleStop}>
                            停止
                        </button>
                    ) : (
                        <button
                            type="button"
                            className={`send-button ${(input.trim() || attachment) && !isPending && !attachBusy && !quotaUsedUp ? 'active' : ''}`}
                            onClick={handleSend}
                            aria-disabled={(input.trim() === "" && !attachment) || isPending || attachBusy || quotaUsedUp}
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
