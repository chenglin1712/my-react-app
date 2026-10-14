import { useId } from "react";
import "../../static/css/_auth/authField.css";

// 登入／註冊表單共用的文字欄位：可見的 label 在欄位上方（不再用 placeholder 當標籤），
// 錯誤訊息放在欄位正下方並用 aria-describedby 綁定，報讀器聚焦到欄位時會一起念出。
// 外層沿用登入與註冊表單共用的 input-wrapper／input-field 樣式。
// 欄位錯誤預設不用 role="alert"：送出失敗時焦點會移到第一個有問題的欄位，報讀器會連同
// aria-describedby 的錯誤一起念；再加即時公告會重複朗讀。
const AuthField = ({ label, icon: Icon, error, hint, ...inputProps }) => {
    const id = useId();
    const hintId = `${id}-hint`;
    const errorId = `${id}-error`;
    const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(" ") || undefined;

    return (
        <div className="auth-field">
            <label className="auth-field-label" htmlFor={id}>{label}</label>
            <div className="input-wrapper" data-invalid={error ? "true" : undefined}>
                {Icon && <Icon size={24} className="icon" aria-hidden="true" />}
                <input
                    {...inputProps}
                    id={id}
                    className="input-field"
                    aria-invalid={error ? "true" : undefined}
                    aria-describedby={describedBy}
                />
            </div>
            {hint && <p id={hintId} className="auth-field-hint">{hint}</p>}
            {error && <p id={errorId} className="auth-field-error">{error}</p>}
        </div>
    );
};

export default AuthField;
