import "../../static/css/_auth/resetPassword.css"
import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getAuth, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import lottie from 'lottie-web';
import successAnimation from "../../src/animations/success.json"

const Forgot = ({ }) => {
    const auth = getAuth();
    const user = auth.currentUser;
    const navigate = useNavigate();

    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [isSuccess, setIsSuccess] = useState(false);
    const animation = useRef(null);

    const handleChangePassword = async () => {
        try {
            // 驗證使用者
            const credential = EmailAuthProvider.credential(user.email, currentPassword);
            await reauthenticateWithCredential(user, credential);

            // 更新密碼
            await updatePassword(user, newPassword);
            setIsSuccess(true);

            setTimeout(() => {
                navigate(-1);
            }, 1500);

        } catch (error) {
            console.error("密碼更新失敗: " + error.message);
            setIsSuccess(false);
            switch (error.code) {
                case "auth/wrong-password":
                case "auth/invalid-credential":
                    alert("密碼錯誤，請再試一次。");
                    break;
                case "auth/weak-password":
                    alert("新密碼強度不足，請使用至少 6 個字元。");
                    break;
                default:
                    alert("密碼更新失敗");
            };
        };
    };

    useEffect(() => {
        if (isSuccess && animation.current) {
            const instance = lottie.loadAnimation({
                container: animation.current,
                renderer: "svg",
                loop: false,
                autoplay: true,
                animationData: successAnimation
            });

            return () => instance.destroy();
        }
    }, [isSuccess]);

    return (
        <div className="reset-container">
            <h2>變更密碼</h2>
            <input
                type="password"
                placeholder="目前密碼"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
            />
            <input
                type="password"
                placeholder="新密碼"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
            />

            <div className="reset-button">
                <button className="reset-cancel-btn" onClick={() => navigate(-1)}>取消</button>
                <button className="reset-submit-btn" onClick={handleChangePassword}>變更密碼</button>
            </div>

            {isSuccess && (
                <div className="overlay">
                    <div className="animation-container">
                        <div ref={animation} />
                        <p>密碼更新成功！將移至編輯資料頁面</p>
                    </div>
                </div>
            )}
        </div>
    );
};
export default Forgot;