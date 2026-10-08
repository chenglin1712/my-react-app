import { useState } from "react";
import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import "../../static/css/_auth/passwordField.css";

// 密碼欄位：左側鎖頭圖示、右側「顯示／隱藏密碼」按鈕，並在大寫鎖定開啟時提示
// （輸入密碼時沒注意到大寫鎖定是登入失敗最常見的原因之一）。
// 外層沿用登入與註冊表單共用的 input-wrapper／input-field 樣式。
const PasswordField = ({ value, onChange, placeholder = "密碼", ariaLabel = "密碼", autoComplete = "current-password" }) => {
    const [visible, setVisible] = useState(false);
    const [capsLock, setCapsLock] = useState(false);

    return (
        <>
            <div className="input-wrapper">
                <LockKeyhole size={24} className="icon" />
                <input
                    type={visible ? "text" : "password"}
                    className="input-field"
                    placeholder={placeholder}
                    aria-label={ariaLabel}
                    autoComplete={autoComplete}
                    required
                    value={value}
                    onChange={onChange}
                    onKeyUp={(e) => setCapsLock(Boolean(e.getModifierState?.("CapsLock")))}
                    onBlur={() => setCapsLock(false)}
                />
                <button
                    type="button"
                    className="password-toggle"
                    aria-label={visible ? `隱藏${ariaLabel}` : `顯示${ariaLabel}`}
                    aria-pressed={visible}
                    onClick={() => setVisible((v) => !v)}
                >
                    {visible ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
            </div>
            {capsLock && <p className="password-caps-hint" role="status">大寫鎖定已開啟</p>}
        </>
    );
};

export default PasswordField;
