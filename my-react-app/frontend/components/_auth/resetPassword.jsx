import "../../static/css/_auth/authPage.css"
import "../../static/css/_auth/authField.css"
import "../../static/css/_auth/resetPassword.css"
import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Alert } from "react-bootstrap";
import { getAuth, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { loadSuccessAnimation } from "../../src/animations/loaders";
import { useLottieAnimation } from "@hooks/useLottieAnimation";
import { authErrorMessage } from "@utils/firebaseAuthErrors";
import { waitForAuthReady } from "@utils/authReady";

const ResetPassword = () => {
    const navigate = useNavigate();

    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [isSuccess, setIsSuccess] = useState(false);
    const [errorMsg, setErrorMsg] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const animation = useLottieAnimation({ loadAnimationData: loadSuccessAnimation, enabled: isSuccess, loop: false });
    const redirectTimeoutRef = useRef(null);
    useEffect(() => () => clearTimeout(redirectTimeoutRef.current), []);

    const handleChangePassword = async (e) => {
        e.preventDefault();
        setErrorMsg("");
        setIsSubmitting(true);
        try {
            // 重新整理後 Firebase 要一下子才還原登入狀態：在送出時才讀 currentUser（不在 render 時讀，那時常常還是 null）
            await waitForAuthReady();
            const user = getAuth().currentUser;
            if (!user) {
                // 等不到登入狀態有兩種可能（真的過期、或網路慢還沒還原完），文字不下定論
                setErrorMsg("目前無法確認登入狀態，請重新整理頁面，必要時重新登入後再變更密碼。");
                return;
            }
            // 驗證使用者
            const credential = EmailAuthProvider.credential(user.email, currentPassword);
            await reauthenticateWithCredential(user, credential);

            // 更新密碼
            await updatePassword(user, newPassword);
            setIsSuccess(true);

            redirectTimeoutRef.current = setTimeout(() => {
                navigate(-1);
            }, 1500);

        } catch (error) {
            console.error("密碼更新失敗: " + error.message);
            setIsSuccess(false);
            if (error.code === "auth/wrong-password" || error.code === "auth/invalid-credential") {
                setErrorMsg("密碼錯誤，請再試一次。");
            } else if (error.code === "auth/weak-password") {
                setErrorMsg("新密碼強度不足，請使用至少 6 個字元。");
            } else {
                setErrorMsg(authErrorMessage(error, "密碼更新失敗"));
            }
        } finally {
            setIsSubmitting(false);
        };
    };

    return (
        <div className="auth-backdrop">
        <div className="reset-container">
            <h1>變更密碼</h1>
            <form onSubmit={handleChangePassword}>
                <div className="auth-field">
                    <label className="auth-field-label" htmlFor="reset-current-password">目前密碼</label>
                    <input
                        id="reset-current-password"
                        type="password"
                        placeholder="目前密碼"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                </div>
                <div className="auth-field">
                    <label className="auth-field-label" htmlFor="reset-new-password">新密碼</label>
                    <input
                        id="reset-new-password"
                        type="password"
                        placeholder="新密碼"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                    />
                </div>

                <div className="reset-button">
                    <button type="button" className="reset-cancel-btn" onClick={() => navigate(-1)}>取消</button>
                    <button type="submit" className="reset-submit-btn" disabled={isSubmitting}>變更密碼</button>
                </div>
            </form>

            {errorMsg && <Alert variant="danger" className="py-2 mt-3">{errorMsg}</Alert>}

            {isSuccess && (
                <div className="yy-success-overlay">
                    <div className="yy-success-card">
                        <div ref={animation} />
                        <p>密碼更新成功！將移至編輯資料頁面</p>
                    </div>
                </div>
            )}
        </div>
        </div>
    );
};
export default ResetPassword;
