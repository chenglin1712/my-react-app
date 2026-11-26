import { useEffect, useId, useRef, useState } from "react";
import axios from "axios";
import { Alert } from "react-bootstrap";
import LoadingSpinner from "@components/ui/LoadingSpinner";
import { TranslateResultSkeleton } from "@components/ui/SkeletonShapes";
import { Link } from "react-router-dom";
import { ArrowLeftRight, Copy, Volume2, X } from "lucide-react";
import "../../static/css/_translate/index.css";
import { TRIBES, tribeLangCode } from "../constants/tribes";
import TribeSegmented from "../../components/ui/TribeSegmented";
import CharRing from "../../components/ui/CharRing";
import GroundedLegend from "../../components/_translate/GroundedLegend";
import { announce } from "@utils/announce";
import GroundedText from "../../components/_translate/GroundedText";
import GuestTrialNotice from "../../components/_translate/GuestTrialNotice";
import EvidencePanel from "../../components/_translate/EvidencePanel";
import useAudioPlayback from "../../hooks/useAudioPlayback";
import { useTranslateCapabilities } from "../../hooks/useTranslateCapabilities";
import { useGuestQuota } from "../../hooks/useGuestQuota";
import { useOnlineStatus } from "@hooks/useOnlineStatus";
import OfflineNotice from "@components/ui/OfflineNotice";
import { useAuth } from "../userServives/authContext";
import PermissionProtect from "../userServives/permissionProtect";
import { apiPost } from "../../utils/apiClient";
import { apiUrl } from "../../utils/apiUrls";

const MAX_LEN = 300;
// 接近上限時才顯示「還可以輸入 N 字」，並在越過這條線與到達上限時各公告一次（不是每敲一個字都唸）
const LIMIT_WARN = 270;

const DIRECTIONS = [
    { key: "zh2tribe", sourceLabel: "繁體中文", targetLabel: "族語" },
    { key: "tribe2zh", sourceLabel: "族語", targetLabel: "繁體中文" },
];

const GUEST_LOGIN_NOTE = "發音與詞形分析需要登入，免費註冊後就能使用。";

// 瀏覽器沒有 navigator.clipboard（非 https 或舊瀏覽器）時的備用複製：用暫時的 textarea 加 execCommand
function legacyCopy(text) {
    const previouslyFocused = document.activeElement;
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let ok;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    document.body.removeChild(area);
    // select() 會把焦點搬到暫時的 textarea，移除後要還給原本的按鈕，鍵盤使用者才不會失去位置
    if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus({ preventScroll: true });
    return ok;
}

const SUBMIT_HINT = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "") ? "⌘ + Enter" : "Ctrl + Enter";

const TranslatePage = () => {
    // 訪客（沒登入）可以試用：次數與是否開放由後端決定，這裡只負責顯示與引導註冊
    const { userData, loading: authLoading } = useAuth();
    const isGuest = !authLoading && !userData;
    const guestQuota = useGuestQuota(isGuest);
    const [guestNote, setGuestNote] = useState("");
    const [tribe, setTribe] = useState("tayal");
    const [direction, setDirection] = useState("zh2tribe");
    const [sourceText, setSourceText] = useState("");
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const online = useOnlineStatus();
    const [error, setError] = useState("");
    const [activeTokenIndex, setActiveTokenIndex] = useState(null);
    const [swapNote, setSwapNote] = useState("");
    const textareaRef = useRef(null);
    const pageRef = useRef(null);
    const hintId = useId();
    const countId = useId();
    const limitId = useId();
    const introId = useId();
    const [introOpen, setIntroOpen] = useState(false);
    // Safari 在組字結束的那個 keydown 上 isComposing 已是 false、keyCode 也不是 229，所以另外記組字狀態
    const composingRef = useRef(false);
    const composedJustNowRef = useRef(false);
    const capabilities = useTranslateCapabilities({ guest: true, enabled: !authLoading, refreshKey: userData?.uid ?? null });

    // abortRef 是「目前這一次請求」的 controller；requestGenerationRef 每次取消/
    // 重新發出請求都會遞增，讓被取消的那次請求即使晚一步才真的 reject/resolve，
    // 也不會再去更新 result/error/loading（swap、切族語、unmount 都要能取消
    // 目前這次翻譯，而不是只有重新送出翻譯才取消）。
    const abortRef = useRef(null);
    const requestGenerationRef = useRef(0);
    const { playAudio, playSentence } = useAudioPlayback(tribe, setError);

    const cancelTranslation = () => {
        requestGenerationRef.current += 1;
        abortRef.current?.abort();
        abortRef.current = null;
    };

    // 切換族語：目前這一輪翻譯（不論是否還在等回應）不再適用於新族語，取消並
    // 清空結果，避免舊族語的回應晚一步回來時被當成新族語的翻譯結果顯示。
    useEffect(() => {
        cancelTranslation();
        setLoading(false);
        setResult(null);
        setError("");
        setGuestNote("");
        setSwapNote("");
        setActiveTokenIndex(null);
    }, [tribe]);

    useEffect(() => {
        return () => { abortRef.current?.abort(); };
    }, []);

    // 登入、登出：進行中的請求是以舊身分送出的，結果不能再顯示；登出時連輸入與結果一起清掉，
    // 共用裝置上下一位訪客不該看到前一位登入者翻譯的內容。
    const uid = userData?.uid ?? null;
    const prevUidRef = useRef(uid);
    useEffect(() => {
        const prevUid = prevUidRef.current;
        prevUidRef.current = uid;
        if (prevUid === uid) return;
        cancelTranslation();
        setLoading(false);
        setResult(null);
        setError("");
        setGuestNote("");
        setActiveTokenIndex(null);
        if (prevUid && !uid) setSourceText("");
    }, [uid]);

    // 頂部語言列貼在導覽列下面：導覽列高度會隨寬度改變，所以量出來存成變數（見 index.css 的 .translate-langbar）
    useEffect(() => {
        const nav = document.querySelector("nav.navbar");
        const page = pageRef.current;
        if (!nav || !page || typeof ResizeObserver === "undefined") return undefined;
        const sync = () => page.style.setProperty("--translate-nav-h", `${Math.round(nav.getBoundingClientRect().height)}px`);
        sync();
        const observer = new ResizeObserver(sync);
        observer.observe(nav);
        return () => observer.disconnect();
    }, [authLoading]);

    const currentTribe = TRIBES.find((t) => t.slug === tribe);
    const currentCapability = capabilities?.find((c) => c.tribeSlug === tribe);
    const currentDirection = DIRECTIONS.find((d) => d.key === direction);

    const handleSubmit = async () => {
        const text = sourceText.trim();
        if (!text || loading) return;
        if (isGuest && guestQuota.exhausted) return;

        cancelTranslation();
        const myGeneration = requestGenerationRef.current;
        const controller = new AbortController();
        abortRef.current = controller;

        setLoading(true);
        setError("");
        setGuestNote("");
        setSwapNote("");
        setActiveTokenIndex(null);
        try {
            const data = await apiPost(
                apiUrl('TRANSLATE'),
                { text, tribe, direction },
                { signal: controller.signal, guest: isGuest },
            );
            if (myGeneration !== requestGenerationRef.current) return;
            if (isGuest) guestQuota.applyResponse(data?.guestQuota);
            setResult(data);
            // FE3-07：結果區不是 live region，成功時用全站常駐的公告區唸出「翻譯完成」與佐證概況；
            // 只在這個成功分支呼叫一次（結果被「換成原文」「清除」不會再唸），也不重複公告摘要行。
            const coverage = data?.coverage;
            announce(coverage?.total > 0
                ? `翻譯完成，${coverage.total - (coverage.unsupported ?? 0)}/${coverage.total} 個詞有辭典語料佐證`
                : "翻譯完成");
            // 翻譯的使用紀錄由後端在翻譯成功時自己寫（translation_request）；公開事件端點的白名單
            // 不收 translate_submit，從前端再送一筆只會固定回 400
        } catch (err) {
            if (axios.isCancel(err) || myGeneration !== requestGenerationRef.current) return;
            setResult(null);
            // 額度用完或訪客試用被關閉：由額度提示處理，不再另外顯示紅色錯誤
            if (isGuest && guestQuota.applyError(err)) return;
            setError(err.message || "翻譯失敗，請稍後再試");
        } finally {
            if (myGeneration === requestGenerationRef.current) setLoading(false);
        }
    };

    // Ctrl／⌘ + Enter 送出。輸入法組字中（選字用的 Enter）不當成送出，不然選字會直接把半句話送出去
    const handleKeyDown = (e) => {
        if (composingRef.current || composedJustNowRef.current || e.nativeEvent?.isComposing || e.isComposing || e.keyCode === 229) return;
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            handleSubmit();
        }
    };

    const handleCompositionStart = () => { composingRef.current = true; };
    const handleCompositionEnd = () => {
        composingRef.current = false;
        composedJustNowRef.current = true;
        setTimeout(() => { composedJustNowRef.current = false; }, 0);
    };

    const handleSourceChange = (e) => {
        const next = e.target.value;
        // 越過「快到上限」與「到達上限」這兩條線時各公告一次
        if (sourceText.length < LIMIT_WARN && next.length >= LIMIT_WARN && next.length < MAX_LEN) announce(`還可以輸入 ${MAX_LEN - next.length} 字`);
        else if (sourceText.length < MAX_LEN && next.length >= MAX_LEN) announce(`已達 ${MAX_LEN} 字上限`);
        setSourceText(next);
        setSwapNote("");
    };

    // 清除輸入：連同結果、錯誤與還在等的那次翻譯一起清掉，焦點回到輸入框
    const handleClear = () => {
        cancelTranslation();
        setLoading(false);
        setSourceText("");
        setResult(null);
        setError("");
        setGuestNote("");
        setSwapNote("");
        setActiveTokenIndex(null);
        textareaRef.current?.focus();
    };

    // 交換方向前先取消目前這一輪翻譯：不然中途交換方向，舊方向的回應晚一步
    // 回來時仍會被顯示成「新方向」的翻譯結果（見上方 cancelTranslation 說明）。
    const handleSwap = () => {
        cancelTranslation();
        setLoading(false);
        const nextDirection = direction === "zh2tribe" ? "tribe2zh" : "zh2tribe";
        const next = DIRECTIONS.find((d) => d.key === nextDirection);
        const arrow = `${next.sourceLabel} → ${next.targetLabel}`;
        setDirection(nextDirection);
        setActiveTokenIndex(null);
        // 交換後輸入框一定要和新的「原文」標籤對得上，並明講發生了什麼，不讓人拿舊方向的文字直接送出
        if (result) {
            setSourceText(result.translation);
            setResult(null);
            setSwapNote(`方向已切換為「${arrow}」，已把剛才的翻譯結果放進輸入框。`);
        } else if (sourceText.trim()) {
            setSwapNote(`方向已切換為「${arrow}」。輸入框裡還是原本的文字，請確認內容符合新的方向再翻譯。`);
        } else {
            setSwapNote("");
        }
        textareaRef.current?.focus();
    };

    const [copyStatus, setCopyStatus] = useState("idle"); // idle | copied | error
    const copyStatusTimerRef = useRef(null);
    const handleCopy = () => {
        if (!result) return;
        const fallback = () => setCopyStatus(legacyCopy(result.translation) ? "copied" : "error");
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(result.translation)
                .then(() => setCopyStatus("copied"))
                .catch(fallback);
        } else {
            fallback();
        }
        if (copyStatusTimerRef.current) clearTimeout(copyStatusTimerRef.current);
        copyStatusTimerRef.current = setTimeout(() => setCopyStatus("idle"), 1500);
    };
    useEffect(() => {
        return () => { if (copyStatusTimerRef.current) clearTimeout(copyStatusTimerRef.current); };
    }, []);

    // 發音與詞形分析要登入：訪客點了就說明原因，不要送出一定會失敗的請求
    const handlePlayAudio = isGuest ? () => setGuestNote(GUEST_LOGIN_NOTE) : playAudio;

    const handlePlayResult = () => {
        if (!result) return;
        if (isGuest) {
            setGuestNote(GUEST_LOGIN_NOTE);
            return;
        }
        playSentence(result.translation);
    };

    const activeToken = activeTokenIndex != null ? result?.tokens?.[activeTokenIndex] : null;

    if (authLoading) {
        return (
            <div className="yy-page translate-page">
                <div className="translate-auth-loading" role="status">
                    <LoadingSpinner size="sm" decorative />
                    <span>確認登入狀態…</span>
                </div>
            </div>
        );
    }
    // 後端沒有開放訪客試用（旗標關閉或尚未設定）：維持原本「請先登入」的畫面
    if (isGuest && guestQuota.status === "closed") return <PermissionProtect />;

    return (
        <div className="yy-page translate-page" ref={pageRef}>
            <section className="yy-hero translate-hero">
                <div className="yy-fade-up">
                    <h1 className="translate-title">族語翻譯</h1>
                    {/* 說明收成一行；完整內容用「了解更多」展開，沒有刪減 */}
                    <p className="translate-desc">
                        以辭典語料為依據，逐詞標示有沒有語料佐證。{" "}
                        <button
                            type="button"
                            className="translate-more"
                            aria-expanded={introOpen}
                            aria-controls={introId}
                            onClick={() => setIntroOpen((open) => !open)}
                        >
                            {introOpen ? "收起" : "了解更多"}
                        </button>
                    </p>
                    <p id={introId} className="translate-desc translate-desc-more" hidden={!introOpen}>
                        有佐證只代表這個詞在資料庫裡查得到，不代表整句翻譯一定正確。
                    </p>
                </div>
            </section>

            {/* 頂部語言列：族語分段控制加翻譯方向與互換鈕。桌面貼在導覽列下面；手機不固定（垂直空間不夠） */}
            <div className="translate-langbar yy-glass">
                <div className="translate-langbar-in">
                    <TribeSegmented
                        label="選擇族語"
                        items={TRIBES.map((t) => ({ value: t.slug, label: `${t.name}族語`, color: t.color }))}
                        value={tribe}
                        onChange={setTribe}
                    />
                    <div className="translate-direction" role="group" aria-label="翻譯方向">
                        <span className="translate-dir-label">{currentDirection.sourceLabel}</span>
                        <button
                            type="button"
                            className="translate-swap-btn"
                            aria-label="交換翻譯方向"
                            onClick={handleSwap}
                        >
                            <ArrowLeftRight size={18} aria-hidden="true" />
                        </button>
                        <span className="translate-dir-label">{currentDirection.targetLabel}</span>
                    </div>
                </div>
            </div>

            <section className="yy-hero translate-hero translate-hero--note">
                {currentCapability && (
                    <p className="translate-capability-note yy-fade-up">
                        {currentTribe?.fullName}：辭典收錄 {currentCapability.pairCount.toLocaleString()} 組對照例句、
                        {currentCapability.headwordCount.toLocaleString()} 個詞條
                        {!currentCapability.hasSentenceAudio && "（此族語目前沒有例句真人原音，發音以逐詞串接播放）"}
                    </p>
                )}
            </section>

            <div className="yy-divider" />

            <section className="translate-body">
                {isGuest && <GuestTrialNotice quota={guestQuota} />}

                {/* 常駐的 live region：先掛載再更新文字，報讀器才會可靠地公告 */}
                <p className={`translate-swap-note${swapNote ? "" : " is-empty"}`} role="status">{swapNote}</p>
                {error && <Alert variant="danger" className="translate-alert">{error}</Alert>}

                <div className="translate-grid">
                    <div className="yy-card translate-pane translate-pane--in">
                        <div className="translate-pane-head">
                            <span>{currentDirection.sourceLabel}</span>
                            <span className="translate-pane-tools">
                                {sourceText && (
                                    <button type="button" className="translate-clear" aria-label="清除輸入" onClick={handleClear}>
                                        <X size={16} aria-hidden="true" />
                                    </button>
                                )}
                                <CharRing value={sourceText.length} max={MAX_LEN} />
                            </span>
                        </div>
                        <textarea
                            ref={textareaRef}
                            className="translate-textarea"
                            aria-label={`輸入${currentDirection.sourceLabel}原文`}
                            aria-describedby={`${hintId} ${countId}${sourceText.length >= LIMIT_WARN ? ` ${limitId}` : ""}`}
                            value={sourceText}
                            maxLength={MAX_LEN}
                            placeholder={direction === "zh2tribe" ? "輸入要翻譯的中文句子…" : `輸入要翻譯的${currentTribe?.fullName}句子…`}
                            onChange={handleSourceChange}
                            onKeyDown={handleKeyDown}
                            onCompositionStart={handleCompositionStart}
                            onCompositionEnd={handleCompositionEnd}
                        />
                        <span id={countId} className="visually-hidden">已輸入 {sourceText.length} 字，上限 {MAX_LEN} 字</span>
                        {sourceText.length >= LIMIT_WARN && (
                            <p id={limitId} className={`translate-limit${sourceText.length >= MAX_LEN ? " is-full" : ""}`}>
                                {sourceText.length >= MAX_LEN ? `已達 ${MAX_LEN} 字上限` : `還可以輸入 ${MAX_LEN - sourceText.length} 字`}
                            </p>
                        )}
                        <p id={hintId} className="translate-submit-hint">按 {SUBMIT_HINT} 也可以送出</p>
                        <button
                            type="button"
                            className="yy-btn-primary translate-submit-btn"
                            disabled={!sourceText.trim() || loading || !online || (isGuest && guestQuota.exhausted)}
                            aria-describedby={online ? undefined : "translate-offline"}
                            onClick={handleSubmit}
                        >
                            {loading ? <LoadingSpinner size="sm" announce={false} label="翻譯中…" /> : "翻譯"}
                        </button>
                        <OfflineNotice online={online} id="translate-offline" action="翻譯" />
                    </div>

                    <div className="yy-card translate-pane translate-pane--out">
                        <div className="translate-pane-head">
                            <span>{currentDirection.targetLabel}</span>
                            {result?.matchType === "exact_corpus" && (
                                <span className="yy-diamond-badge translate-exact-badge">
                                    <span>取自例句</span>
                                </span>
                            )}
                        </div>

                        {loading && <TranslateResultSkeleton label="翻譯中…" />}

                        {!loading && result && (
                            <>
                                <GroundedText
                                    lang={tribeLangCode(result.tribeSlug ?? tribe)}
                                    tokens={result.tokens}
                                    reveal
                                    activeIndex={activeTokenIndex}
                                    onTokenClick={(i) => setActiveTokenIndex((cur) => (cur === i ? null : i))}
                                />
                                {guestNote && (
                                    <p className="translate-guest-note" role="status">
                                        {guestNote} <Link to="/register">免費註冊</Link>
                                    </p>
                                )}
                                <div className="translate-result-actions">
                                    <button type="button" className="yy-btn-outline" onClick={handlePlayResult}>
                                        <Volume2 size={15} /> 逐詞發音
                                    </button>
                                    <button type="button" className="yy-btn-outline" onClick={handleCopy}>
                                        <Copy size={15} /> {copyStatus === "copied" ? "已複製 ✓" : copyStatus === "error" ? "複製失敗" : "複製"}
                                    </button>
                                </div>
                                <GroundedLegend />
                                <p className="translate-coverage-summary">
                                    {result.warning ?? `${result.coverage.total - (result.coverage.unsupported ?? 0)}/${result.coverage.total} 個詞有辭典語料佐證`}
                                </p>
                                {result.notes && <p className="translate-notes">{result.notes}</p>}

                                <EvidencePanel token={activeToken} onPlayAudio={handlePlayAudio} tribeSlug={isGuest ? undefined : result.tribeSlug} />

                                {result.evidence.sentences.length > 0 && (
                                    <div className="translate-evidence-list">
                                        <h3>參考例句</h3>
                                        {result.evidence.sentences.slice(0, 5).map((s) => (
                                            <div key={s.id} className="translate-evidence-sentence">
                                                <span className="translate-evidence-original">{s.original}</span>
                                                <span className="translate-evidence-chinese">{s.chinese}</span>
                                                {s.audioFileId && (
                                                    <button
                                                        type="button"
                                                        className="yy-evidence-audio-btn"
                                                        aria-label="播放例句原音"
                                                        onClick={() => handlePlayAudio(s.audioFileId)}
                                                    >
                                                        <Volume2 size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}

                        {!loading && !result && (
                            <p className="translate-placeholder">翻譯結果會顯示在這裡</p>
                        )}
                    </div>
                </div>
            </section>
        </div>
    );
};

export default TranslatePage;
