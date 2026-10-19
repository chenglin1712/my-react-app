import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, BookOpen, ClipboardCheck, FileQuestion, Gamepad2, LayoutDashboard, Megaphone, Menu, Settings, Users, X } from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { signOut } from '../../userServives/userServive';
import ErrorBoundary from '../../errorBoundary';
import { ROLE_LABELS } from '../constants/roles';
import AdminRouteSkeleton from './AdminRouteSkeleton';
import AdminReauthModal from '../session/AdminReauthModal';
import { useAdminEntry } from '../entry/adminEntryContext';
import '../../../static/css/_admin/layout.css';
import '../../../static/css/_admin/admin-base.css';


// 導覽項目可選填 roles：只有列出的角色看得到這一項。沒填 = 所有後台角色都看得到。
// 目前沒有任何項目填：後端所有「檢視」API 都開放給全部後台角色（STAFF_ROLES），寫入才分角色，
// 頁面內的按鈕已依 canEdit／canManage 收起，所以導覽沒有理由藏起任何一項。
// 之後若新增只給特定角色的頁面，在這裡填 roles 即可，不必改過濾邏輯。
const NAV_GROUPS = [
    { label: '總覽', icon: LayoutDashboard, items: [{ label: '儀表板', to: '/admin', end: true }] },
    { label: '內容', icon: Megaphone, items: [{ label: '公告管理', to: '/admin/content/announcements' }, { label: '考試時程', to: '/admin/content/exam-schedule' }, { label: '首頁版位', to: '/admin/content/homepage' }, { label: '宣傳影片', to: '/admin/content/promo-videos' }, { label: '本期專題', to: '/admin/content/featured-topics' }, { label: '隱私與資料', to: '/admin/content/privacy' }, { label: '聯絡我們', to: '/admin/content/contact' }] },
    { label: '辭典', icon: BookOpen, items: [{ label: '詞條', to: '/admin/dictionary/words' }, { label: '語法', to: '/admin/dictionary/grammar' }, { label: '主檔', to: '/admin/dictionary/taxonomies' }, { label: '批次匯入／匯出', to: '/admin/dictionary/import' }] },
    {
        label: '題庫', icon: FileQuestion, items: [
            { label: '初級是非題', to: '/admin/quiz-bank/true-false' },
            { label: '中級選擇題', to: '/admin/quiz-bank/choice' },
            { label: '中高級／高級', to: '/admin/quiz-bank/vocab' },
            { label: '外部題源', to: '/admin/quiz-bank/sources' },
            { label: '情境題', to: '/admin/quiz-bank/situations' },
            { label: 'IRT 參數', to: '/admin/quiz-bank/irt-config' },
        ],
    },
    {
        label: '審核', icon: ClipboardCheck, items: [
            { label: '送審佇列', to: '/admin/review' },
            { label: '待專家驗證佇列', to: '/admin/verification' },
            { label: '分享筆記', to: '/admin/moderation/notes' },
            { label: '發音錄音', to: '/admin/moderation/recordings' },
            { label: '檢舉佇列', to: '/admin/moderation/reports' },
        ],
    },
    { label: '使用者', icon: Users, items: [{ label: '使用者管理', to: '/admin/users' }] },
    { label: '分析', icon: BarChart3, items: [{ label: '搜尋分析', to: '/admin/analytics/search' }, { label: '題目品質分析', to: '/admin/analytics/quiz-quality' }, { label: '留存分析', to: '/admin/analytics/retention' }] },
    { label: '遊戲', icon: Gamepad2, items: [{ label: '遊戲參數設定', to: '/admin/games/settings' }] },
    {
        label: '系統', icon: Settings, items: [
            { label: '快取管理', to: '/admin/system/cache' },
            { label: '限流設定', to: '/admin/system/rate-limits' },
            { label: '功能開關', to: '/admin/system/feature-flags' },
            { label: '形態分析能力', to: '/admin/system/morphology-capabilities' },
        ],
    },
];

// 每個選單項目本身就是一組 [群組標籤, 項目標籤]，NAV_GROUPS 已經有了，直接
// 從那裡算出精確比對的麵包屑，不再手動另外維護一份——原本這裡跟 NAV_GROUPS
// 是兩份分開的清單，辭典大類（詞條／語法／主檔／批次匯入）上線時就只更新了
// NAV_GROUPS，這裡沒有跟著加，這幾頁的麵包屑其實一直退回顯示網址最後一段
// 的英文（例如 words、grammar）。
const NAV_BREADCRUMB_BY_PATH = new Map();
NAV_GROUPS.forEach(({ label: groupLabel, items }) => {
    items.forEach((item) => {
        if (item.to) NAV_BREADCRUMB_BY_PATH.set(item.to, [groupLabel, item.label]);
    });
});

// 選單上沒有自己入口的「新增／編輯／詳情」子頁，NAV_GROUPS 沒有這些資訊，
// 只能手動列出——但只列出 AdminApp.jsx 裡真的有對應路由的子頁。判斷順序
// 由上到下，精確比對（例如 /admin/users/new）要排在對應的 startsWith
// 之前，不然會被 startsWith 先吃掉。
const DETAIL_BREADCRUMBS = [
    { test: (p) => p === '/admin/users/new', parts: ['使用者', '使用者管理', '新增'] },
    { test: (p) => p.startsWith('/admin/users/'), parts: ['使用者', '使用者管理', '詳情'] },
    { test: (p) => p === '/admin/content/announcements/new', parts: ['內容', '公告管理', '新增'] },
    { test: (p) => p.startsWith('/admin/content/announcements/'), parts: ['內容', '公告管理', '編輯'] },
    { test: (p) => p === '/admin/dictionary/words/new', parts: ['辭典', '詞條', '新增'] },
    { test: (p) => p.startsWith('/admin/dictionary/words/'), parts: ['辭典', '詞條', '編輯'] },
    { test: (p) => p.startsWith('/admin/dictionary/import/'), parts: ['辭典', '批次匯入／匯出', '詳情'] },
    // quiz-bank 的 vocab／situations／cloze 沒有子路由：vocab／situations 的
    // 編輯是同頁彈窗，cloze 是同頁分頁切換（見 AdminApp.jsx 的路由清單與
    // 註解），這裡故意不列，之前列的那幾條沒有任何路由會導到，是死碼。
];

const visibleNavGroups = (role) => NAV_GROUPS
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.roles || item.roles.includes(role)) }))
    .filter((group) => group.items.length > 0);

// 徽章顯示上限：超過就寫 99+，避免撐寬側邊欄
const formatBadge = (count) => (count > 99 ? '99+' : String(count));

const getBreadcrumb = (pathname) => {
    if (pathname === '/admin' || pathname === '/admin/') return ['總覽', '儀表板'];

    const exact = NAV_BREADCRUMB_BY_PATH.get(pathname);
    if (exact) return exact;

    const detail = DETAIL_BREADCRUMBS.find(({ test }) => test(pathname));
    if (detail) return detail.parts;

    const lastSegment = pathname.split('/').filter(Boolean).at(-1) || '總覽';
    try {
        return [decodeURIComponent(lastSegment)];
    } catch {
        // pathname 理論上都是 React Router 自己產生的合法 URL，不會有這個問題；
        // 萬一真的遇到損毀的 percent-encoding，顯示原始字串，不要讓整個
        // 後台版面（連側邊欄跟麵包屑）都因為這裡丟例外而整個垮掉。
        return [lastSegment];
    }
};

export default function AdminLayout({ pendingCounts = {} }) {
    const { userData } = useAuth();
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const [logoutError, setLogoutError] = useState('');
    // 窄螢幕的側欄選單：記下「在哪個路徑打開的」，換頁就自然視為關閉，不必另外用 effect 同步
    const [openedAt, setOpenedAt] = useState(null);
    const navOpen = openedAt === pathname;
    const toggleRef = useRef(null);
    const closeRef = useRef(null);
    const groups = visibleNavGroups(userData?.role);
    const roleLabel = ROLE_LABELS[userData?.role];
    const displayName = userData?.firestoreData?.name || '';
    const breadcrumb = getBreadcrumb(pathname);
    const contentRef = useRef(null);
    const { firstEntry, revealed, skipped, markReady } = useAdminEntry();

    // 分頁標題跟著麵包屑走（原本整個後台都是「源·語」）
    const pageTitle = breadcrumb[breadcrumb.length - 1];
    useEffect(() => {
        document.title = `${pageTitle}｜後台管理｜源·語`;
    }, [pageTitle]);

    // 後台殼層掛載完成 = 入口閘門可以開始倒數最短可見時間，然後收合
    useEffect(() => { markReady(); }, [markReady]);

    // 第一次進入的進場儀式：hold（光圈還蓋著，全部先隱藏）→ play（光圈開始收合，播放進場）→ idle
    const [ceremony, setCeremony] = useState(firstEntry ? 'hold' : 'idle');
    useEffect(() => {
        if (ceremony === 'hold' && revealed) setCeremony(skipped ? 'idle' : 'play');
    }, [ceremony, revealed, skipped]);
    useEffect(() => {
        if (skipped && ceremony === 'play') setCeremony('idle');
    }, [skipped, ceremony]);
    useEffect(() => {
        if (ceremony !== 'play') return undefined;
        const timer = setTimeout(() => setCeremony('idle'), 1800);
        return () => clearTimeout(timer);
    }, [ceremony]);

    // 換頁後把鍵盤焦點移到內容區（審查項 P3-26）：後台不經過前台的 RouteEffects，
    // 不處理的話焦點會留在已經換掉內容的側邊欄連結上，報讀器不知道頁面換了。
    // 第一次載入不搶焦點；使用者正在輸入時也不搶。
    const focusedPathRef = useRef(pathname);
    useEffect(() => {
        if (focusedPathRef.current === pathname) return undefined;
        focusedPathRef.current = pathname;
        const frame = requestAnimationFrame(() => {
            // 有彈窗開著（內容自己已經安排了焦點）就不要把焦點拉回背景
            if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
            const active = document.activeElement;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable)) return;
            contentRef.current?.focus({ preventScroll: true });
        });
        return () => cancelAnimationFrame(frame);
    }, [pathname]);

    // 換頁時重播內容進場動畫。不能用 key={pathname} 讓內容區整個重掛：有些頁面（例如公告編輯器
    // 「建立後導向 /:id」）靠同一個元件實例跨過路由變化，重掛會讓它的載入流程重跑。
    // 所以改成移除再加回 class（中間強制 reflow）讓 CSS 動畫重新開始，元件完全不受影響。
    useEffect(() => {
        const element = contentRef.current;
        if (!element || ceremony !== 'idle') return;
        element.classList.remove('is-entering');
        void element.offsetWidth;
        element.classList.add('is-entering');
    }, [pathname, ceremony]);

    const closeNav = useCallback((returnFocus = false) => {
        setOpenedAt(null);
        // 主內容區此刻還是 inert，要等這一輪渲染把 inert 拿掉之後才聚焦得到開關
        if (returnFocus) requestAnimationFrame(() => toggleRef.current?.focus());
    }, []);

    // 選單打開：焦點移到選單裡的關閉鈕；Esc 關閉並把焦點還給開關；視窗拉寬到不需要選單時自動關閉
    useEffect(() => {
        if (!navOpen) return undefined;
        const frame = requestAnimationFrame(() => closeRef.current?.focus());
        const onKey = (event) => { if (event.key === 'Escape') closeNav(true); };
        window.addEventListener('keydown', onKey);
        const wide = typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 901px)') : null;
        const onWide = (event) => { if (event.matches) closeNav(); };
        wide?.addEventListener?.('change', onWide);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener('keydown', onKey);
            wide?.removeEventListener?.('change', onWide);
        };
    }, [navOpen, closeNav]);

    // 登出後 AdminRoute 看到沒有登入狀態會自己導走；這裡直接回前台首頁，不停在後台登入頁。
    // 失敗時留在原頁並顯示原因，不要讓人以為已經登出。
    const handleLogout = async () => {
        setLogoutError('');
        try {
            await signOut();
            navigate('/', { replace: true });
        } catch {
            setLogoutError('登出失敗，請再試一次。');
        }
    };

    return (
        <div className={`admin-shell${navOpen ? ' is-nav-open' : ''}${ceremony === 'hold' ? ' admin-shell--hold' : ''}${ceremony === 'play' ? ' admin-shell--play' : ''}`}>
            <a href="#admin-main" className="visually-hidden-focusable" inert={navOpen || undefined}>跳到後台主要內容</a>
            <AdminReauthModal />
            <aside className="admin-sidebar" id="admin-sidebar">
                <button type="button" className="admin-nav-close" ref={closeRef} onClick={() => closeNav(true)} aria-label="關閉主選單">
                    <X size={20} aria-hidden="true" />
                </button>
                <Link className="admin-brand" to="/admin" onClick={() => closeNav()}><span>源·語</span><small>ADMIN CONSOLE</small></Link>
                <nav className="admin-navigation" aria-label="後台主選單">
                    {groups.map(({ label, icon: Icon, items }) => (
                        <section className="admin-nav-group" key={label}>
                            <h2><Icon size={16} aria-hidden="true" />{label}</h2>
                            <ul>
                                {items.map((item) => (
                                    <li key={item.label}>
                                        <NavLink
                                            className={({ isActive }) => `admin-nav-link${isActive ? ' active' : ''}`}
                                            end={item.end}
                                            to={item.to}
                                            onClick={() => closeNav()}
                                        >
                                            <span>{item.label}</span>
                                            {pendingCounts[item.to] > 0 && (
                                                <span className="admin-count-badge">
                                                    {formatBadge(pendingCounts[item.to])}
                                                    <span className="visually-hidden"> 項待辦</span>
                                                </span>
                                            )}
                                        </NavLink>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ))}
                </nav>
                <div className="admin-sidebar-user">
                    <div><span>目前身分</span><strong>{roleLabel ?? '後台人員'}</strong></div>
                    <div className="admin-sidebar-actions">
                        <Link to="/">回到前台</Link>
                        <button type="button" className="admin-logout" onClick={handleLogout}>登出</button>
                    </div>
                    {logoutError && <p className="admin-logout-error" role="alert">{logoutError}</p>}
                </div>
            </aside>
            {navOpen && <button type="button" className="admin-nav-backdrop" tabIndex={-1} aria-label="關閉主選單" onClick={() => closeNav(true)} />}
            <div className="admin-main-column" inert={navOpen || undefined}>
                <header className="admin-topbar">
                    <button
                        type="button"
                        className="admin-nav-toggle"
                        ref={toggleRef}
                        aria-label="開啟主選單"
                        aria-expanded={navOpen}
                        aria-controls="admin-sidebar"
                        onClick={() => setOpenedAt(pathname)}
                    >
                        <Menu size={20} aria-hidden="true" />
                    </button>
                    <nav className="admin-breadcrumb" aria-label="麵包屑">
                        {breadcrumb.map((part, index) => (
                            <span key={`${part}-${index}`}>{index > 0 && <i>›</i>}{part}</span>
                        ))}
                    </nav>
                    <div className="admin-topbar-user">
                        <span className="admin-user-avatar" aria-hidden="true">{(displayName || roleLabel || '管').charAt(0)}</span>
                        <div>
                            <strong>{displayName || roleLabel || '後台人員'}</strong>
                            {displayName && roleLabel && <small>{roleLabel}</small>}
                        </div>
                    </div>
                </header>
                {/* FE-4：後台是全站最複雜的區塊，但原本完全沒有自己的
                    error boundary——任何一個管理頁面丟出例外，都會一路
                    炸到 route.jsx 最外層那一個，連側邊欄與麵包屑都一起
                    消失，使用者只能整頁重載。這裡包一層 scoped boundary，
                    讓錯誤侷限在內容區、導覽仍然可用。
                    resetKeys 傳入 pathname：換到另一個管理頁面時自動
                    復原，不會黏在前一頁的錯誤畫面（見 errorBoundary.jsx）。 */}
                <div className="admin-route-content" id="admin-main" tabIndex={-1} ref={contentRef}>
                    <ErrorBoundary
                        resetKeys={[pathname]}
                        fallback={({ reset }) => (
                            <div className="admin-route-error" role="alert">
                                <h2>這個管理頁面發生錯誤</h2>
                                <p>可以重試一次，或從左側選單切換到其他頁面繼續操作。</p>
                                <button type="button" className="btn btn-danger" onClick={reset}>
                                    重新載入這個頁面
                                </button>
                            </div>
                        )}
                    >
                        {/* 後台頁面元件都改成 lazy load 了（AdminApp.jsx）；換頁時只有
                            這個內容區顯示載入中，側邊欄與麵包屑維持顯示不消失。 */}
                        <Suspense fallback={<AdminRouteSkeleton />}>
                            <Outlet context={{ pendingCounts }} />
                        </Suspense>
                    </ErrorBoundary>
                </div>
            </div>
        </div>
    );
}
