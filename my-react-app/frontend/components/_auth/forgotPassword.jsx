import "../../static/css/_auth/forgotPassword.css"
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAuth, sendPasswordResetEmail } from "firebase/auth";

const ForgotPassword = () => {
    const navigate = useNavigate();

    const [email, setEmail] = useState("");
    const [message, setMessage] = useState("");
    const [isSuccess, setIsSuccess] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleReset = async (e) => {
        e.preventDefault();
        const auth = getAuth();
        setIsSubmitting(true);
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
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="forgot-container">
            <h2>忘記密碼</h2>
            <p className="instruction">請輸入您的電子郵件，我們會寄送重設密碼的連結。</p>

            <form onSubmit={handleReset}>
                <input
                    type="email"
                    placeholder="輸入您的 Email"
                    aria-label="電子郵件"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                />

                <div className="forgot-button">
                    <button type="button" className="forgot-cancel-btn" onClick={() => navigate(-1)}>取消</button>
                    <button type="submit" className="forgot-submit-btn" disabled={isSubmitting}>重設密碼</button>
                </div>
            </form>

            {message && (
                <div className={`message ${isSuccess ? "success" : "error"}`}>
                    {message}
                </div>
            )}
        </div>
    );
};
export default ForgotPassword;