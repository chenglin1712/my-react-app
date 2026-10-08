import { useEffect } from "react"
import { Link } from "react-router-dom"
import { useAuth } from "../userServives/authContext"
import { auth } from "../../../firebase"
import LoginForm from "../../components/_auth/loginForm"
import "../../static/css/_auth/adminLogin.css"

// 左側主視覺「織布機」：7×7 的菱形眼紋，由內而外依「到中心的距離」上色（金→赭紅→米→青→藍）。
// 動態分三層：
//   1. 進場：一列一列「織」出來（每格由左往右用 steps() 拉出，像線被梭子拉過）。
//   2. 持續：從中心向外擴散的亮度波（每圈延遲不同，6s 一輪），以及一條金色梭子線由上往下掃過。
//   3. 星塵：幾顆像素方塊緩緩上升（取代對方的螢火蟲，Y2K 版）。
// 純裝飾，aside 整個 aria-hidden。降低動態偏好下由 theme-v2.css 的全域規則直接到終態。
const SIZE = 7
const CENTER = 3
const RING_TONES = ["gold", "red", "cream", "teal", "blue"]
const WEAVE_CELLS = Array.from({ length: SIZE * SIZE }, (_, i) => {
    const row = Math.floor(i / SIZE)
    const col = i % SIZE
    const ring = Math.abs(col - CENTER) + Math.abs(row - CENTER)
    return { key: i, row, col, ring, visible: ring <= CENTER, tone: RING_TONES[ring % RING_TONES.length] }
})

// 星塵：位置、大小、速度各不相同，才不會看起來像整齊的重複動畫
const DUST = [
    { left: 8, size: 6, dur: 11, delay: 0, tone: "gold" },
    { left: 22, size: 4, dur: 14, delay: 3, tone: "cream" },
    { left: 37, size: 8, dur: 12, delay: 6, tone: "red" },
    { left: 51, size: 5, dur: 16, delay: 1.5, tone: "gold" },
    { left: 66, size: 6, dur: 13, delay: 8, tone: "cream" },
    { left: 79, size: 4, dur: 15, delay: 4.5, tone: "gold" },
    { left: 90, size: 7, dur: 12, delay: 9.5, tone: "teal" },
]

/**
 * 後台專用登入頁（/admin-login）。
 *
 * 登入行為完全沿用 LoginForm（Firebase、next 同源驗證、成功動畫），這裡只提供後台專屬的外殼。
 * 角色判斷不在這裡：登入成功後導回 next（通常是 /admin…），再由 AdminRoute 依角色決定放行或導回首頁。
 * 因此這個頁面不宣稱使用者一定有後台資格。
 */
function AdminLoginPage() {
    // 前台已經登入時：預填目前的信箱、只需要輸入密碼，並說清楚為什麼要再輸入一次。
    // useAuth() 只是讓登入狀態變化時重新渲染；信箱以 Firebase 目前的使用者為準。
    useAuth()
    const currentEmail = auth.currentUser?.email ?? ""

    // /admin 開頭的路徑不經過前台的 RouteEffects，分頁標題在這裡自己設定
    useEffect(() => { document.title = "後台登入｜源·語" }, [])

    return (
        <div className="admin-login">
            <aside className="admin-login-aside" aria-hidden="true">
                <div className="admin-login-dust">
                    {DUST.map((d) => (
                        <span
                            key={d.left}
                            className={`admin-login-dust-mote admin-login-dust-${d.tone}`}
                            style={{ left: `${d.left}%`, width: d.size, height: d.size, animationDuration: `${d.dur}s`, animationDelay: `${d.delay}s` }}
                        />
                    ))}
                </div>

                <div className="admin-login-weave">
                    {WEAVE_CELLS.map(({ key, row, col, ring, visible, tone }) => (
                        visible ? (
                            <span
                                key={key}
                                className={`admin-login-cell admin-login-cell-${tone}`}
                                style={{ "--row": row, "--col": col, "--ring": ring }}
                            />
                        ) : (
                            <span key={key} className="admin-login-cell-gap" />
                        )
                    ))}
                    <span className="admin-login-shuttle" />
                </div>

                <p className="admin-login-kicker">YUAN・YU / ADMIN SIGNAL</p>
                <p className="admin-login-slogan">
                    <span className="admin-login-line" style={{ "--chars": 4, "--line-delay": "1.1s" }}>族語內容</span>
                    <span className="admin-login-line admin-login-line-last" style={{ "--chars": 4, "--line-delay": "1.7s" }}>管理中樞</span>
                </p>
            </aside>

            <main className="admin-login-main">
                <section className="admin-login-card" aria-labelledby="admin-login-title">
                    <div className="admin-login-brand">
                        <span className="admin-login-brand-mark" aria-hidden="true">源</span>
                        <div>
                            <span className="admin-login-brand-eyebrow">SECURE CONSOLE</span>
                            <span className="admin-login-brand-name">源・語管理後台</span>
                        </div>
                    </div>

                    <h1 id="admin-login-title" className="admin-login-title">管理員登入</h1>
                    <p className="admin-login-lead">請使用管理帳號登入。登入後系統會依帳號角色決定可使用的功能。</p>

                    {currentEmail && (
                        <p className="admin-login-notice" role="note">
                            你目前在前台以 <strong>{currentEmail}</strong> 登入。為了安全，進入後台需要再輸入一次密碼；
                            若改輸入其他帳號，前台也會切換成該帳號。
                        </p>
                    )}

                    <LoginForm variant="admin" defaultEmail={currentEmail} />

                    <Link className="admin-login-back" to="/">← 回到前台</Link>
                </section>
            </main>
        </div>
    )
}

export default AdminLoginPage
