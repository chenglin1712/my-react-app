import { useState, useRef } from "react";
import { Menu, X } from "lucide-react";
import { House, TextSearch, Camera, Gamepad2, BookOpenCheck, NotebookPen, User, ChevronDown } from "lucide-react";
import "../../static/css/navigation/Navbar.css"
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../src/userServives/authContext"
import AvatarImg from "../../static/assets/_auth/avatar.webp"
import UserSidebar from "./userSidebar"

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { userData } = useAuth();

  const [isUserOpen, setIsUserOpen] = useState(false);
  const sidebarRef = useRef(null);

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const menuItem = [
    { id: 'home', label: '首頁', icon: <House size={20} />, route: '/' },
    { id: 'search', label: '單詞查詢', icon: <TextSearch size={20} />, route: '/search' },
    { id: 'camera', label: '影像辨識', icon: <Camera size={20} />, route: '/camera' },
    { id: 'game', label: '遊戲專區', icon: <Gamepad2 size={20} />, route: '/game' },
    { id: 'quiz', label: '測驗', icon: <BookOpenCheck size={20} />, route: '/quiz/select', activePrefix: '/quiz' }
  ];

  const handleDropdownSelect = (path) => {
    navigate(path);
    setIsDropdownOpen(false);
  };

  const handleMobileNavigate = (path) => {
    navigate(path);
    setIsOpen(false);
  };

  //改變個人資料側拉選單狀態
  const handleUserSidebar = () => {
    setIsUserOpen(!isUserOpen);
  };

  return (
    <nav className="navbar">
      <div className="navbar-container">
        <div className="logo" onClick={() => { navigate("/") }}>源·語</div>

        {/* 導覽列 */}
        <div className="menu">
          {menuItem.map(({ id, label, icon, route, activePrefix }) => {
            const prefix = activePrefix || route;
            const isActive =
              location.pathname === route ||
              (prefix !== "/" && location.pathname.startsWith(prefix));

            return (
              <div key={id} className={`menu-item ${isActive ? "active" : ""}`} onClick={() => navigate(route)}>
                {icon}
                <span>{label}</span>
              </div>
            );
          })}

          <div
            className={`menu-item note-dropdown ${location.pathname.startsWith("/note") ? "active" : ""}`}
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
              <div
                className="dropdown-item"
                onClick={() => handleDropdownSelect("/note")}
              >
                寫筆記
              </div>
              <div
                className="dropdown-item"
                onClick={() => handleDropdownSelect("/note/share")}
              >
                筆記分享區
              </div>
            </div>
          </div>

          {userData == null ? (
            <div className="menu-item" onClick={() => navigate('/login')} >
              <User size={24} style={{ marginRight: '5px' }} />
              <span>登入</span>
            </div>
          ) : (
            <>
              <div className="auth-container">
                <div className="auth-container-user" onClick={handleUserSidebar}>
                  <img src={userData?.firestoreData?.avatarUrl || AvatarImg} className="auth-image" />
                  <p>{userData.firestoreData.name}</p>
                </div>
              </div>

              {
                isUserOpen && (
                  <div className="overlay" onClick={() => setIsUserOpen(false)}></div>
                )
              }
              <div
                ref={sidebarRef}
                className={`sidebar ${isUserOpen ? 'open' : ''}`}
              >
                <div className="sidebar-header">
                  <h3> 個人資料</h3>
                  <span className="close-btn" onClick={() => setIsUserOpen(false)}>×</span>
                </div>

                <UserSidebar userData={userData} closeSidebar={() => setIsUserOpen(false)} />
              </div>
            </>
          )}
        </div >

        {/* Mobile Menu Toggle Button */}
        < button
          className="menu-toggle"
          onClick={() => setIsOpen(!isOpen)}
        >
          {isOpen ? <X size={28} /> : <Menu size={28} />}
        </button >
      </div >

      {/* Mobile Menu */}
      < div className={`menu-mobile ${isOpen ? 'active' : ''}`}>
        {userData == null ? (
          <div className="menu-mobile-item" onClick={() => navigate('/login')} >
            <User size={20} />
            <span>登入</span>
          </div>
        ) : (
          <>
            <div className="auth-container">
              <div className="mobile-container-user" onClick={handleUserSidebar}>
                <img src={userData?.firestoreData?.avatarUrl || AvatarImg} className="mobile-image" />
                <p>{userData.firestoreData.name}</p>
              </div>
            </div>

            {
              isUserOpen && (
                <div className="overlay" onClick={() => setIsUserOpen(false)}></div>
              )
            }
            <div
              ref={sidebarRef}
              className={`sidebar ${isUserOpen ? 'open' : ''}`}
            >
              <div className="sidebar-header">
                <h3>&nbsp;個人資料</h3>
                <button className="close-btn" onClick={() => setIsUserOpen(false)}>×</button>
              </div>

              <UserSidebar userData={userData} closeSidebar={() => setIsUserOpen(false)} />
            </div>
          </>
        )}

        {menuItem.map(({ id, label, icon, route }) => (
          <div key={id} className="menu-mobile-item" onClick={() => handleMobileNavigate(route)}>
            {icon}
            <span>{label}</span>
          </div>
        ))}
        <div className="menu-mobile-item" onClick={() => handleMobileNavigate("/note")}>
          <NotebookPen size={20} />
          <span>筆記</span>
        </div>
      </div >
    </nav >
  );
};
export default Navbar;