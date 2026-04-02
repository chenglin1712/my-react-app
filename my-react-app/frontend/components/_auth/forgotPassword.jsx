import "../../static/css/_auth/forgotPassword.css"
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAuth, sendPasswordResetEmail } from "firebase/auth";

const Forgot = () => {
    const navigate = useNavigate();

    const [email, setEmail] = useState("");
    const [message, setMessage] = useState("");
    const [isSuccess, setIsSuccess] = useState(null);

    const handleReset = async () => {
        const auth = getAuth();
        try {
            await sendPasswordResetEmail(auth, email);
            setMessage("已寄送密碼重設信件，請至信箱確認。");
            setIsSuccess(true);
        } catch (error) {
            console.error("重設信件寄送失敗：", error);
            switch (error.code) {
                case "auth/invalid-email":
                    setMessage("Email 格式不正確");
                    break;
                case "auth/user-not-found":
                    setMessage("找不到此 Email 對應的帳號");
                    break;
                default:
                    setMessage("寄送失敗");
            }
            setIsSuccess(false);
        }
    };

    return (
        <div className="forgot-container">
            <h2>忘記密碼</h2>
            <p className="instruction">請輸入您的電子郵件，我們會寄送重設密碼的連結。</p>

            <input
                type="email"
                placeholder="輸入您的 Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
            />

            <div className="forgot-button">
                <button className="forgot-cancel-btn" onClick={() => navigate(-1)}>取消</button>
                <button className="forgot-submit-btn" onClick={handleReset}>重設密碼</button>
            </div>

            {message && (
                <div className={`message ${isSuccess ? "success" : "error"}`}>
                    {message}
                </div>
            )}
        </div>
    );
};
export default Forgot;