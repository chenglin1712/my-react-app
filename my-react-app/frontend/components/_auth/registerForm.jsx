import "../../static/css/_auth/registerForm.css"
import { User, Mail, LockKeyhole, Footprints, CheckCircle } from "lucide-react"
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import avatarImage from '../../static/assets/_auth/avatar.webp';
import { registerWithImg } from "../../src/userServives/userServive"
import lottie from 'lottie-web';
import successAnimation from "../../src/animations/success.json"

const RegisterForm = () => {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [isPasswordValid, setIsPasswordValid] = useState(false);
    const [identity, setIdentity] = useState("學生");

    const [preview, setPreview] = useState(null);
    const [avatarUrl, setAvatarUrl] = useState(null);
    const [isUploading, setIsUploading] = useState(false);

    const [isRegistered, setIsRegistered] = useState(false);
    const navigate = useNavigate();
    const animation = useRef(null);

    //使用者註冊
    const handleRegister = async () => {
        try {
            await registerWithImg(name, email, password, identity, avatarUrl);
            setIsRegistered(true);
            setTimeout(() => {
                navigate("/login");
            }, 1500);
        } catch (error) {
            if (error.code === "auth/email-already-in-use") {
                alert("Email 已被註冊過");
            } else {
                alert("註冊失敗");
            }
            setIsRegistered(false);
        }
    };

    //確認密碼使否符合規定
    const handlePasswordChange = (e) => {
        const value = e.target.value;
        setPassword(value);

        if (value.length >= 6) {
            setIsPasswordValid(true);
        } else {
            setIsPasswordValid(false);
        }
    };

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setPreview(URL.createObjectURL(file));
        setIsUploading(true);

        const formData = new FormData();
        formData.append("file", file);
        formData.append("upload_preset", import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET);
        formData.append("cloud_name", import.meta.env.VITE_CLOUDINARY_CLOUD_NAME);

        try {
            const res = await fetch(`https://api.cloudinary.com/v1_1/${import.meta.env.VITE_CLOUDINARY_CLOUD_NAME}/image/upload/f_auto,q_auto`, {
                method: "POST",
                body: formData
            });
            const data = await res.json();
            setAvatarUrl(data.secure_url);
        } catch (error) {
            console.error("圖片上傳失敗", error);
            alert("圖片上傳失敗");
        } finally {
            setIsUploading(false);
        }
    };

    //加載動畫
    useEffect(() => {
        if (isRegistered) {
            const instance = lottie.loadAnimation({
                container: animation.current,
                renderer: 'svg',
                loop: true,
                autoplay: true,
                animationData: successAnimation,
            });
            return () => instance.destroy();
        }
    }, [isRegistered]);

    return (
        <div className="register-container">
            <div className="register-box">
                <h2 className="formTitle">註冊</h2>
                <p className="register-subtitle">立即體驗源·語
                    <button>
                        <Footprints size={22} />訪客登入
                    </button>
                </p>
                <form action="#" className="registerForm">
                    <div className="input-wrapper">
                        <img src={preview || avatarImage} style={{ height: "101px", padding: "inherit" }} />
                        <input
                            id="avatarInput"
                            type="file"
                            accept="image/*"
                            className="input-field"
                            onChange={handleFileChange}
                        />
                    </div>
                    <div className="input-wrapper">
                        <User size={24} className="icon" />
                        <input type="text" className="input-field" placeholder="使用者名稱" required onChange={(e) => setName(e.target.value)} />
                    </div>
                    <div className="input-wrapper">
                        <Mail size={24} className="icon" />
                        <input type="email" className="input-field" placeholder="帳號" required onChange={(e) => setEmail(e.target.value)} />
                    </div>
                    <div className="input-wrapper">
                        <LockKeyhole size={24} className="icon" />
                        <input type="password" className="input-field" placeholder="密碼" required onChange={handlePasswordChange} value={password} />
                    </div>
                    <div className="password-requirements">
                        <span className={`check-icon ${isPasswordValid ? 'valid' : 'invalid'}`}>
                            <CheckCircle size={20} />
                        </span>
                        <p>密碼至少需要 6 個字元</p>
                    </div>
                    <div className="input-wrapper">
                        <select name="identity" className="input-field" style={{ cursor: "pointer" }} value={identity} onChange={(e) => setIdentity(e.target.value)}>
                            <option value="學生">學生</option>
                        </select>
                    </div>
                    <button type="button" className="register-button" onClick={handleRegister} disabled={isUploading}>
                        {isUploading ? "上傳頭像中..." : "註冊"}
                    </button>
                    <p>已經有帳戶了?<a href="/login">登入</a></p>
                </form>
                {isRegistered && (
                    <div className="overlay">
                        <div className="animation-container">
                            <div ref={animation} />
                            <p>註冊成功！您將移至登入頁面</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
export default RegisterForm;