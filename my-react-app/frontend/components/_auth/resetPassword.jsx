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
import SuccessModal from "../ui/SuccessModal";

// 與註冊表單相同的最低長度（Firebase 預設也是 6）：先在前端擋，不必送出才被告知強度不足
const MIN_PASSWORD_LENGTH = 6;
const SUCCESS_REDIRECT_MS = 1500;
// 成功後回到明確的編輯資料頁。原本是 navigate(-1)，直接開 /reset 時會離開網站，文案也對不上（稽核 FE1-17、FE1-21）
const AFTER_SUCCESS_PATH = "/edit";

const ResetPassword = () => {
    const navigate = useNavigate();

    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [fieldErrors, setFieldErrors] = useState({});
    const [attempt, setAttempt] = useState(0);
    const [isSuccess, setIsSuccess] = useState(false);
    const [errorMsg, setErrorMsg] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const formRef = useRef(null);
    const animation = useLottieAnimation({ loadAnimationData: loadSuccessAnimation, enabled: isSuccess, loop: false });
    const redirectTimeoutRef = useRef(null);
    useEffect(() => () => clearTimeout(redirectTimeoutRef.current), []);

    // 送出後有欄位錯誤時，把焦點移到第一個有問題的欄位（和登入、註冊表單相同）
    useEffect(() => {
        if (attempt === 0) return;
        formRef.current?.querySelector('[aria-invalid="true"]')?.focus();
    }, [attempt]);

    const goToEdit = () => {
        clearTimeout(redirectTimeoutRef.current);
        navigate(AFTER_SUCCESS_PATH);
    };

    const clearFieldError = (field) => {
        if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    };

    const handleChangePassword = async (e) => {
        e.preventDefault();
        setErrorMsg("");

        // 稽核 FE1-17：新密碼原本只輸入一次，打錯就只能走忘記密碼；加確認欄與前端長度檢查
        const nextFieldErrors = {};
        if (!currentPassword) nextFieldErrors.current = "請輸入目前密碼";
        if (newPassword.length < MIN_PASSWORD_LENGTH) nextFieldErrors.next = `新密碼至少需要 ${MIN_PASSWORD_LENGTH} 個字元`;
        if (newPassword !== confirmPassword) nextFieldErrors.confirm = "兩次輸入的新密碼不一致";
        setFieldErrors(nextFieldErrors);
        if (Object.keys(nextFieldErrors).length > 0) {
            setAttempt((n) => n + 1);
            return;
        }

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
                navigate(AFTER_SUCCESS_PATH);
            }, SUCCESS_REDIRECT_MS);

        } catch (error) {
            console.error("密碼更新失敗: " + error.message);
            setIsSuccess(false);
            if (error.code === "auth/wrong-password" || error.code === "auth/invalid-credential") {
                setErrorMsg("密碼錯誤，請再試一次。");
            } else if (error.code === "auth/weak-password") {
                setErrorMsg("新密碼強度不足，請使用至少 6 個字元。");
            } else {
                setErrorMsg(authErrorMessage(error, "密碼更新失敗，請稍後再試，或重新申請重設連結。"));
            }
        } finally {
            setIsSubmitting(false);
        };
    };

    const renderField = ({ id, field, label, value, onChange, autoComplete }) => {
        const error = fieldErrors[field];
        const errorId = `${id}-error`;
        return (
            <div className="auth-field">
                <label className="auth-field-label" htmlFor={id}>{label}</label>
                <input
                    id={id}
                    type="password"
                    placeholder={label}
                    // 稽核 FE1-17：讓密碼管理工具分得出哪一欄是目前密碼、哪一欄是新密碼
                    autoComplete={autoComplete}
                    value={value}
                    onChange={(e) => { onChange(e.target.value); clearFieldError(field); }}
                    aria-invalid={error ? "true" : undefined}
                    aria-describedby={error ? errorId : undefined}
                />
                {error && <p id={errorId} className="auth-field-error">{error}</p>}
            </div>
        );
    };

    return (
        <div className="auth-backdrop">
        <div className="reset-container">
            <h1>變更密碼</h1>
            <form onSubmit={handleChangePassword} noValidate ref={formRef}>
                {renderField({ id: "reset-current-password", field: "current", label: "目前密碼", value: currentPassword, onChange: setCurrentPassword, autoComplete: "current-password" })}
                {renderField({ id: "reset-new-password", field: "next", label: "新密碼", value: newPassword, onChange: setNewPassword, autoComplete: "new-password" })}
                {renderField({ id: "reset-confirm-password", field: "confirm", label: "確認新密碼", value: confirmPassword, onChange: setConfirmPassword, autoComplete: "new-password" })}

                <div className="reset-button">
                    <button type="button" className="reset-cancel-btn" onClick={() => navigate(-1)}>取消</button>
                    <button type="submit" className="reset-submit-btn" disabled={isSubmitting || isSuccess}>變更密碼</button>
                </div>
            </form>

            {errorMsg && <Alert variant="danger" className="py-2 mt-3">{errorMsg}</Alert>}

            {/* 稽核 FE1-17：原本的成功覆蓋層沒有 role、也不移動焦點，1.5 秒後就跳頁，報讀器使用者不知道成功了。
                改用 SuccessModal（role=dialog、焦點移入並以文字當名稱），也提供「立即前往」與 Esc。 */}
            <SuccessModal
                show={isSuccess}
                text="密碼更新成功！將移至編輯資料頁面"
                icon={<div ref={animation} />}
                onClose={goToEdit}
                closeLabel="立即前往"
            />
        </div>
        </div>
    );
};
export default ResetPassword;
