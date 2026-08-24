import "../../static/css/_auth/editProfile.css"
import { Edit2, User, Mail, Shield, Save, Calendar, Lock } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Alert } from "react-bootstrap";
import AvatarImg from "../../static/assets/_auth/avatar.webp"
import { useNavigate } from "react-router-dom";
import { updateProfile } from "../../src/userServives/userServive"
import { useAuth } from "../../src/userServives/authContext"
import { useAvatarUpload } from "@hooks/useAvatarUpload";

const Edit = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const userData = location.state;
    const [formData, setFormData] = useState({
        name: userData.firestoreData.name,
        email: userData.firestoreData.email,
        identity: userData.firestoreData.identity,
        joinDate: userData.firestoreData.joinDate,
        password: "********", //firebase auth不提供直接取得密碼
        avatarUrl: userData.firestoreData.avatarUrl ? userData.firestoreData.avatarUrl : AvatarImg
    });

    const [errorMsg, setErrorMsg] = useState("");
    //上傳圖片到cloudinary（transform: false 維持原本純 image/upload、
    //不加 f_auto,q_auto 的行為）
    const { previewUrl, isUploading, uploadError, selectFile } = useAvatarUpload({
        initialPreviewUrl: formData.avatarUrl,
        uploadOptions: { transform: false },
    });

    const handleChange = async (e) => {
        const file = e.target.files[0];
        const secureUrl = await selectFile(file);
        if (secureUrl) setFormData(prev => ({ ...prev, avatarUrl: secureUrl }));
    };

    const handleInputChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const { userData: authUser, updateUserData } = useAuth();
    const handleSave = async () => {
        setErrorMsg("");
        try {
            const result = await updateProfile(userData.uid, formData);

            if (result.success) {
                // 只換掉 firestoreData、保留 authUser 其他既有欄位（uid、role 等）。
                // 原本直接把 updateProfile() 的回傳值整包丟給 updateUserData()，
                // 但那個回傳值是 {success, firestoreData, uid}，沒有 role——
                // AuthContext 是整包覆蓋而非合併，所以存檔後 role 會被清空，
                // 直到下次登入／auth 狀態變化才會補回來。
                updateUserData({ ...authUser, firestoreData: result.firestoreData });
                navigate("/");
            } else {
                setErrorMsg("失敗: " + result.message);
            }
        } catch {
            setErrorMsg("更新失敗");
        }
    };

    return (
        <div className="edit-container">
            <h2 className="edit-title">編輯個人資料</h2>
            {(errorMsg || uploadError) && <Alert variant="danger" className="py-2">{errorMsg || uploadError}</Alert>}

            <label className="avatar-uploader" htmlFor="edit-avatar-input">
                <img src={previewUrl} alt="頭像" className="avatar-image" />
                <div className="edit-overlay">
                    <Edit2 size={18} />
                    <span>{isUploading ? "上傳中..." : "變更圖片"}</span>
                </div>
                <input
                    id="edit-avatar-input"
                    type="file"
                    accept="image/*"
                    onChange={handleChange}
                    aria-label="變更圖片"
                    className="visually-hidden"
                />
            </label>

            <div className="edit-form">
                <div className="form-group">
                    <label htmlFor="profile-name-input"><User size={16} /> 姓名</label>
                    <input
                        id="profile-name-input"
                        type="text"
                        value={formData.name}
                        onChange={e => handleInputChange("name", e.target.value)}
                        placeholder="請輸入您的姓名"
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="profile-identity-select"><Shield size={16} /> 身分</label>
                    <select
                        id="profile-identity-select"
                        value={formData.identity}
                        onChange={e => handleInputChange("identity", e.target.value)}
                    >
                        <option>學生</option>
                        <option>教師</option>
                        <option>其他</option>
                    </select>
                </div>

                <div className="form-group">
                    <label htmlFor="profile-joindate-input"><Calendar size={16} /> 加入日期</label>
                    <input
                        id="profile-joindate-input"
                        type="text"
                        value={new Date(formData.joinDate).toLocaleDateString("zh-TW")}
                        disabled
                        style={{ backgroundColor: "#f5f5f5", color: "#888" }}
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="profile-email-input"><Mail size={16} /> 信箱</label>
                    <input
                        id="profile-email-input"
                        type="email"
                        value={formData.email}
                        disabled
                        style={{ backgroundColor: "#f5f5f5", cursor: "not-allowed" }}
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="profile-password-input"><Lock size={16} /> 密碼</label>
                    <input
                        id="profile-password-input"
                        type="password"
                        value={formData.password}
                        disabled
                        style={{ backgroundColor: "#f5f5f5", cursor: "not-allowed" }}
                    />
                    <Link className="forgot-pass" to="/reset">變更密碼</Link>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", marginTop: "24px" }}>
                    <button className="cancel-btn" type="button" onClick={() => window.history.back()}>
                        取消
                    </button>

                    <button className="save-btn" onClick={handleSave}>
                        <Save size={16} /> 儲存變更
                    </button>
                </div>
            </div>
        </div>
    );
};
export default Edit;