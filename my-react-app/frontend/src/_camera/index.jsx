import { Camera } from "lucide-react";
import { useState, useRef, useCallback, useEffect, lazy, Suspense } from "react";
import { Alert } from "react-bootstrap";
import LoadingSpinner from "@components/ui/LoadingSpinner";
import "../../static/css/_camera/wizard.css";
import CameraPrivacyNote from "./components/CameraPrivacyNote";
import { useOnlineStatus } from "@hooks/useOnlineStatus";
import OfflineNotice from "@components/ui/OfflineNotice";
import { prepareImageForUpload, ImageUploadError } from "./imageUpload";

// 第 2、3 步各自 lazy load：第 1 步（選圖）原本會把三步全部一起打包進去，
// 含第 3 步查詢結果頁引用的 36 張分類圖（見 constants/categoryGroups.js），
// 使用者可能選了圖片卻還沒送出辨識，就已經先付了這些成本。
const CameraLabelStep = lazy(() => import("./label"));
const CameraResultStep = lazy(() => import("./result"));

// 後端（routes/vision.py 的 ALLOWED_IMAGE_FORMATS）只收 JPEG、PNG、WebP。第 1 步就用同一份白名單擋，
// HEIC／AVIF／GIF／BMP 不用等到第 2 步送出辨識才被退回。兩個 <input> 的 accept 也用同一份，
// 讓選檔對話框一開始就只列出這三種（iPhone Safari 在 accept 沒有 HEIC 時會自動轉成 JPEG）。
const ACCEPTED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ACCEPT_ATTRIBUTE = ACCEPTED_MIME_TYPES.join(",");
// 少數舊版瀏覽器、Android WebView 會把 JPEG 回報成這兩個非標準的名稱；內容還是 JPEG，後端收得下
const JPEG_MIME_ALIASES = ["image/jpg", "image/pjpeg"];
// 部分 Android 的檔案 MIME type 是空字串，這時用副檔名判斷，不能因為沒有 type 就當成不是圖片
const ACCEPTED_EXT_RE = /\.(jpe?g|png|webp)$/i;
const isSupportedImage = (f) => (f.type
    ? [...ACCEPTED_MIME_TYPES, ...JPEG_MIME_ALIASES].includes(f.type.toLowerCase())
    : ACCEPTED_EXT_RE.test(f.name || ""));
// 「看起來是圖片但格式不收」：貼上時用來決定要不要出聲說明（貼上 PDF 之類的檔案則不攔截）
const looksLikeImage = (f) => Boolean(f.type) && f.type.toLowerCase().startsWith("image/");

const StepLoading = () => (
    <div className="camera-step-loading d-flex justify-content-center py-5">
        <LoadingSpinner label="處理中…" />
    </div>
);

const CameraWizard = () => {
    const [step, setStep] = useState(1);
    const [tribe, setTribe] = useState("tayal");
    const [image, setImage] = useState(null);
    const online = useOnlineStatus();
    const [file, setFile] = useState(null);
    const [processing, setProcessing] = useState(false);
    const [inputKey, setInputKey] = useState(Date.now());
    const [fileName, setFileName] = useState("請選擇圖片");
    const [errorMsg, setErrorMsg] = useState("");
    const [dragging, setDragging] = useState(false);
    const [selectedWords, setSelectedWords] = useState([]);
    // 第 2 步辨識出的候選詞與勾選狀態：辨識是一次付費的 Vision 呼叫，從結果頁「回到選詞」時
    // 直接沿用，不重新辨識。換圖或重新上傳時清掉。
    const [labelState, setLabelState] = useState(null);
    const saveLabelState = useCallback((next) => setLabelState(next), []);
    const albumInputRef = useRef(null);
    const cameraInputRef = useRef(null);
    // 快速選圖 A 再選圖 B、或選圖後立刻取消，A 的 FileReader 可能比較晚才讀完；
    // 沒有這個 generation 的話，晚到的 onloadend 會把預覽蓋回已經不對的那張圖。
    const fileReadGenerationRef = useRef(0);
    // 目前進行中的 FileReader：換圖時中止上一個、離開頁面時中止最後一個（F18），不讓讀檔白白做完
    const readerRef = useRef(null);
    useEffect(() => () => {
        fileReadGenerationRef.current += 1;
        readerRef.current?.abort();
        readerRef.current = null;
    }, []);

    // 選圖、拖放、貼上三種來源共用同一套驗證：只收圖片、上限 5MB，不合格都用文字說明原因
    const acceptFile = (newFile) => {
        if (!isSupportedImage(newFile)) {
            setErrorMsg("不支援這個檔案格式，請選擇圖片檔（例如 JPG、PNG、WebP）。");
            return;
        }
        setErrorMsg("");
        // 先讓舊的世代作廢、再中止上一個讀檔：abort() 會同步觸發它的 loadend，
        // 順序反過來的話，舊讀檔的 onloadend 會以為自己還是最新的，把預覽清成 null（F18）。
        // 已經讀完的 abort 不會有任何作用。
        const myGeneration = ++fileReadGenerationRef.current;
        readerRef.current?.abort();
        const reader = new FileReader();
        readerRef.current = reader;
        reader.onloadend = () => {
            if (myGeneration !== fileReadGenerationRef.current) return;
            setImage(reader.result);
        };
        reader.readAsDataURL(newFile);
        // FE3-11／FE3-12：所有來源（相簿、拍照、拖放、貼上）都經過這裡，上傳用的檔案一律是
        // 本機縮小並重新編碼後的 JPEG（同時去掉 EXIF／GPS）；處理完成前 file 為 null，不能提交。
        setFile(null);
        setProcessing(true);
        setFileName(newFile.name);
        setLabelState(null);
        prepareImageForUpload(newFile).then((prepared) => {
            if (myGeneration !== fileReadGenerationRef.current) return;
            setFile(prepared);
            setProcessing(false);
        }).catch((err) => {
            if (myGeneration !== fileReadGenerationRef.current) return;
            // 處理失敗（太大或解不開）：不留下預覽，免得看起來能送出
            fileReadGenerationRef.current += 1;
            readerRef.current?.abort();
            setProcessing(false);
            setImage(null);
            setFileName("請選擇圖片");
            setInputKey(Date.now());
            setErrorMsg(err instanceof ImageUploadError ? err.message : "無法處理這張圖片，請換一張再試。");
        });
    };

    const handleImageChange = (event) => {
        const newFile = event.target.files.length > 0 ? event.target.files[0] : null;
        if (newFile == null) {
            setFileName(file ? file.name : "請選擇圖片");
            return;
        }
        acceptFile(newFile);
    };

    // 拖放：dragover 要 preventDefault 才會收到 drop；離開時（含拖到子元素）只在真的離開取景框才取消高亮
    const handleDragOver = (event) => {
        if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
        event.preventDefault();
        setDragging(true);
    };
    const handleDragLeave = (event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setDragging(false);
    };
    const handleDrop = (event) => {
        event.preventDefault();
        setDragging(false);
        const dropped = event.dataTransfer?.files?.[0];
        if (dropped) acceptFile(dropped);
    };

    // 貼上圖片（截圖後直接 Ctrl／⌘ + V）：只在第 1 步、剪貼簿裡真的有檔案時處理，文字貼上不受影響
    const acceptFileRef = useRef(acceptFile);
    useEffect(() => { acceptFileRef.current = acceptFile; });
    useEffect(() => {
        if (step !== 1) return undefined;
        const onPaste = (event) => {
            // 焦點在輸入框或可編輯區時，貼上屬於那個欄位，不攔截
            const target = event.target;
            if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
            const files = Array.from(event.clipboardData?.files || []);
            // 優先用收得下的圖片；貼的是圖片但格式不收（例如 GIF），也要攔下來讓使用者看到說明，不能毫無反應
            const pasted = files.find(isSupportedImage) || files.find(looksLikeImage);
            if (!pasted) return;
            event.preventDefault();
            acceptFileRef.current(pasted);
        };
        document.addEventListener("paste", onPaste);
        return () => document.removeEventListener("paste", onPaste);
    }, [step]);

    const handleCancel = () => {
        fileReadGenerationRef.current += 1; // 還沒讀完的舊 FileReader 不再更新預覽
        setImage(null);
        setFile(null);
        setProcessing(false);
        setInputKey(Date.now());
        setFileName("請選擇圖片");
        setLabelState(null);
    };

    const handleAlbumClick = () => albumInputRef.current?.click();
    const handleCameraClick = () => cameraInputRef.current?.click();

    const restart = () => {
        setStep(1);
        handleCancel();
        setSelectedWords([]);
    };

    return (
        <div className="yy-page camera-page">
            <section className="yy-hero camera-hero">
                <div className="yy-fade-up">
                    <h1 className="camera-title">影像辨識</h1>
                    <p className="camera-desc">拍下身邊的物件，讓 AI 找出對應的族語詞彙，打造專屬你的族語單字卡。</p>
                </div>
            </section>

            <div className="yy-divider" />

            <section className="camera-body">
                {step === 1 && (
                    <div className="yy-fade-up camera-step1">
                        <label
                            htmlFor="camera-file-input"
                            className={`camera-dropzone${dragging ? " is-dragging" : ""}`}
                            tabIndex={0}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleAlbumClick(); } }}
                            onDragOver={handleDragOver}
                            onDragEnter={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                        >
                            {image ? (
                                <img key={fileName} decoding="async" src={image} alt="預覽圖片" className="camera-dropzone-img" />
                            ) : (
                                <div className="camera-dropzone-placeholder">
                                    <Camera size={44} strokeWidth={2} aria-hidden="true" />
                                    <span>點此選擇圖片</span>
                                </div>
                            )}
                            {/* 取景框上的玻璃提示：浮在圖片或空框之上，說明這一步要做什麼（文字對比由毛玻璃材質的守門測試把關） */}
                            <span className="camera-dropzone-hint yy-glass" aria-hidden="true">
                                {dragging ? "放開就會使用這張圖片" : image ? "點選可更換圖片" : "把想辨識的物件放在框內，或貼上圖片"}
                            </span>
                        </label>

                        <div className="camera-step1-panel">
                            <div className="yy-card camera-step1-card">
                                <div className="camera-step1-row">
                                    <button type="button" className="yy-btn-outline" onClick={handleAlbumClick}>選擇圖片</button>
                                    {/* 只在觸控裝置顯示：桌機沒有相機可拍，點了也只會開檔案對話框 */}
                                    <button type="button" className="yy-btn-outline camera-capture-btn" onClick={handleCameraClick}>拍照</button>
                                    <span className="camera-filename">{fileName}</span>
                                </div>
                                {/* 相簿入口：不帶 capture，部分 Android 帶了 capture 會直接開相機、不給選相簿 */}
                                <input
                                    id="camera-file-input"
                                    key={`album-${inputKey}`}
                                    type="file"
                                    accept={ACCEPT_ATTRIBUTE}
                                    onChange={handleImageChange}
                                    ref={albumInputRef}
                                    style={{ display: "none" }}
                                    aria-label="選擇圖片檔案"
                                />
                                <input
                                    key={`camera-${inputKey}`}
                                    type="file"
                                    accept={ACCEPT_ATTRIBUTE}
                                    capture="environment"
                                    onChange={handleImageChange}
                                    ref={cameraInputRef}
                                    style={{ display: "none" }}
                                    aria-label="拍照"
                                    tabIndex={-1}
                                />
                                {errorMsg && <Alert variant="danger" className="py-2 mt-2 mb-0">{errorMsg}</Alert>}
                                {processing && <p className="camera-hint" role="status">正在縮小圖片…</p>}
                                <p className="camera-hint">支援 JPG、PNG、WebP 格式；上傳前會自動縮小，縮小後的檔案上限 5MB。</p>
                                <CameraPrivacyNote />
                            </div>
                            <div className="camera-step1-actions">
                                <button type="button" className="yy-btn-primary" disabled={!image || !file || processing || !online} aria-describedby={online ? undefined : "camera-offline"} onClick={() => setStep(2)}>提交辨識 ▸</button>
                                <button type="button" className="yy-btn-outline" disabled={!image} onClick={handleCancel}>移除圖片</button>
                            </div>
                            {/* 提交鈕旁永遠留一行簡短揭露：說明卡看過後會收起，但送出前資料的去向仍要看得到 */}
                            <p className="camera-hint">提交後圖片會送到第三方（Google）辨識，詳見上方隱私說明。</p>
                            <OfflineNotice online={online} id="camera-offline" action="辨識圖片" />
                        </div>
                    </div>
                )}

                {step === 2 && (
                    <Suspense fallback={<StepLoading />}>
                        <CameraLabelStep
                            image={image}
                            file={file}
                            saved={labelState}
                            onSave={saveLabelState}
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
                            onTribeChange={setTribe}
                            image={image}
                            onBack={() => setStep(2)}
                            onRestart={restart}
                        />
                    </Suspense>
                )}
            </section>
        </div>
    );
};

export default CameraWizard;
