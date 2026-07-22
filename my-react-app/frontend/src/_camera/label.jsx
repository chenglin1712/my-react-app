import { useEffect, useState } from "react";
import axios from "axios";
import { auth } from "../../../firebase";

// 影像辨識精靈第 2 步：顯示 vision API 辨識出的候選單詞，讓使用者複選。
// image/file/tribe 由 index.jsx（精靈容器）傳入，取代原本從路由 state 讀取。
const CameraLabelStep = ({ image, file, onConfirm, onBack }) => {
    const [labels, setLabels] = useState([]);
    const [selectedLabels, setSelectedLabels] = useState(new Set());
    const [error, setError] = useState(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!file) {
            onBack();
            return;
        }

        setLoading(true);
        const formData = new FormData();
        formData.append("file", file);

        // 步驟卸載（例如使用者在辨識完成前就按上一步／換了新圖）時，原本的請求
        // 還是會繼續跑到底，回來時對已經卸載的元件 setState、也白白浪費一次
        // 按用量計費的 Google Cloud Vision API 呼叫。用 AbortController 取消。
        const controller = new AbortController();
        const analyze = async () => {
            const token = await auth.currentUser?.getIdToken();
            return axios.post(import.meta.env.VITE_API_VISION_URL, formData, {
                headers: {
                    ...(token ? { "Authorization": `Bearer ${token}` } : {}),
                },
                signal: controller.signal,
            });
        };

        analyze()
            .then((response) => {
                if (response.data.error) {
                    setError(true);
                } else {
                    setLabels(response.data.labels || []);
                }
            })
            .catch((err) => {
                if (axios.isCancel(err)) return;
                console.error("影像辨識 API 錯誤:", err.response?.data ?? err.message);
                setError(true);
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });

        return () => controller.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [file]);

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

                {loading && <p className="camera-loading">辨識中，請稍候...</p>}
                {error ? (
                    <p className="camera-error">辨識失敗</p>
                ) : (
                    <div className="camera-label-list">
                        {labels.map((label, index) => {
                            const active = selectedLabels.has(label.description);
                            return (
                                <div
                                    key={index}
                                    role="button"
                                    tabIndex={0}
                                    className="camera-label-item"
                                    style={active ? { background: 'var(--yy-red)', color: 'var(--yy-cream)' } : undefined}
                                    onClick={() => toggleLabelSelection(label.description)}
                                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleLabelSelection(label.description); } }}
                                >
                                    <span className="camera-label-name">{label.description}</span>
                                    <span className="camera-label-score">{(label.score * 100).toFixed(0)}%</span>
                                </div>
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
                <p className="camera-warning">⚠ 注意，確認後將無法回到此頁面</p>
            </div>
        </div>
    );
};

export default CameraLabelStep;
