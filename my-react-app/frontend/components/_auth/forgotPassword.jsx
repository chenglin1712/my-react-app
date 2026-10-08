import "../../static/css/_auth/forgotPassword.css"
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAuth, sendPasswordResetEmail } from "firebase/auth";
import { authErrorMessage } from "@utils/firebaseAuthErrors";

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
            if (error.code === "auth/user-not-found") {
                // 不論有沒有這個帳號都顯示同樣的結果，避免這個頁面被拿來探測哪些 Email 已註冊
                setMessage("已寄送密碼重設信件，請至信箱確認。");
                setIsSuccess(true);
            } else {
                setMessage(authErrorMessage(error, "寄送失敗，請稍後再試"));
                setIsSuccess(false);
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="forgot-container">
            <h1>忘記密碼</h1>
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
                <div className={`forgot-message ${isSuccess ? "success" : "error"}`}>
                    {message}
                </div>
            )}
        </div>
    );
};
export default ForgotPassword;