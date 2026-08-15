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
import { apiGet, apiPost, trackEvent } from "../../utils/apiClient";

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
    const [capabilities, setCapabilities] = useState(null);

    const abortRef = useRef(null);
    const { playAudio, playSentence } = useAudioPlayback(tribe, setError);

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const data = await apiGet(import.meta.env.VITE_API_TRANSLATE_CAPABILITIES_URL);
                if (active) setCapabilities(data.tribes ?? []);
            } catch {
                // 能力資訊只是輔助顯示（例句數、有無整句原音），拿不到不影響主要翻譯功能。
            }
        })();
        return () => { active = false; };
    }, []);

    const currentTribe = TRIBES.find((t) => t.slug === tribe);
    const currentCapability = capabilities?.find((c) => c.tribeSlug === tribe);
    const currentDirection = DIRECTIONS.find((d) => d.key === direction);

    const handleSubmit = async () => {
        const text = sourceText.trim();
        if (!text || loading) return;

        abortRef.current?.abort();
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
            setResult(data);
            trackEvent("translate_submit", { tribe, payload: { direction, len: text.length } });
        } catch (err) {
            if (axios.isCancel(err)) return;
            setError(err.message || "翻譯失敗，請稍後再試");
            setResult(null);
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            handleSubmit();
        }
    };

    const handleSwap = () => {
        const nextDirection = direction === "zh2tribe" ? "tribe2zh" : "zh2tribe";
        setDirection(nextDirection);
        setActiveTokenIndex(null);
        if (result) {
            setSourceText(result.translation);
            setResult(null);
        }
    };

    const handleCopy = () => {
        if (!result) return;
        navigator.clipboard?.writeText(result.translation).catch(() => {});
    };

    const handlePlayResult = () => {
        if (!result) return;
        playSentence(result.translation);
    };

    const activeToken = activeTokenIndex != null ? result?.tokens[activeTokenIndex] : null;

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
                                        <Copy size={15} /> 複製
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
