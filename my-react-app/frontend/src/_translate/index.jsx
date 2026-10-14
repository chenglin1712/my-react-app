import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { Alert } from "react-bootstrap";
import LoadingSpinner from "@components/ui/LoadingSpinner";
import { Link } from "react-router-dom";
import { ArrowLeftRight, Copy, Volume2 } from "lucide-react";
import "../../static/css/_translate/index.css";
import { TRIBES } from "../constants/tribes";
import TribePill from "../../components/ui/TribePill";
import GroundedText from "../../components/_translate/GroundedText";
import GuestTrialNotice from "../../components/_translate/GuestTrialNotice";
import EvidencePanel from "../../components/_translate/EvidencePanel";
import useAudioPlayback from "../../hooks/useAudioPlayback";
import { useTranslateCapabilities } from "../../hooks/useTranslateCapabilities";
import { useGuestQuota } from "../../hooks/useGuestQuota";
import { useAuth } from "../userServives/authContext";
import PermissionProtect from "../userServives/permissionProtect";
import { apiPost } from "../../utils/apiClient";

const MAX_LEN = 300;

const DIRECTIONS = [
    { key: "zh2tribe", sourceLabel: "繁體中文", targetLabel: "族語" },
    { key: "tribe2zh", sourceLabel: "族語", targetLabel: "繁體中文" },
];

const GUEST_LOGIN_NOTE = "發音與詞形分析需要登入，免費註冊後就能使用。";

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
    const [error, setError] = useState("");
    const [activeTokenIndex, setActiveTokenIndex] = useState(null);
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
        setActiveTokenIndex(null);
        try {
            const data = await apiPost(
                import.meta.env.VITE_API_TRANSLATE_URL,
                { text, tribe, direction },
                { signal: controller.signal, guest: isGuest },
            );
            if (myGeneration !== requestGenerationRef.current) return;
            if (isGuest) guestQuota.applyResponse(data?.guestQuota);
            setResult(data);
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

    const handleKeyDown = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            handleSubmit();
        }
    };

    // 交換方向前先取消目前這一輪翻譯：不然中途交換方向，舊方向的回應晚一步
    // 回來時仍會被顯示成「新方向」的翻譯結果（見上方 cancelTranslation 說明）。
    const handleSwap = () => {
        cancelTranslation();
        setLoading(false);
        const nextDirection = direction === "zh2tribe" ? "tribe2zh" : "zh2tribe";
        setDirection(nextDirection);
        setActiveTokenIndex(null);
        if (result) {
            setSourceText(result.translation);
            setResult(null);
        }
    };

    const [copyStatus, setCopyStatus] = useState("idle"); // idle | copied | error
    const copyStatusTimerRef = useRef(null);
    const handleCopy = () => {
        if (!result) return;
        navigator.clipboard?.writeText(result.translation)
            .then(() => setCopyStatus("copied"))
            .catch(() => setCopyStatus("error"));
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
        <div className="yy-page translate-page">
            <section className="yy-hero translate-hero">
                <div className="yy-fade-up">
                    <span className="yy-eyebrow">◆ TRANSLATE MODE ◆</span>
                    <h1 className="translate-title">族語翻譯</h1>
                    <p className="translate-desc">
                        以辭典語料為依據，每個詞形都會標明是否有語料佐證——沒有標記不代表翻譯正確，只代表這個詞在資料庫裡查得到。
                    </p>
                </div>

                <div className="yy-fade-up translate-tribe-row">
                    {TRIBES.map((t) => (
                        <TribePill key={t.slug} tribe={t} active={tribe === t.slug} onClick={() => setTribe(t.slug)} />
                    ))}
                </div>
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

                <div className="translate-direction-bar yy-fade-up">
                    <span className="translate-direction-label">{currentDirection.sourceLabel}</span>
                    <button
                        type="button"
                        className="translate-swap-btn"
                        aria-label="交換翻譯方向"
                        onClick={handleSwap}
                    >
                        <ArrowLeftRight size={18} />
                    </button>
                    <span className="translate-direction-label">{currentDirection.targetLabel}</span>
                </div>

                {error && <Alert variant="danger" className="translate-alert">{error}</Alert>}

                <div className="translate-grid">
                    <div className="yy-card translate-pane">
                        <div className="translate-pane-head">
                            <span>{currentDirection.sourceLabel}</span>
                            <span className="translate-char-count">{sourceText.length}/{MAX_LEN}</span>
                        </div>
                        <textarea
                            className="translate-textarea"
                            value={sourceText}
                            maxLength={MAX_LEN}
                            placeholder={direction === "zh2tribe" ? "輸入要翻譯的中文句子…" : `輸入要翻譯的${currentTribe?.fullName}句子…`}
                            onChange={(e) => setSourceText(e.target.value)}
                            onKeyDown={handleKeyDown}
                        />
                        <button
                            type="button"
                            className="yy-btn-primary translate-submit-btn"
                            disabled={!sourceText.trim() || loading || (isGuest && guestQuota.exhausted)}
                            onClick={handleSubmit}
                        >
                            {loading ? <LoadingSpinner size="sm" announce={false} label="翻譯中…" /> : "翻譯"}
                        </button>
                    </div>

                    <div className="yy-card translate-pane">
                        <div className="translate-pane-head">
                            <span>{currentDirection.targetLabel}</span>
                            {result?.matchType === "exact_corpus" && (
                                <span className="yy-diamond-badge translate-exact-badge">
                                    <span>取自例句</span>
                                </span>
                            )}
                        </div>

                        {loading && (
                            <div className="translate-result-loading">
                                <LoadingSpinner size="sm" decorative />
                                <span>翻譯中…</span>
                            </div>
                        )}

                        {!loading && result && (
                            <>
                                <GroundedText
                                    tokens={result.tokens}
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
                                <p className="translate-coverage-summary">
                                    {result.warning ?? `${result.coverage.total}/${result.coverage.total} 個詞有辭典語料佐證`}
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
