import "../../static/css/_auth/loginForm.css"
import { Mail, User } from "lucide-react"
import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Alert } from "react-bootstrap";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../../../firebase";
import { loadSuccessAnimation } from "../../src/animations/loaders";
import SuccessModal from "../ui/SuccessModal";
import { useLottieAnimation } from "@hooks/useLottieAnimation";
import { clearAdminSession, markAdminSession } from "../../src/_admin/session/adminSession";
import { authErrorMessage } from "@utils/firebaseAuthErrors";
import AuthField from "./AuthField";
import PasswordField from "./PasswordField";
import { AUTH_SUCCESS_REDIRECT_MS, AUTH_SYNC_MAX_WAIT_MS } from "./authTiming";
import { safeRedirectPath } from "./redirectTarget";
import { useAuth } from "../../src/userServives/authContext";

// variant 只影響呈現：'admin' 是後台專用登入頁（src/_auth/AdminLoginPage.jsx）用的版本，
// 標題由頁面自己提供、不顯示註冊入口、成功文案改成進後台。登入函式、next 驗證與導頁邏輯兩種版本完全相同。
const LoginForm = ({ onSwitchToRegister, variant = "member", defaultEmail = "" }) => {
    const isAdminVariant = variant === "admin";
    const [email, setEmail] = useState(defaultEmail);
    const [password, setPassword] = useState("");
    // errorMsg：不屬於單一欄位的錯誤（帳密錯誤、網路失敗…）放表單上方；
    // fieldErrors：缺哪個欄位就把訊息放在那個欄位正下方（審查項 P2-72）
    const [errorMsg, setErrorMsg] = useState("");
    const [fieldErrors, setFieldErrors] = useState({});
    const [attempt, setAttempt] = useState(0);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const formRef = useRef(null);
    // 同步的送出鎖：isSubmitting 要等 render 後按鈕才 disabled，兩次 submit 若在那之前進來會重複登入
    const submittingRef = useRef(false);
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const redirectTimeoutRef = useRef(null);
    // 登入要等網路回應，使用者可能在那之前就離開這個頁面。元件卸載時清掉的計時器是「當下已經有的」，
    // 之後才完成的登入會建立新的導頁計時器，把人從別的頁面拉回來（F11）；所以登入完成後要先確認還在頁面上。
    // 每次掛載都要重設成 true：開發模式的 StrictMode 會先卸載再掛載一次。
    const mountedRef = useRef(false);
    const authWaitTimeoutRef = useRef(null);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            clearTimeout(redirectTimeoutRef.current);
            clearTimeout(authWaitTimeoutRef.current);
        };
    }, []);

    // 稽核 FE1-09：signIn 完成時，全站的 AuthContext 還沒更新（要等 authChanges 讀完 Firestore 個人資料與角色）。
    // 原本 800ms 後（或按「立即前往」立刻）就導頁：慢網路下 AdminRoute 看到 userData 還是 null 會導回登入頁；
    // 前台原本是別的帳號時，看到的是舊帳號的角色，被默默導回首頁。
    // 改成「提示時間到（或按了立即前往）」且「AuthContext 已換成剛登入的帳號」兩個條件都成立才導頁；
    // AuthContext 一直沒跟上時，最多等 AUTH_SYNC_MAX_WAIT_MS 就照常導頁，不讓人卡在成功提示上。
    const { userData: authUser } = useAuth();
    const [redirect, setRedirect] = useState(null); // { target, uid }：登入成功後才有
    const [waitDone, setWaitDone] = useState(false);
    const [authWaitExpired, setAuthWaitExpired] = useState(false);
    const navigatedRef = useRef(false);
    // credential 沒有 uid（不應發生）時無從比對，不等
    const authCaughtUp = redirect !== null && (!redirect.uid || authUser?.uid === redirect.uid);
    useEffect(() => {
        if (!redirect || !waitDone || navigatedRef.current) return;
        if (!authCaughtUp && !authWaitExpired) return;
        navigatedRef.current = true;
        navigate(redirect.target);
    }, [redirect, waitDone, authCaughtUp, authWaitExpired, navigate]);

    // 成功提示出現後本來會等一小段時間才跳頁；按「立即前往」或 Esc 就不用等（仍會等登入狀態同步完成）
    const skipWait = () => {
        clearTimeout(redirectTimeoutRef.current);
        setWaitDone(true);
    };

    // 送出後有欄位錯誤時，把焦點移到第一個有問題的欄位（鍵盤與報讀器使用者才知道錯在哪）
    useEffect(() => {
        if (attempt === 0) return;
        formRef.current?.querySelector('[aria-invalid="true"]')?.focus();
    }, [attempt]);

    // 登入後預設回首頁；只有從「先被要求登入才能進去」的頁面過來（例如
    // AdminRoute 導去 /admin-login?next=/admin、登入牆的「前往登入」）才會帶 next 參數，
    // 登入成功後導回原本要去的地方。next 只接受同源站內路徑（驗證方式見 redirectTarget.js）。
    const getRedirectTarget = () => safeRedirectPath(searchParams.get("next"));

    //使用者登入
    const handleLogin = async (e) => {
        e.preventDefault();
        if (submittingRef.current) return;
        setErrorMsg("");

        const nextFieldErrors = {};
        if (!email.trim()) nextFieldErrors.email = "請輸入電子郵件";
        if (!password) nextFieldErrors.password = "請輸入密碼";
        setFieldErrors(nextFieldErrors);
        if (Object.keys(nextFieldErrors).length > 0) {
            setAttempt((n) => n + 1);
            return;
        }
        submittingRef.current = true;
        setIsSubmitting(true);
        try {
            const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
            // 後台版：記下「這個分頁已在後台登入頁輸入過密碼」，AdminRoute 才會放行（旗標只是體驗層，見 adminSession.js）
            // 前台登入則一定清掉旗標：前台登入不算「在後台登入頁輸入過密碼」，之前殘留的旗標不能讓人直接進後台
            if (isAdminVariant) markAdminSession(credential?.user?.uid);
            else clearAdminSession();
            // 已經離開這個頁面：登入本身成功了（上面的後台旗標照常處理），但不要再顯示成功畫面或導頁
            if (!mountedRef.current) return;
            setIsLogin(true);
            setRedirect({ target: getRedirectTarget(), uid: credential?.user?.uid });
            redirectTimeoutRef.current = setTimeout(() => setWaitDone(true), AUTH_SUCCESS_REDIRECT_MS);
            authWaitTimeoutRef.current = setTimeout(() => setAuthWaitExpired(true), AUTH_SYNC_MAX_WAIT_MS);
        } catch (error) {
            // error.code 只有 Firebase 的錯誤才會有，非 Firebase 的例外（例如網路層
            // 的 TypeError）沒有這個欄位，直接呼叫 .includes() 會在這個 catch 區塊
            // 內再丟一次例外，讓使用者連通用錯誤訊息都看不到。
            // 畫面只顯示中文說明；Firebase 的英文 message 只留在 console，不給使用者看
            console.error("登入失敗:", error?.code, error?.message);
            const message = authErrorMessage(error, "登入失敗，請稍後再試");
            if (error?.code === "auth/invalid-email") {
                setFieldErrors({ email: message });
                setAttempt((n) => n + 1);
            } else {
                setErrorMsg(message);
            }
        } finally {
            submittingRef.current = false;
            setIsSubmitting(false);
        }
    };

    //載入動畫
    const [isLogin, setIsLogin] = useState(false);
    const animation = useLottieAnimation({ loadAnimationData: loadSuccessAnimation, enabled: isLogin });
    // 稽核 FE1-21：有 next 時不是去首頁，成功提示要依實際目的地寫
    const successText = isAdminVariant
        ? "登入成功！正在確認後台權限"
        : (redirect && redirect.target !== "/" ? "登入成功！正在回到原本要去的頁面" : "登入成功！您將移至首頁");

    return (
        <div className="login-box">
            {!isAdminVariant && <h1 className="formTitle"><User size={30} />登入</h1>}
            {errorMsg && <Alert variant="danger" className="py-2">{errorMsg}</Alert>}
            <form className="loginForm" onSubmit={handleLogin} noValidate ref={formRef}>
                <AuthField
                    label="電子郵件"
                    icon={Mail}
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    error={fieldErrors.email}
                    onChange={(e) => {
                        setEmail(e.target.value);
                        if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: undefined }));
                    }}
                />
                <PasswordField
                    value={password}
                    error={fieldErrors.password}
                    onChange={(e) => {
                        setPassword(e.target.value);
                        if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: undefined }));
                    }}
                    autoComplete="current-password"
                />
                <a className="forgot-pass" href="/forgot" onClick={(e) => { e.preventDefault(); navigate("/forgot"); }}>忘記密碼？</a>
                <button type="submit" className="login-button" disabled={isSubmitting}>
                    {isSubmitting ? "登入中…" : (isAdminVariant ? "登入後台" : "登入")}
                </button>
            </form>
            {!isAdminVariant && (
                <p>還沒有帳號？
                    {onSwitchToRegister ? (
                        <a onClick={(e) => { e.preventDefault(); onSwitchToRegister(); }} href="/register">註冊</a>
                    ) : (
                        <a href="/register">註冊</a>
                    )}
                </p>
            )}

            <SuccessModal show={isLogin} text={successText} icon={<div ref={animation} />} onClose={skipWait} closeLabel="立即前往" />
        </div>
    );
};
export default LoginForm;
