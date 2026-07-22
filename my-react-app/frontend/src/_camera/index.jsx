import { useState, useRef, lazy, Suspense } from "react";
import { Alert, Spinner } from "react-bootstrap";
import "../../static/css/_camera/wizard.css";
import { TRIBES } from "../constants/tribes";
import StepBar from "../../components/ui/StepBar";
import TribePill from "../../components/ui/TribePill";

// 第 2、3 步各自 lazy load：第 1 步（選圖）原本會把三步全部一起打包進去，
// 含第 3 步查詢結果頁引用的 36 張分類圖（見 constants/categoryGroups.js），
// 使用者可能選了圖片卻還沒送出辨識，就已經先付了這些成本。
const CameraLabelStep = lazy(() => import("./label"));
const CameraResultStep = lazy(() => import("./result"));

const STEP_LABELS = ["上傳圖片", "選擇單詞", "查詢結果"];

const StepLoading = () => (
    <div className="camera-step-loading d-flex justify-content-center py-5">
        <Spinner animation="border" variant="primary" />
    </div>
);

const CameraWizard = () => {
    const [step, setStep] = useState(1);
    const [tribe, setTribe] = useState("tayal");
    const [image, setImage] = useState(null);
    const [file, setFile] = useState(null);
    const [inputKey, setInputKey] = useState(Date.now());
    const [fileName, setFileName] = useState("請選擇圖片");
    const [errorMsg, setErrorMsg] = useState("");
    const [selectedWords, setSelectedWords] = useState([]);
    const fileInputRef = useRef(null);

    const handleImageChange = (event) => {
        const newFile = event.target.files.length > 0 ? event.target.files[0] : null;
        if (newFile == null) {
            setFileName(file ? file.name : "請選擇圖片");
            return;
        }
        if (newFile.size > 5 * 1024 * 1024) {
            setErrorMsg("圖片不得超過 5 MB，請重新選擇。");
            return;
        }
        setErrorMsg("");
        const reader = new FileReader();
        reader.onloadend = () => setImage(reader.result);
        reader.readAsDataURL(newFile);
        setFile(newFile);
        setFileName(newFile.name);
    };

    const handleCancel = () => {
        setImage(null);
        setFile(null);
        setInputKey(Date.now());
        setFileName("請選擇圖片");
    };

    const handlePreviewClick = () => fileInputRef.current?.click();

    const restart = () => {
        setStep(1);
        handleCancel();
        setSelectedWords([]);
    };

    return (
        <div className="yy-page camera-page">
            <section className="yy-hero camera-hero">
                <div className="yy-fade-up">
                    <span className="yy-eyebrow">◆ VISION MODE ◆</span>
                    <h1 className="camera-title">影像辨識</h1>
                    <p className="camera-desc">拍下身邊的物件，讓 AI 找出對應的族語詞彙，打造專屬你的族語單字卡。</p>
                </div>

                <div className="yy-fade-up camera-tribe-row">
                    {TRIBES.map((t) => (
                        <TribePill key={t.slug} tribe={t} active={tribe === t.slug} onClick={() => setTribe(t.slug)} />
                    ))}
                </div>

                <div className="yy-fade-up camera-stepbar-wrap">
                    <StepBar steps={STEP_LABELS} current={step} />
                </div>
            </section>

            <div className="yy-divider" />

            <section className="camera-body">
                {step === 1 && (
                    <div className="yy-fade-up camera-step1">
                        <div
                            className="camera-dropzone"
                            role="button"
                            tabIndex={0}
                            onClick={handlePreviewClick}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handlePreviewClick(); } }}
                        >
                            {image ? (
                                <img src={image} alt="預覽圖片" className="camera-dropzone-img" />
                            ) : (
                                <div className="camera-dropzone-placeholder">
                                    <span>📷</span>
                                    <span>點此選擇圖片</span>
                                </div>
                            )}
                        </div>

                        <div className="camera-step1-panel">
                            <div className="yy-card camera-step1-card">
                                <div className="camera-step1-row">
                                    <button type="button" className="yy-btn-outline" onClick={handlePreviewClick}>選擇圖片</button>
                                    <span className="camera-filename">{fileName}</span>
                                </div>
                                <input
                                    key={inputKey}
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    onChange={handleImageChange}
                                    ref={fileInputRef}
                                    style={{ display: "none" }}
                                    aria-label="選擇圖片檔案"
                                />
                                {errorMsg && <Alert variant="danger" className="py-2 mt-2 mb-0">{errorMsg}</Alert>}
                                <p className="camera-hint">支援 JPG / PNG，檔案大小上限 5MB。</p>
                            </div>
                            <div className="camera-step1-actions">
                                <button type="button" className="yy-btn-primary" disabled={!image} onClick={() => setStep(2)}>提交辨識 ▸</button>
                                <button type="button" className="yy-btn-outline" disabled={!image} onClick={handleCancel}>取消</button>
                            </div>
                        </div>
                    </div>
                )}

                {step === 2 && (
                    <Suspense fallback={<StepLoading />}>
                        <CameraLabelStep
                            image={image}
                            file={file}
                            onConfirm={(words) => { setSelectedWords(words); setStep(3); }}
                            onBack={() => setStep(1)}
                        />
                    </Suspense>
                )}

                {step === 3 && (
                    <Suspense fallback={<StepLoading />}>
                        <CameraResultStep
                            selectedWords={selectedWords}
                            tribe={tribe}
                            onRestart={restart}
                        />
                    </Suspense>
                )}
            </section>
        </div>
    );
};

export default CameraWizard;
