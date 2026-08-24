import { useState } from "react";
import { Menu, X } from "lucide-react";
import { House, TextSearch, Camera, Gamepad2, BookOpenCheck, NotebookPen, User, ChevronDown, Languages } from "lucide-react";
import "../../static/css/navigation/Navbar.css"
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../../src/userServives/authContext"
import AvatarImg from "../../static/assets/_auth/avatar.webp"
import UserSidebar from "./userSidebar"

// 靜態的導覽路由設定，不依賴 props/state，搬到元件外，不用每次 render 重建。
const MENU_ITEMS = [
  { id: 'home', label: '首頁', icon: <House size={20} />, route: '/' },
  { id: 'search', label: '單詞查詢', icon: <TextSearch size={20} />, route: '/search' },
  { id: 'translate', label: '翻譯', icon: <Languages size={20} />, route: '/translate' },
  { id: 'camera', label: '影像辨識', icon: <Camera size={20} />, route: '/camera' },
  { id: 'game', label: '遊戲專區', icon: <Gamepad2 size={20} />, route: '/game' },
  { id: 'quiz', label: '測驗', icon: <BookOpenCheck size={20} />, route: '/quiz/select', activePrefix: '/quiz' },
];

// /quiz/select 底下還有 /quiz/:level 等子路由，用 activePrefix 涵蓋；沒有
// activePrefix 的項目就用 route 本身當 prefix。比對子路由用 `${prefix}/`
// 而不是單純 startsWith(prefix)，避免 /game 誤判到未來可能出現的
// /game-old 這類同前綴但不同功能的路由。桌面版／手機版共用同一份規則。
function isRouteActive(item, pathname) {
  const prefix = item.activePrefix || item.route;
  return (
    pathname === item.route ||
    (prefix !== "/" && (pathname === prefix || pathname.startsWith(`${prefix}/`)))
  );
}

const Navbar = ({ onOpenBot }) => {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();
  const { userData } = useAuth();

  const [isUserOpen, setIsUserOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const isLoggedIn = userData != null && userData.firestoreData != null;

  //改變個人資料側拉選單狀態
  const handleUserSidebar = () => {
    setIsUserOpen(!isUserOpen);
  };

  return (
    <>
    <nav className="navbar">
      <div className="navbar-container">
        <NavLink className="logo" to="/">YUAN・YU</NavLink>

        {/* 導覽列 */}
        <div className="menu">
          {MENU_ITEMS.map((item) => (
            <NavLink
              key={item.id}
              to={item.route}
              className={`menu-item ${isRouteActive(item, location.pathname) ? "active" : ""}`}
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}

          <button
            type="button"
            className={`menu-item note-dropdown ${location.pathname.startsWith("/note") ? "active" : ""}`}
            aria-haspopup="true"
            aria-expanded={isDropdownOpen}
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          >
            <div className="flex items-center gap-1">
              <NotebookPen size={20} />
              <span>筆記</span>
              <ChevronDown size={16} />
            </div>

            {/* 下拉選單 */}
            <div
              className={`dropdown-content ${isDropdownOpen ? "active" : ""}`}
              onMouseLeave={() => setIsDropdownOpen(false)}
            >
              <NavLink className="dropdown-item" to="/note" onClick={() => setIsDropdownOpen(false)}>
                寫筆記
              </NavLink>
              <NavLink className="dropdown-item" to="/note/share" onClick={() => setIsDropdownOpen(false)}>
                筆記分享區
              </NavLink>
            </div>
          </button>

          {!isLoggedIn ? (
            <NavLink className="menu-item login-btn" to="/login">
              <User size={24} style={{ marginRight: '5px' }} />
              <span>登入</span>
            </NavLink>
          ) : (
            <>
              <div className="auth-container">
                <button
                  type="button"
                  className="auth-container-user"
                  aria-label="開啟個人資料選單"
                  onClick={handleUserSidebar}
                >
                  <img src={userData?.firestoreData?.avatarUrl || AvatarImg} className="auth-image" alt="" />
                  <p>{userData?.firestoreData?.name}</p>
                </button>
              </div>

              {
                isUserOpen && (
                  <div className="overlay" onClick={() => setIsUserOpen(false)}></div>
                )
              }
              <div
                className={`sidebar ${isUserOpen ? 'open' : ''}`}
              >
                <div className="sidebar-header">
                  <h3> 個人資料</h3>
                  <button className="close-btn" aria-label="關閉個人資料選單" onClick={() => setIsUserOpen(false)}>×</button>
                </div>

                <UserSidebar userData={userData} closeSidebar={() => setIsUserOpen(false)} onOpenBot={onOpenBot} />
              </div>
            </>
          )}
        </div >

        {/* Mobile Menu Toggle Button */}
        <button
          className="menu-toggle"
          aria-label={isOpen ? "關閉選單" : "開啟選單"}
          aria-expanded={isOpen}
          onClick={() => setIsOpen(!isOpen)}
        >
          {isOpen ? <X size={28} /> : <Menu size={28} />}
        </button>
      </div >

      {/* Mobile Menu */}
      <div className={`menu-mobile ${isOpen ? 'active' : ''}`}>
        {!isLoggedIn ? (
          <NavLink className="menu-mobile-item" to="/login" onClick={() => setIsOpen(false)}>
            <User size={20} />
            <span>登入</span>
          </NavLink>
        ) : (
          <>
            <div className="auth-container">
              <button
                type="button"
                className="mobile-container-user"
                aria-label="開啟個人資料選單"
                onClick={handleUserSidebar}
              >
                <img src={userData?.firestoreData?.avatarUrl || AvatarImg} className="mobile-image" alt="" />
                <p>{userData?.firestoreData?.name}</p>
              </button>
            </div>

            {
              isUserOpen && (
                <div className="overlay" onClick={() => setIsUserOpen(false)}></div>
              )
            }
            <div
              className={`sidebar ${isUserOpen ? 'open' : ''}`}
            >
              <div className="sidebar-header">
                <h3>&nbsp;個人資料</h3>
                <button className="close-btn" aria-label="關閉個人資料選單" onClick={() => setIsUserOpen(false)}>×</button>
              </div>

              <UserSidebar userData={userData} closeSidebar={() => setIsUserOpen(false)} onOpenBot={onOpenBot} />
            </div>
          </>
        )}

        {MENU_ITEMS.map((item) => (
          <NavLink
            key={item.id}
            to={item.route}
            className="menu-mobile-item"
            onClick={() => setIsOpen(false)}
          >
            {item.icon}
            <span>{item.label}</span>
          </NavLink>
        ))}
        <NavLink className="menu-mobile-item" to="/note" onClick={() => setIsOpen(false)}>
          <NotebookPen size={20} />
          <span>寫筆記</span>
        </NavLink>
        <NavLink className="menu-mobile-item" to="/note/share" onClick={() => setIsOpen(false)}>
          <NotebookPen size={20} />
          <span>筆記分享區</span>
        </NavLink>
      </div >
    </nav >
    <div className="navbar-marquee" />
    </>
  );
};
export default Navbar;
