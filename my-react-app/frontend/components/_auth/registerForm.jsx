import "../../static/css/_auth/registerForm.css"
import { User, Mail, CheckCircle, Circle } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert } from "react-bootstrap";
import avatarImage from '../../static/assets/_auth/avatar.webp';
import { registerWithImg } from "../../src/userServives/userServive"
import { useAuth } from "../../src/userServives/authContext";
import { loadSuccessAnimation } from "../../src/animations/loaders";
import SuccessModal from "../ui/SuccessModal";
import { useLottieAnimation } from "@hooks/useLottieAnimation";
import { useAvatarUpload } from "@hooks/useAvatarUpload";
import { authErrorMessage } from "@utils/firebaseAuthErrors";
import AuthField from "./AuthField";
import PasswordField from "./PasswordField";
import { AUTH_SUCCESS_REDIRECT_MS } from "./authTiming";

const MIN_PASSWORD_LENGTH = 6;
// 註冊表單原本有一個只有「學生」一個選項的「身分」下拉（審查項 P3-12），移除後
// 仍沿用同一個預設值寫進使用者資料，後台與個人資料頁的「身分」欄位不受影響。
const DEFAULT_IDENTITY = "學生";

// Firebase 錯誤碼對應到哪個欄位：能對應的把訊息放在該欄位下方，其餘放表單上方
const FIELD_BY_ERROR_CODE = {
    "auth/invalid-email": "email",
    "auth/email-already-in-use": "email",
    "auth/weak-password": "password",
};

const RegisterForm = ({ onSwitchToLogin }) => {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [confirmTouched, setConfirmTouched] = useState(false);
    const [errorMsg, setErrorMsg] = useState("");
    const [fieldErrors, setFieldErrors] = useState({});
    const [attempt, setAttempt] = useState(0);
    const isPasswordValid = password.length >= MIN_PASSWORD_LENGTH;
    const isConfirmMismatch = confirmPassword.length > 0 && confirmPassword !== password;
    const rulesId = useId();
    const formRef = useRef(null);
    // 同步的送出鎖（說明見 loginForm.jsx）：註冊重複送出會讓第二次回報「電子郵件已註冊」，畫面反而顯示失敗
    const submittingRef = useRef(false);

    const { previewUrl, isUploading, uploadError, selectFile } = useAvatarUpload();
    const [avatarUrl, setAvatarUrl] = useState(null);

    const [isRegistered, setIsRegistered] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const navigate = useNavigate();
    const { updateUserData } = useAuth();
    const redirectTimeoutRef = useRef(null);
    useEffect(() => () => clearTimeout(redirectTimeoutRef.current), []);
    // 註冊成功後本來會等一小段時間才跳頁；按「立即前往」或 Esc 就不用等。
    // Firebase 建好帳號時就已經登入了，所以直接去首頁，不用再手動登入一次（審查項 P2-71）。
    const skipWait = () => {
        clearTimeout(redirectTimeoutRef.current);
        navigate("/");
    };

    // 送出後有欄位錯誤時，把焦點移到第一個有問題的欄位
    useEffect(() => {
        if (attempt === 0) return;
        formRef.current?.querySelector('[aria-invalid="true"]')?.focus();
    }, [attempt]);

    const clearFieldError = (field) => {
        if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    };

    //使用者註冊
    const handleRegister = async (e) => {
        e.preventDefault();
        if (submittingRef.current) return;
        setErrorMsg("");

        const nextFieldErrors = {};
        if (!name.trim()) nextFieldErrors.name = "請輸入使用者名稱";
        if (!email.trim()) nextFieldErrors.email = "請輸入電子郵件";
        if (!isPasswordValid) nextFieldErrors.password = `密碼至少需要 ${MIN_PASSWORD_LENGTH} 個字元`;
        if (password !== confirmPassword) nextFieldErrors.confirm = "兩次輸入的密碼不一致";
        setFieldErrors(nextFieldErrors);
        if (Object.keys(nextFieldErrors).length > 0) {
            setAttempt((n) => n + 1);
            return;
        }

        submittingRef.current = true;
        setIsSubmitting(true);
        try {
            const created = await registerWithImg(name.trim(), email.trim(), password, DEFAULT_IDENTITY, avatarUrl);
            // 帳號建立當下的登入狀態事件發生在使用者資料寫入 Firestore 之前，全站共用的使用者資料
            // 會是空的；這裡用剛寫入的資料補上，跳到首頁後收藏、個人資料才讀得到。
            if (created?.uid) {
                updateUserData({ firestoreData: created.firestoreData, uid: created.uid, role: null });
            }
            setIsRegistered(true);
            redirectTimeoutRef.current = setTimeout(() => {
                navigate("/");
            }, AUTH_SUCCESS_REDIRECT_MS);
        } catch (error) {
            const message = authErrorMessage(error, "註冊失敗，請稍後再試");
            const field = FIELD_BY_ERROR_CODE[error?.code];
            if (field) {
                setFieldErrors({ [field]: message });
                setAttempt((n) => n + 1);
            } else {
                setErrorMsg(message);
            }
            setIsRegistered(false);
        } finally {
            submittingRef.current = false;
            setIsSubmitting(false);
        }
    };

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        const url = await selectFile(file);
        if (url) setAvatarUrl(url);
    };

    //載入動畫
    const animation = useLottieAnimation({ loadAnimationData: loadSuccessAnimation, enabled: isRegistered });

    // 確認密碼不一致：離開欄位或送出後才提示，打字途中不一直念錯誤給報讀器
    const confirmError = fieldErrors.confirm || (confirmTouched && isConfirmMismatch ? "兩次輸入的密碼不一致" : undefined);

    return (
        <div className="register-container">
            <div className="register-box">
                <h1 className="formTitle">註冊</h1>
                <p className="register-subtitle">立即體驗源·語</p>
                {(errorMsg || uploadError) && <Alert variant="danger" className="py-2">{errorMsg || uploadError}</Alert>}
                <form className="registerForm" onSubmit={handleRegister} noValidate ref={formRef}>
                    <div className="auth-field">
                        <label className="auth-field-label" htmlFor="avatarInput">大頭貼（選填）</label>
                        <div className="input-wrapper">
                            <img src={previewUrl || avatarImage} alt="使用者頭像預覽" style={{ height: "101px", padding: "inherit" }} />
                            <input
                                id="avatarInput"
                                type="file"
                                accept="image/*"
                                className="input-field"
                                onChange={handleFileChange}
                            />
                        </div>
                    </div>
                    <AuthField
                        label="使用者名稱"
                        icon={User}
                        type="text"
                        autoComplete="name"
                        required
                        value={name}
                        error={fieldErrors.name}
                        onChange={(e) => { setName(e.target.value); clearFieldError("name"); }}
                    />
                    <AuthField
                        label="電子郵件"
                        icon={Mail}
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        error={fieldErrors.email}
                        onChange={(e) => { setEmail(e.target.value); clearFieldError("email"); }}
                    />
                    <PasswordField
                        value={password}
                        onChange={(e) => { setPassword(e.target.value); clearFieldError("password"); }}
                        autoComplete="new-password"
                        error={fieldErrors.password}
                        describedBy={rulesId}
                    />
                    {/* 密碼規則：除了圖示顏色，還用文字寫出「已符合／未符合」（不靠顏色傳達狀態） */}
                    <ul className="password-rules" id={rulesId} aria-label="密碼規則">
                        <li className={`password-rule ${isPasswordValid ? "valid" : "invalid"}`}>
                            {isPasswordValid ? <CheckCircle size={20} aria-hidden="true" /> : <Circle size={20} aria-hidden="true" />}
                            <span>至少 {MIN_PASSWORD_LENGTH} 個字元</span>
                            <span className="password-rule-state">{isPasswordValid ? "已符合" : "未符合"}</span>
                        </li>
                    </ul>
                    <PasswordField
                        value={confirmPassword}
                        onChange={(e) => { setConfirmPassword(e.target.value); clearFieldError("confirm"); }}
                        onBlur={() => setConfirmTouched(true)}
                        label="確認密碼"
                        autoComplete="new-password"
                        error={confirmError}
                        announce={!fieldErrors.confirm}
                    />
                    <button type="submit" className="register-button" disabled={isUploading || isSubmitting}>
                        {isUploading ? "上傳頭像中…" : isSubmitting ? "註冊中…" : "註冊"}
                    </button>
                    {/* 另開新視窗：填到一半的表單不會因為去讀說明而消失 */}
                    <p className="register-consent">
                        我們如何使用你的資料，請見
                        <a href="/privacy" target="_blank" rel="noopener noreferrer">隱私與資料<span className="visually-hidden">（另開新視窗）</span></a>。
                    </p>
                    <p>已經有帳號了？
                        {onSwitchToLogin ? (
                            <a onClick={(e) => { e.preventDefault(); onSwitchToLogin(); }} href="/login">登入</a>
                        ) : (
                            <a href="/login">登入</a>
                        )}
                    </p>
                </form>
                <SuccessModal show={isRegistered} text="註冊成功！您將移至首頁" icon={<div ref={animation} />} onClose={skipWait} closeLabel="立即前往" />
            </div>
        </div>
    );
};
export default RegisterForm;
