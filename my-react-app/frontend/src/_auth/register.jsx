import AuthPage from './login'

// /register 沿用跟 /login 同一個合併頁元件（登入/註冊 tab 切換），
// 只是預設開在「註冊」tab 上，見 login.jsx 的 AuthPage。
const RegisterPage = () => <AuthPage defaultView="register" />;
export default RegisterPage;