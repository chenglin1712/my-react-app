import { useState } from "react"
import LoginForm from "../../components/_auth/loginForm"
import RegisterForm from "../../components/_auth/registerForm"
import TabSwitch from "../../components/ui/TabSwitch"
import "../../static/css/_auth/authPage.css"

const AUTH_TABS = [{ key: "login", label: "登入" }, { key: "register", label: "註冊" }];

// 登入/註冊合併頁（YUAN・YU v2）：頂部 tab 切換登入／註冊，兩邊各自沿用
// 既有的 LoginForm / RegisterForm（真實 Firebase 登入、Cloudinary 頭像上傳等）。
// defaultView 讓 /login、/register 兩條既有路由分別預設開在對應的 tab 上，
// 使用者仍可在頁面內直接切換，不需要重新導頁。
function AuthPage({ defaultView = "login" }) {
    const [view, setView] = useState(defaultView);

    return (
        <div className="yy-page auth-page">
            <section className="yy-hero auth-hero">
                <span className="auth-blob auth-blob--gold" />
                <span className="auth-blob auth-blob--blue" />
                <div className="yy-fade-up auth-panel">
                    <div className="auth-badge-row">
                        <span className="yy-eyebrow">◆ MEMBER ◆</span>
                    </div>
                    <div className="auth-tabswitch-row">
                        <TabSwitch
                            tabs={AUTH_TABS}
                            active={view}
                            onChange={setView}
                        />
                    </div>

                    <div className="yy-card auth-card">
                        {view === "login" ? (
                            <LoginForm onSwitchToRegister={() => setView("register")} />
                        ) : (
                            <RegisterForm onSwitchToLogin={() => setView("login")} />
                        )}
                    </div>
                </div>
            </section>
        </div>
    )
}

export default AuthPage
