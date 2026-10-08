import "../../static/css/_auth/registerForm.css"
import { User, Mail, Footprints, CheckCircle } from "lucide-react"
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert } from "react-bootstrap";
import avatarImage from '../../static/assets/_auth/avatar.webp';
import { registerWithImg } from "../../src/userServives/userServive"
import successAnimation from "../../src/animations/success.json"
import SuccessModal from "../ui/SuccessModal";
import { useLottieAnimation } from "@hooks/useLottieAnimation";
import { useAvatarUpload } from "@hooks/useAvatarUpload";
import { authErrorMessage } from "@utils/firebaseAuthErrors";
import PasswordField from "./PasswordField";

const RegisterForm = ({ onSwitchToLogin }) => {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [identity, setIdentity] = useState("學生");
    const [errorMsg, setErrorMsg] = useState("");
    const isPasswordValid = password.length >= 6;
    const isConfirmMismatch = confirmPassword.length > 0 && confirmPassword !== password;

    const { previewUrl, isUploading, uploadError, selectFile } = useAvatarUpload();
    const [avatarUrl, setAvatarUrl] = useState(null);

    const [isRegistered, setIsRegistered] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const navigate = useNavigate();
    const redirectTimeoutRef = useRef(null);
    useEffect(() => () => clearTimeout(redirectTimeoutRef.current), []);

    //使用者註冊
    const handleRegister = async (e) => {
        e.preventDefault();
        setErrorMsg("");
        if (password !== confirmPassword) {
            setErrorMsg("兩次輸入的密碼不一致");
            return;
        }
        setIsSubmitting(true);
        try {
            await registerWithImg(name, email, password, identity, avatarUrl);
            setIsRegistered(true);
            redirectTimeoutRef.current = setTimeout(() => {
                navigate("/login");
            }, 1500);
        } catch (error) {
            setErrorMsg(authErrorMessage(error, "註冊失敗，請稍後再試"));
            setIsRegistered(false);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        const url = await selectFile(file);
        if (url) setAvatarUrl(url);
    };

    //加載動畫
    const animation = useLottieAnimation({ animationData: successAnimation, enabled: isRegistered });

    return (
        <div className="register-container">
            <div className="register-box">
                <h1 className="formTitle">註冊</h1>
                <p className="register-subtitle">立即體驗源·語
                    <button type="button" onClick={() => alert("敬請期待")}>
                        <Footprints size={22} />訪客登入
                    </button>
                </p>
                {(errorMsg || uploadError) && <Alert variant="danger" className="py-2">{errorMsg || uploadError}</Alert>}
                <form action="#" className="registerForm" onSubmit={handleRegister}>
                    <div className="input-wrapper">
                        <img src={previewUrl || avatarImage} alt="使用者頭像預覽" style={{ height: "101px", padding: "inherit" }} />
                        <input
                            id="avatarInput"
                            type="file"
                            accept="image/*"
                            className="input-field"
                            aria-label="上傳大頭貼"
                            onChange={handleFileChange}
                        />
                    </div>
                    <div className="input-wrapper">
                        <User size={24} className="icon" />
                        <input type="text" className="input-field" placeholder="使用者名稱" aria-label="使用者名稱" autoComplete="name" required onChange={(e) => setName(e.target.value)} />
                    </div>
                    <div className="input-wrapper">
                        <Mail size={24} className="icon" />
                        <input type="email" className="input-field" placeholder="帳號" aria-label="帳號" autoComplete="email" required onChange={(e) => setEmail(e.target.value)} />
                    </div>
                    <PasswordField value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
                    <div className="password-requirements">
                        <span className={`check-icon ${isPasswordValid ? 'valid' : 'invalid'}`} aria-hidden="true">
                            <CheckCircle size={20} />
                        </span>
                        <p>密碼至少需要 6 個字元</p>
                    </div>
                    <PasswordField value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="再次輸入密碼" ariaLabel="確認密碼" autoComplete="new-password" />
                    {isConfirmMismatch && <p className="password-requirements" role="alert">兩次輸入的密碼不一致</p>}
                    <div className="input-wrapper">
                        <select name="identity" className="input-field" style={{ cursor: "pointer" }} aria-label="身分" value={identity} onChange={(e) => setIdentity(e.target.value)}>
                            <option value="學生">學生</option>
                        </select>
                    </div>
                    <button type="submit" className="register-button" disabled={isUploading || isSubmitting}>
                        {isUploading ? "上傳頭像中..." : "註冊"}
                    </button>
                    <p>已經有帳戶了?
                        {onSwitchToLogin ? (
                            <a onClick={(e) => { e.preventDefault(); onSwitchToLogin(); }} href="/login">登入</a>
                        ) : (
                            <a href="/login">登入</a>
                        )}
                    </p>
                </form>
                <SuccessModal show={isRegistered} text="註冊成功！您將移至登入頁面" icon={<div ref={animation} />} />
            </div>
        </div>
    );
};
export default RegisterForm;