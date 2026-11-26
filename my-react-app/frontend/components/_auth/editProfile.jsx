import "../../static/css/_auth/editProfile.css"
import { Edit2, User, Mail, Shield, Save, Calendar, Lock } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Alert } from "react-bootstrap";
import AvatarImg from "../../static/assets/_auth/avatar.webp"
import { useNavigate } from "react-router-dom";
import { updateProfile } from "../../src/userServives/userServive"
import { useAuth } from "../../src/userServives/authContext"
import { useAvatarUpload } from "@hooks/useAvatarUpload";
import { DelayedSkeleton } from "../ui/StateViews";

const NAME_ERROR_ID = "profile-name-error";

// 稽核 FE1-07：原本使用者資料只從 location.state 取（唯一來源是側欄 navigate('/edit', { state })），
// 直接開 /edit（書籤、重新輸入網址、新分頁）時 state 是空的，讀 firestoreData.name 就拋 TypeError。
// 改以 AuthContext 的 userData 為主要來源，state 只當備用；資料還沒載入顯示骨架，缺個人資料時顯示說明。
const Edit = () => {
    const location = useLocation();
    const { userData: authUser, loading } = useAuth();
    // 稽核 FE1-03／FE1-07：讀不到 Firestore 時 userServive 給的是降級資料（profileUnavailable，身分空白、頭像 null）。
    // 不能拿來填表單：按下儲存會把 Firestore 裡真正的姓名、身分、頭像蓋成降級值。這時當作「讀不到」，
    // 等背景重讀成功（AuthContext 換成完整資料）才顯示表單。location.state 是側欄給的同一份資料，降級時一樣不用。
    const isUsable = (u) => Boolean(u?.firestoreData) && u.firestoreData.profileUnavailable !== true;
    const profileUser = isUsable(authUser)
        ? authUser
        : (!authUser?.firestoreData && isUsable(location.state) ? location.state : null);
    const profileUnavailable = authUser?.firestoreData?.profileUnavailable === true;

    if (!profileUser) {
        if (loading) {
            return (
                <div className="edit-container">
                    <DelayedSkeleton label="正在載入個人資料…" rows={[96, 56, 56, 56]} />
                </div>
            );
        }
        return (
            <div className="edit-container">
                <h1 className="edit-title">編輯個人資料</h1>
                <Alert variant="warning" className="py-2">
                    {profileUnavailable
                        ? "目前讀不到你的個人資料，系統會自動重試；讀到之後這裡就會顯示編輯表單。"
                        : "目前讀不到你的個人資料，請重新整理頁面；若問題持續，請登出後重新登入。"}
                </Alert>
                <Link to="/">回到首頁</Link>
            </div>
        );
    }
    // 換帳號時表單整個重新初始化，不沿用上一位的輸入
    return <EditForm key={profileUser.uid} profileUser={profileUser} />;
};

const EditForm = ({ profileUser }) => {
    const navigate = useNavigate();
    const profile = profileUser.firestoreData;
    const [formData, setFormData] = useState({
        name: profile.name ?? "",
        email: profile.email ?? "",
        identity: profile.identity ?? "學生",
        joinDate: profile.joinDate,
        password: "********", //firebase auth不提供直接取得密碼
        avatarUrl: profile.avatarUrl ? profile.avatarUrl : AvatarImg
    });

    const [errorMsg, setErrorMsg] = useState("");
    const [nameError, setNameError] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    // 稽核 FE1-18：同步的送出鎖。isSaving 要等 render 後按鈕才 disabled，連按兩次會送出兩次 updateDoc
    const savingRef = useRef(false);
    const nameInputRef = useRef(null);
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
        if (field === "name" && nameError) setNameError("");
    };

    const { userData: authUser, updateUserData } = useAuth();
    const handleSave = async () => {
        // 稽核 FE1-18：頭像上傳中儲存會存到舊頭像網址並立刻離開，上傳結果被丟掉；按鈕已停用，這裡再擋一次
        if (savingRef.current || isUploading) return;
        setErrorMsg("");
        const name = formData.name.trim();
        if (!name) {
            // 稽核 FE1-18：姓名不可存成空白（導覽列、側欄都靠它顯示使用者）
            setNameError("請輸入姓名");
            nameInputRef.current?.focus();
            return;
        }
        savingRef.current = true;
        setIsSaving(true);
        try {
            const result = await updateProfile(profileUser.uid, { ...formData, name });

            if (result.success) {
                // 只換掉 firestoreData、保留 authUser 其他既有欄位（uid、role 等）。
                // 原本直接把 updateProfile() 的回傳值整包丟給 updateUserData()，
                // 但那個回傳值是 {success, firestoreData, uid}，沒有 role——
                // AuthContext 是整包覆蓋而非合併，所以存檔後 role 會被清空，
                // 直到下次登入／auth 狀態變化才會補回來。
                updateUserData({ ...(authUser ?? profileUser), firestoreData: result.firestoreData });
                navigate("/");
                return;
            }
            setErrorMsg(`${String(result.message || "更新失敗").replace(/[。！!，,\s]+$/u, "")}，請修改後再試一次。`);
        } catch {
            setErrorMsg("更新失敗，請檢查網路後再試一次。");
        }
        savingRef.current = false;
        setIsSaving(false);
    };

    const saveDisabled = isUploading || isSaving;
    const saveLabel = isUploading ? "頭像上傳中…" : (isSaving ? "儲存中…" : "儲存變更");

    return (
        <div className="edit-container">
            <h1 className="edit-title">編輯個人資料</h1>
            {(errorMsg || uploadError) && <Alert variant="danger" className="py-2">{errorMsg || uploadError}</Alert>}

            <label className="avatar-uploader" htmlFor="edit-avatar-input">
                <img decoding="async" src={previewUrl} alt="頭像" className="avatar-image" />
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
                        ref={nameInputRef}
                        type="text"
                        autoComplete="name"
                        value={formData.name}
                        onChange={e => handleInputChange("name", e.target.value)}
                        placeholder="請輸入您的姓名"
                        aria-invalid={nameError ? "true" : undefined}
                        aria-describedby={nameError ? NAME_ERROR_ID : undefined}
                    />
                    {nameError && (
                        <p id={NAME_ERROR_ID} style={{ margin: "4px 0 0", fontWeight: 700, color: "var(--yy-calm-danger)" }}>
                            {nameError}
                        </p>
                    )}
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
                        value={formData.joinDate ? new Date(formData.joinDate).toLocaleDateString("zh-TW") : ""}
                        disabled
                        style={{ backgroundColor: "var(--yy-cream-dim)", color: "var(--yy-text-muted)" }}
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="profile-email-input"><Mail size={16} /> 信箱</label>
                    <input
                        id="profile-email-input"
                        type="email"
                        value={formData.email}
                        disabled
                        style={{ backgroundColor: "var(--yy-cream-dim)", cursor: "not-allowed" }}
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="profile-password-input"><Lock size={16} /> 密碼</label>
                    <input
                        id="profile-password-input"
                        type="password"
                        value={formData.password}
                        disabled
                        style={{ backgroundColor: "var(--yy-cream-dim)", cursor: "not-allowed" }}
                    />
                    <Link className="forgot-pass" to="/reset">變更密碼</Link>
                    <Link className="forgot-pass" to="/memory">我的學習記憶</Link>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", marginTop: "24px" }}>
                    <button className="cancel-btn" type="button" onClick={() => window.history.back()}>
                        取消
                    </button>

                    {/* 稽核 FE1-18：上傳中、儲存中停用；文字跟著說明現在在做什麼（editProfile.css 沒有停用樣式，先用行內樣式） */}
                    <button
                        className="save-btn"
                        type="button"
                        onClick={handleSave}
                        disabled={saveDisabled}
                        style={saveDisabled ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
                    >
                        <Save size={16} /> {saveLabel}
                    </button>
                </div>
            </div>
        </div>
    );
};
export default Edit;
