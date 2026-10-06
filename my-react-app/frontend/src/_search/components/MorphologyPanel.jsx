import { useEffect, useId, useState } from "react";
import MorphologyResult from "../../../components/_morphology/MorphologyResult";
import { useMorphologyAnalysis } from "../../../hooks/useMorphologyAnalysis";
import "../../../static/css/_morphology/index.css";

const WORD_MAX_LENGTH = 40;

/**
 * 單詞查詢頁的「詞形分析」面板：輸入任何一個族語詞形（包含辭典沒收錄的），看它可能的詞根、
 * 詞綴切分、詞綴功能與辭典例句。跟上面的搜尋是兩件獨立的事，所以預設收合，不干擾原本的查詢。
 * 族語跟著頁面上方選的族語走；換族語就清掉上一次的結果。
 */
const MorphologyPanel = ({ tribeSlug, tribeName, playAudio }) => {
    const [open, setOpen] = useState(false);
    const [word, setWord] = useState("");
    const { loading, result, error, analyze, reset } = useMorphologyAnalysis();
    const bodyId = useId();

    useEffect(() => {
        reset();
    }, [tribeSlug, reset]);

    const submit = () => {
        if (!word.trim() || loading) return;
        analyze(tribeSlug, word);
    };

    return (
        <section className="yy-morph-panel" aria-label="詞形分析">
            <button
                type="button"
                className="yy-morph-toggle"
                aria-expanded={open}
                aria-controls={bodyId}
                onClick={() => setOpen((v) => !v)}
            >
                <span>詞形分析 <small>輸入任何{tribeName}詞形，看它的詞根與詞綴</small></span>
                <span aria-hidden="true">{open ? "▾" : "▸"}</span>
            </button>

            {open && (
                <div className="yy-morph-body" id={bodyId}>
                    <div className="yy-morph-form">
                        <input
                            type="text"
                            className="yy-morph-input"
                            aria-label="要分析的詞形"
                            placeholder={`輸入一個${tribeName}詞形，例如辭典沒收錄的變化形`}
                            maxLength={WORD_MAX_LENGTH}
                            value={word}
                            onChange={(e) => setWord(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                                    e.preventDefault();
                                    submit();
                                }
                            }}
                        />
                        <button type="button" className="yy-morph-go" onClick={submit} disabled={loading || !word.trim()}>
                            {loading ? "分析中…" : "分析"}
                        </button>
                    </div>
                    <p className="yy-morph-hint">一次輸入一個詞形（不含空白）。結果會標示每個答案的來源與信心。</p>

                    {error && <p className="yy-morph-error" role="alert">{error}</p>}
                    <MorphologyResult result={result} onPlayAudio={playAudio} />
                </div>
            )}
        </section>
    );
};

export default MorphologyPanel;
