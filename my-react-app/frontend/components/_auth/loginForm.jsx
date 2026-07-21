import "../../static/css/_auth/loginForm.css"
import { Mail, LockKeyhole, User } from "lucide-react"
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Alert } from "react-bootstrap";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../../../firebase";
import lottie from 'lottie-web';
import successAnimation from "../../src/animations/success.json"

const LoginForm = ({ onSwitchToRegister }) => {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [errorMsg, setErrorMsg] = useState("");
    const navigate = useNavigate();

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
            setTimeout(() => {
                navigate("/");
            }, 1800);
        } catch (error) {
            if (error.code.includes('auth/invalid-credential')) {
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
                    <input type="email" className="input-field" placeholder="帳號" aria-label="帳號" required onChange={(e) => { setEmail(e.target.value) }} />
                </div>
                <div className="input-wrapper">
                    <LockKeyhole size={24} className="icon" />
                    <input type="password" className="input-field" placeholder="密碼" aria-label="密碼" required onChange={(e) => { setPassword(e.target.value) }} />
                </div>
                <a className="forgot-pass" onClick={() => { navigate("/forgot"); }}>忘記密碼?</a>
                <button className="login-button" onClick={handleLogin}>登入</button>
            </form>
            <p>還沒有帳號?
                {onSwitchToRegister ? (
                    <a onClick={(e) => { e.preventDefault(); onSwitchToRegister(); }} href="/register">註冊</a>
                ) : (
                    <a href="/register">註冊</a>
                )}
            </p>

            {isLogin && (
                <div className="overlay">
                    <div className="animation-container">
                        <div ref={animation} />
                        <p>登入成功！您將移至首頁</p>
                    </div>
                </div>
            )}
        </div>
    );
};
export default LoginForm;