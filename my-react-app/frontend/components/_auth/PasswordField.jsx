import { useId, useState } from "react";
import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import "../../static/css/_auth/authField.css";
import "../../static/css/_auth/passwordField.css";

// 密碼欄位：可見標籤在上方、左側鎖頭圖示、右側「顯示／隱藏密碼」按鈕，並在大寫鎖定開啟時提示
// （輸入密碼時沒注意到大寫鎖定是登入失敗最常見的原因之一）。
// error 顯示在欄位正下方；describedBy 讓呼叫端把欄位外的說明（例如密碼規則清單）一起綁給報讀器。
// 外層沿用登入與註冊表單共用的 input-wrapper／input-field 樣式。
// announce：錯誤是在焦點離開欄位後才出現（例如確認密碼不一致）時設為 true，讓報讀器即時念出
const PasswordField = ({ value, onChange, onBlur, label = "密碼", autoComplete = "current-password", error, describedBy, announce = false }) => {
    const id = useId();
    const errorId = `${id}-error`;
    const [visible, setVisible] = useState(false);
    const [capsLock, setCapsLock] = useState(false);
    const allDescribedBy = [describedBy, error && errorId].filter(Boolean).join(" ") || undefined;

    return (
        <div className="auth-field">
            <label className="auth-field-label" htmlFor={id}>{label}</label>
            <div className="input-wrapper" data-invalid={error ? "true" : undefined}>
                <LockKeyhole size={24} className="icon" aria-hidden="true" />
                <input
                    id={id}
                    type={visible ? "text" : "password"}
                    className="input-field"
                    autoComplete={autoComplete}
                    required
                    value={value}
                    onChange={onChange}
                    aria-invalid={error ? "true" : undefined}
                    aria-describedby={allDescribedBy}
                    onKeyUp={(e) => setCapsLock(Boolean(e.getModifierState?.("CapsLock")))}
                    onBlur={(e) => { setCapsLock(false); onBlur?.(e); }}
                />
                <button
                    type="button"
                    className="password-toggle"
                    aria-label={visible ? `隱藏${label}` : `顯示${label}`}
                    aria-pressed={visible}
                    onClick={() => setVisible((v) => !v)}
                >
                    {visible ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
            </div>
            {capsLock && <p className="password-caps-hint" role="status">大寫鎖定已開啟</p>}
            {error && <p id={errorId} className="auth-field-error" role={announce ? "alert" : undefined}>{error}</p>}
        </div>
    );
};

export default PasswordField;
