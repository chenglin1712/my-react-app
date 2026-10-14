import { useEffect, useState } from "react";
import axios from "axios";
import { Alert, Button } from "react-bootstrap";
import { Link } from "react-router-dom";
import LoadingSpinner from "@components/ui/LoadingSpinner";
import EmptyState from "@components/ui/EmptyState";
import { apiPost } from "../../utils/apiClient";
import { announce } from "@utils/announce";

// vision.py 自己的註解就寫明「圖片辨識同一批 label 常常出現重複的英文單字
// （例如同一物件被偵測到多次）」，回傳前沒有去重。同一段中文翻譯出現兩筆時
// 只保留分數較高的那筆，避免畫面上出現兩列看起來一樣的候選詞。
function mergeDuplicateLabels(labels) {
    const bestByDescription = new Map();
    for (const label of labels) {
        const existing = bestByDescription.get(label.description);
        if (!existing || label.score > existing.score) {
            bestByDescription.set(label.description, label);
        }
    }
    return Array.from(bestByDescription.values());
}

// 辨識失敗的原因分類：讓使用者知道是圖片的問題（換一張）還是服務暫時的問題（重試）。
// 400／413 的訊息是後端寫給使用者看的中文，直接顯示；其餘用固定說明，不把技術字串丟給使用者。
function classifyVisionError(err) {
    const status = err?.status;
    if (status === 400 || status === 413) {
        return { kind: "image", message: err.message || "這張圖片無法辨識，請換一張再試。", retryable: false };
    }
    if (status === 429) {
        return { kind: "rate", message: "操作太頻繁，請等一分鐘後再試。", retryable: true };
    }
    if (status === undefined || status === 502 || status === 503 || status === 504) {
        return { kind: "service", message: "辨識服務暫時無法使用，可能是網路不穩或服務忙碌，請稍後再試。", retryable: true };
    }
    return { kind: "unknown", message: "辨識失敗，請稍後再試。", retryable: true };
}

// 影像辨識精靈第 2 步：顯示 vision API 辨識出的候選單詞，讓使用者複選。
// image/file/tribe 由 index.jsx（精靈容器）傳入，取代原本從路由 state 讀取。
const CameraLabelStep = ({ image, file, saved, onSave, onConfirm, onBack }) => {
    // saved：從結果頁「回到選詞」時帶回來的辨識結果與勾選，同一張圖不重新辨識（省一次付費呼叫）
    const reuse = saved && saved.file === file ? saved : null;
    const [labels, setLabels] = useState(reuse ? reuse.labels : []);
    const [selectedLabels, setSelectedLabels] = useState(new Set(reuse ? reuse.selected : []));
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const [loaded, setLoaded] = useState(Boolean(reuse));
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        if (!file) {
            onBack();
            return;
        }
        if (reuse && attempt === 0) return undefined;

        setLoading(true);
        setError(null);
        setLoaded(false);
        announce("辨識中，請稍候");
        const formData = new FormData();
        formData.append("file", file);

        // 步驟卸載（例如使用者在辨識完成前就按上一步／換了新圖）時，原本的請求
        // 還是會繼續跑到底，回來時對已經卸載的元件 setState、也白白浪費一次
        // 按用量計費的 Google Cloud Vision API 呼叫。用 AbortController 取消。
        const controller = new AbortController();
        const analyze = () => apiPost(import.meta.env.VITE_API_VISION_URL, formData, { signal: controller.signal });

        // vision.py 成功時（2xx）從不在回應內帶 error 欄位，錯誤一律走
        // HTTPException／下面的 .catch，不需要另外檢查 response.data.error。
        analyze()
            .then((data) => {
                const merged = mergeDuplicateLabels(data.labels || []);
                setLabels(merged);
                setSelectedLabels(new Set());
                setLoaded(true);
                announce(merged.length > 0 ? `辨識完成，找到 ${merged.length} 個候選單詞` : "辨識完成，沒有找到單詞");
            })
            .catch((err) => {
                if (axios.isCancel(err)) return;
                console.error("影像辨識 API 錯誤:", err.data ?? err.message);
                setError(classifyVisionError(err));
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });

        return () => controller.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [file, attempt]);

    // 候選詞與勾選存回精靈容器，結果頁「回到選詞」時還原
    useEffect(() => {
        if (loaded) onSave?.({ file, labels, selected: Array.from(selectedLabels) });
    }, [loaded, file, labels, selectedLabels, onSave]);

    const toggleLabelSelection = (label) => {
        setSelectedLabels((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(label)) newSet.delete(label);
            else newSet.add(label);
            return newSet;
        });
    };

    return (
        <div className="yy-fade-up camera-step2">
            <div className="camera-step2-preview">
                {image && <img src={image} alt="預覽圖片" />}
            </div>

            <div className="camera-step2-panel">
                <h3 className="camera-step2-title">選擇欲查看之單詞</h3>
                <p className="camera-step2-sub">可複選，您已選擇 <span>{selectedLabels.size}</span> 個</p>

                {loading && (
                    <div className="camera-loading">
                        <LoadingSpinner size="sm" label="辨識中，請稍候…" />
                    </div>
                )}
                {error && (
                    <Alert variant="danger" className="camera-error" role="alert">
                        <p className="mb-2"><strong>辨識失敗</strong></p>
                        <p className="mb-2">{error.message}</p>
                        <div className="camera-error-actions">
                            {error.retryable && (
                                <Button type="button" variant="danger" size="sm" onClick={() => setAttempt((n) => n + 1)}>重試</Button>
                            )}
                            <Button type="button" variant="outline-dark" size="sm" onClick={onBack}>換一張圖片</Button>
                        </div>
                    </Alert>
                )}
                {loaded && labels.length === 0 && (
                    <EmptyState
                        title="沒有辨識出可以查的物件"
                        actions={(
                            <>
                                <Button type="button" variant="danger" onClick={onBack}>換一張圖片</Button>
                                <Link to="/search" className="btn btn-outline-dark">去單詞查詢</Link>
                            </>
                        )}
                    >
                        <ul className="camera-tips">
                            <li>讓物件佔滿畫面、光線充足</li>
                            <li>背景單純，一次只拍一個物件</li>
                            <li>對焦清楚，避免模糊或過暗</li>
                        </ul>
                        <p>也可以直接到單詞查詢，用中文輸入想找的詞。</p>
                    </EmptyState>
                )}
                {!error && labels.length > 0 && (
                    <div className="camera-label-list">
                        {labels.map((label, index) => {
                            const active = selectedLabels.has(label.description);
                            return (
                <button
                                    type="button"
                                    key={index}
                                    className="camera-label-item"
                                    aria-pressed={active}
                                    style={active ? { background: 'var(--yy-red)', color: 'var(--yy-cream)' } : undefined}
                                    onClick={() => toggleLabelSelection(label.description)}
                                >
                                    <span className="camera-label-name">{label.description}</span>
                                    <span className="camera-label-score">{(label.score * 100).toFixed(0)}%</span>
                                </button>
                            );
                        })}
                    </div>
                )}

                <div className="camera-step2-actions">
                    <button
                        type="button"
                        className="yy-btn-primary"
                        disabled={selectedLabels.size === 0}
                        onClick={() => onConfirm(Array.from(selectedLabels))}
                    >確認 ✓</button>
                    <button type="button" className="yy-btn-outline" onClick={onBack}>返回</button>
                </div>
            </div>
        </div>
    );
};

export default CameraLabelStep;
