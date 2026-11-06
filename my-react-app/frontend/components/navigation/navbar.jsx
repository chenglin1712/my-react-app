import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Menu, X } from "lucide-react";
import { House, TextSearch, Camera, Gamepad2, BookOpenCheck, NotebookPen, User, ChevronDown, Languages, Heart, Ellipsis } from "lucide-react";
import "../../static/css/navigation/Navbar.css"
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../../src/userServives/authContext"
import AvatarImg from "../../static/assets/_auth/avatar.webp"
import UserSidebar from "./userSidebar"
import { useDialog } from "@hooks/useDialog"
import { ThemeMenu, ThemeRadioGroup } from "./ThemeSettings"
import { isDarkThemeEnabled } from "../../src/theme/themeStore"
import { useHomeNavSlot } from "../../src/homeNavSlot"

// 首頁雜誌版的選單 slot 是 sticky：貼到視窗頂端（top <= 0）就算「吸附」，這時才顯示玻璃底與左側小字標。
// 只在吸附狀態改變時才 setState，捲動中不會每一格都重繪。
function useSlotStuck(slot, enabled) {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (!enabled || !slot) {
      setStuck(false);
      return undefined;
    }
    let raf = 0;
    const check = () => {
      raf = 0;
      setStuck(window.scrollY > 0 && slot.getBoundingClientRect().top <= 0.5);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(check); };
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [slot, enabled]);
  return stuck;
}

// 靜態的導覽路由設定，不依賴 props/state，搬到元件外，不用每次 render 重建。
const MENU_ITEMS = [
  { id: 'home', label: '首頁', icon: <House size={20} />, route: '/' },
  { id: 'search', label: '單詞查詢', icon: <TextSearch size={20} />, route: '/search' },
  { id: 'translate', label: '翻譯', icon: <Languages size={20} />, route: '/translate' },
  { id: 'camera', label: '影像辨識', icon: <Camera size={20} />, route: '/camera' },
  { id: 'game', label: '遊戲專區', icon: <Gamepad2 size={20} />, route: '/game' },
  { id: 'quiz', label: '測驗', icon: <BookOpenCheck size={20} />, route: '/quiz/select', activePrefix: '/quiz' },
];

// 手機底部 tab bar 的四個主入口（2026-11-06 定案：首頁、單詞查詢、測驗、遊戲專區）；其餘放「更多」（就是手機選單面板）。
const TAB_IDS = ['home', 'search', 'quiz', 'game'];
const TAB_ITEMS = TAB_IDS.map((id) => MENU_ITEMS.find((item) => item.id === id));

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
  // 首頁（雜誌版）把選單放在報頭下方：首頁登記了 slot 就用 portal 畫進去，否則照舊畫在最上方
  const homeSlot = useHomeNavSlot()?.slot ?? null;
  const magazine = location.pathname === "/" && homeSlot !== null;
  const stuck = useSlotStuck(homeSlot, magazine);

  const [isUserOpen, setIsUserOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownTriggerRef = useRef(null);
  const userSidebarRef = useRef(null);
  const menuToggleRef = useRef(null);
  const moreTabRef = useRef(null);

  const isLoggedIn = userData != null && userData.firestoreData != null;
  const userName = userData?.firestoreData?.name;
  // 可見文字是使用者名稱，aria-label 必須以它開頭，語音控制說出名稱才能啟動（WCAG 2.5.3，審查項 P2-2）
  const userButtonLabel = userName ? `${userName}，開啟個人資料選單` : "開啟個人資料選單";

  // 個人資料側欄是自製彈窗：Esc、焦點陷阱、關閉後焦點回到按下的那顆按鈕（審查項 P1-5）
  useDialog(userSidebarRef, { active: isLoggedIn && isUserOpen, onClose: () => setIsUserOpen(false) });

  // 手機選單開著時按 Esc 收起，焦點回到漢堡鈕（和筆記下拉、個人資料側欄的 Esc 行為一致）
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== "Escape") return;
      setIsOpen(false);
      // 手機寬度（≤768px）漢堡鈕被隱藏，焦點回到底部 tab bar 的「更多」
      const phone = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 768px)").matches;
      (phone ? moreTabRef.current : menuToggleRef.current)?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  // 手機寬度的「更多」：面板在 DOM 裡排在按鈕之前，開啟後 Tab 不會自然進到面板，所以把焦點移到面板第一個可按項目（Esc 收起會送回「更多」）
  useEffect(() => {
    if (!isOpen || typeof window.matchMedia !== "function" || !window.matchMedia("(max-width: 768px)").matches) return;
    document.querySelector("#mobile-menu a:not(.menu-mobile-item--in-tabbar), #mobile-menu button")?.focus();
  }, [isOpen]);

  //改變個人資料側拉選單狀態
  const handleUserSidebar = () => {
    setIsUserOpen(!isUserOpen);
  };

  const navElement = (
    <nav aria-label="網站導覽" className={`navbar${location.pathname === "/" ? " navbar--home" : ""}${magazine ? " navbar--magazine" : ""}`} data-stuck={magazine ? String(stuck) : undefined}>
      <div className="navbar-container">
        {/* 首頁雜誌版：吸附後左側浮出小字標「原語」（未吸附時 visibility:hidden，不能被 Tab 聚焦）；aria-label 以可見文字開頭 */}
        {magazine
          ? <NavLink className="logo logo--mini" to="/" aria-label="原語，回到首頁" tabIndex={stuck ? undefined : -1}>原語</NavLink>
          : <NavLink className="logo" to="/">YUAN・YU</NavLink>}

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

          {/* 筆記下拉選單：觸發鈕與選單項目是兄弟節點（<button> 裡面不能再放連結，
              那是巢狀互動元素，鍵盤與報讀器都會出問題）。
              Escape 關閉並把焦點還給觸發鈕；焦點離開整組選單時自動收合。 */}
          <div
            className="note-dropdown-wrap"
            onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDropdownOpen(false); }}
            onKeyDown={(e) => {
              if (e.key === "Escape" && isDropdownOpen) {
                setIsDropdownOpen(false);
                dropdownTriggerRef.current?.focus();
              }
            }}
            onMouseLeave={() => setIsDropdownOpen(false)}
          >
            <button
              type="button"
              ref={dropdownTriggerRef}
              className={`menu-item note-dropdown ${location.pathname.startsWith("/note") ? "active" : ""}`}
              aria-haspopup="true"
              aria-expanded={isDropdownOpen}
              aria-controls="note-dropdown-menu"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            >
              <span className="flex items-center gap-1">
                <NotebookPen size={20} />
                <span>筆記</span>
                <ChevronDown size={16} />
              </span>
            </button>
            <div id="note-dropdown-menu" className={`dropdown-content ${isDropdownOpen ? "active" : ""}`}>
              <NavLink className="dropdown-item" to="/note" onClick={() => setIsDropdownOpen(false)}>
                寫筆記
              </NavLink>
              <NavLink className="dropdown-item" to="/note/share" onClick={() => setIsDropdownOpen(false)}>
                筆記分享區
              </NavLink>
            </div>
          </div>

          <ThemeMenu />

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
                  aria-label={userButtonLabel}
                  aria-haspopup="dialog"
                  aria-expanded={isUserOpen}
                  onClick={handleUserSidebar}
                >
                  <img decoding="async" src={userData?.firestoreData?.avatarUrl || AvatarImg} className="auth-image" alt="" />
                  <p>{userName}</p>
                </button>
              </div>
            </>
          )}
        </div >

        {/* Mobile Menu Toggle Button */}
        <button
          ref={menuToggleRef}
          className="menu-toggle"
          aria-label={isOpen ? "關閉選單" : "開啟選單"}
          aria-expanded={isOpen}
          aria-controls="mobile-menu"
          onClick={() => setIsOpen(!isOpen)}
        >
          {isOpen ? <X size={28} /> : <Menu size={28} />}
        </button>
      </div >

      {/* Mobile Menu */}
      <div id="mobile-menu" className={`menu-mobile ${isOpen ? 'active' : ''}`}>
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
                aria-label={userButtonLabel}
                aria-haspopup="dialog"
                aria-expanded={isUserOpen}
                onClick={handleUserSidebar}
              >
                <img decoding="async" src={userData?.firestoreData?.avatarUrl || AvatarImg} className="mobile-image" alt="" />
                <p>{userName}</p>
              </button>
            </div>
          </>
        )}

        {MENU_ITEMS.map((item) => (
          <NavLink
            key={item.id}
            to={item.route}
            className={`menu-mobile-item${TAB_IDS.includes(item.id) ? " menu-mobile-item--in-tabbar" : ""}`}
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
        {isDarkThemeEnabled() && <ThemeRadioGroup className="theme-group--mobile" />}
        {/* 收藏原本只藏在頭像側欄裡；登入後在手機選單也放一個直接入口（桌面版導覽列寬度已滿，見 Navbar.css 的斷點說明） */}
        {isLoggedIn && (
          <NavLink className="menu-mobile-item" to="/favorite" state={{ tabId: 1 }} onClick={() => setIsOpen(false)}>
            <Heart size={20} />
            <span>個人詞語庫</span>
          </NavLink>
        )}
      </div >
    </nav >
  );

  const moreActive = isOpen || ["/translate", "/camera", "/note", "/favorite"].some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`));

  return (
    <>
    {magazine ? createPortal(navElement, homeSlot) : navElement}

    {/* 手機底部 tab bar（≤768px 才顯示，CSS 控制）：四個主入口加「更多」。「更多」開關的就是上面的手機選單面板，
        面板在手機寬度改成貼在 tab bar 上方的底部面板。tab bar 在 <nav> 之外，不受首頁 portal 影響。 */}
    <nav className="yy-tabbar" aria-label="主要分頁">
      {TAB_ITEMS.map((item) => (
        <NavLink
          key={item.id}
          to={item.route}
          className={`yy-tabbar__item${isRouteActive(item, location.pathname) ? " active" : ""}`}
          aria-current={isRouteActive(item, location.pathname) ? "page" : undefined}
          onClick={() => setIsOpen(false)}
        >
          {item.icon}
          <span>{item.label}</span>
        </NavLink>
      ))}
      <button
        type="button"
        ref={moreTabRef}
        className={`yy-tabbar__item yy-tabbar__more${moreActive ? " active" : ""}`}
        aria-expanded={isOpen}
        aria-controls="mobile-menu"
        onClick={() => setIsOpen(!isOpen)}
      >
        <Ellipsis size={20} />
        <span>更多</span>
      </button>
    </nav>

    {/* 個人資料側欄只渲染一份（原本桌面與手機選單各渲染一份，共兩份側欄與兩層遮罩）。
        收起時用 CSS visibility:hidden，Tab 不會進到看不見的「編輯資料」「登出」（審查項 P2-1）。 */}
    {isLoggedIn && (
      <>
        {isUserOpen && <div className="navbar-overlay" onClick={() => setIsUserOpen(false)}></div>}
        <div
          ref={userSidebarRef}
          id="user-sidebar"
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="user-sidebar-title"
          inert={!isUserOpen}
          className={`sidebar ${isUserOpen ? 'open' : ''}`}
        >
          <div className="sidebar-header">
            <h3 id="user-sidebar-title">個人資料</h3>
            <button type="button" className="close-btn" aria-label="關閉個人資料選單" onClick={() => setIsUserOpen(false)}>×</button>
          </div>

          <UserSidebar userData={userData} closeSidebar={() => setIsUserOpen(false)} onOpenBot={onOpenBot} />
        </div>
      </>
    )}
    </>
  );
};
export default Navbar;
