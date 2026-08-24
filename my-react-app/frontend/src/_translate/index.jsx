import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { Alert, Spinner } from "react-bootstrap";
import { ArrowLeftRight, Copy, Volume2 } from "lucide-react";
import "../../static/css/_translate/index.css";
import { TRIBES } from "../constants/tribes";
import TribePill from "../../components/ui/TribePill";
import GroundedText from "../../components/_translate/GroundedText";
import EvidencePanel from "../../components/_translate/EvidencePanel";
import useAudioPlayback from "../../hooks/useAudioPlayback";
import { useTranslateCapabilities } from "../../hooks/useTranslateCapabilities";
import { apiPost, trackEvent } from "../../utils/apiClient";

const MAX_LEN = 300;

const DIRECTIONS = [
    { key: "zh2tribe", sourceLabel: "繁體中文", targetLabel: "族語" },
    { key: "tribe2zh", sourceLabel: "族語", targetLabel: "繁體中文" },
];

const TranslatePage = () => {
    const [tribe, setTribe] = useState("tayal");
    const [direction, setDirection] = useState("zh2tribe");
    const [sourceText, setSourceText] = useState("");
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [activeTokenIndex, setActiveTokenIndex] = useState(null);
    const capabilities = useTranslateCapabilities();

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
        setActiveTokenIndex(null);
    }, [tribe]);

    useEffect(() => {
        return () => { abortRef.current?.abort(); };
    }, []);

    const currentTribe = TRIBES.find((t) => t.slug === tribe);
    const currentCapability = capabilities?.find((c) => c.tribeSlug === tribe);
    const currentDirection = DIRECTIONS.find((d) => d.key === direction);

    const handleSubmit = async () => {
        const text = sourceText.trim();
        if (!text || loading) return;

        cancelTranslation();
        const myGeneration = requestGenerationRef.current;
        const controller = new AbortController();
        abortRef.current = controller;

        setLoading(true);
        setError("");
        setActiveTokenIndex(null);
        try {
            const data = await apiPost(
                import.meta.env.VITE_API_TRANSLATE_URL,
                { text, tribe, direction },
                { signal: controller.signal },
            );
            if (myGeneration !== requestGenerationRef.current) return;
            setResult(data);
            trackEvent("translate_submit", { tribe, payload: { direction, len: text.length } });
        } catch (err) {
            if (axios.isCancel(err) || myGeneration !== requestGenerationRef.current) return;
            setError(err.message || "翻譯失敗，請稍後再試");
            setResult(null);
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

    const handlePlayResult = () => {
        if (!result) return;
        playSentence(result.translation);
    };

    const activeToken = activeTokenIndex != null ? result?.tokens?.[activeTokenIndex] : null;

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
                            disabled={!sourceText.trim() || loading}
                            onClick={handleSubmit}
                        >
                            {loading ? <Spinner animation="border" size="sm" /> : "翻譯"}
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
                                <Spinner animation="border" size="sm" />
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

                                <EvidencePanel token={activeToken} onPlayAudio={playAudio} />

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
                                                        onClick={() => playAudio(s.audioFileId)}
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
