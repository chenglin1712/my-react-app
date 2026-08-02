import "../../static/css/_auth/loginForm.css"
import { Mail, LockKeyhole, User } from "lucide-react"
import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Alert } from "react-bootstrap";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../../../firebase";
import lottie from 'lottie-web';
import successAnimation from "../../src/animations/success.json"
import SuccessModal from "../ui/SuccessModal";

const LoginForm = ({ onSwitchToRegister }) => {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [errorMsg, setErrorMsg] = useState("");
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    // 登入後預設回首頁；只有從「先被要求登入才能進去」的頁面過來（例如
    // AdminRoute 導去 /login?next=/admin）才會帶 next 參數，登入成功後導回
    // 原本要去的地方。用瀏覽器原生的 URL 解析器判斷是否為同源站內路徑，
    // 而不是自己手刻字串規則——單純檢查開頭是不是 "/"、"//" 會漏掉瀏覽器
    // 自己會正規化的變形，例如 "/\evil.com" 在網址解析時會被當成跟
    // "//evil.com" 等價的協定相對網址，直接跳到別的網站；用同一套 URL
    // 解析器（new URL）判斷才不會跟實際的導頁行為有認知落差。
    const getRedirectTarget = () => {
        const next = searchParams.get("next");
        if (!next) return "/";
        try {
            const resolved = new URL(next, window.location.origin);
            if (resolved.origin === window.location.origin) {
                return resolved.pathname + resolved.search + resolved.hash;
            }
        } catch {
            // next 不是合法的 URL 片段，忽略、走預設值
        }
        return "/";
    };

    //使用者登入
    const handleLogin = async (e) => {
        e.preventDefault();
        setErrorMsg("");

        if (!email || !password) {
            setErrorMsg("請輸入電子郵件和密碼！");
            return;
        }
        try {
            await signInWithEmailAndPassword(auth, email, password);
            setIsLogin(true);
            const redirectTarget = getRedirectTarget();
            setTimeout(() => {
                navigate(redirectTarget);
            }, 1800);
        } catch (error) {
            // error.code 只有 Firebase 的錯誤才會有，非 Firebase 的例外（例如網路層
            // 的 TypeError）沒有這個欄位，直接呼叫 .includes() 會在這個 catch 區塊
            // 內再丟一次例外，讓使用者連通用錯誤訊息都看不到。
            if (error.code?.includes('auth/invalid-credential')) {
                setErrorMsg("帳號或密碼錯誤，請檢查電子郵件和密碼是否正確！");
            } else {
                setErrorMsg("登入失敗: " + error.message);
            }
        }
    };

    //加載動畫
    const animation = useRef(null);
    const [isLogin, setIsLogin] = useState(false);
    useEffect(() => {
        if (isLogin) {
            const instance = lottie.loadAnimation({
                container: animation.current,
                renderer: 'svg',
                loop: true,
                autoplay: true,
                animationData: successAnimation,
            });
            return () => instance.destroy();
        }
    }, [isLogin]);

    return (
        <div className="login-box">
            <h2 className="formTitle"><User size={30} />登入</h2>
            {errorMsg && <Alert variant="danger" className="py-2">{errorMsg}</Alert>}
            <form action="#" className="loginForm">
                <div className="input-wrapper">
                    <Mail size={24} className="icon" />
                    <input type="email" className="input-field" placeholder="帳號" aria-label="帳號" autoComplete="email" required onChange={(e) => { setEmail(e.target.value) }} />
                </div>
                <div className="input-wrapper">
                    <LockKeyhole size={24} className="icon" />
                    <input type="password" className="input-field" placeholder="密碼" aria-label="密碼" autoComplete="current-password" required onChange={(e) => { setPassword(e.target.value) }} />
                </div>
                <a className="forgot-pass" href="/forgot" onClick={(e) => { e.preventDefault(); navigate("/forgot"); }}>忘記密碼?</a>
                <button className="login-button" onClick={handleLogin}>登入</button>
            </form>
            <p>還沒有帳號?
                {onSwitchToRegister ? (
                    <a onClick={(e) => { e.preventDefault(); onSwitchToRegister(); }} href="/register">註冊</a>
                ) : (
                    <a href="/register">註冊</a>
                )}
            </p>

            <SuccessModal show={isLogin} text="登入成功！您將移至首頁" icon={<div ref={animation} />} />
        </div>
    );
};
export default LoginForm;