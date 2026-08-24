import { Suspense } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Spinner } from 'react-bootstrap';
import { BarChart3, BookOpen, ClipboardCheck, FileQuestion, Gamepad2, LayoutDashboard, Megaphone, Settings, Users } from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import ErrorBoundary from '../../errorBoundary';
import { ROLE_LABELS } from '../constants/roles';
import '../../../static/css/_admin/layout.css';


const NAV_GROUPS = [
    { label: '總覽', icon: LayoutDashboard, items: [{ label: '儀表板', to: '/admin', end: true }] },
    { label: '內容', icon: Megaphone, items: [{ label: '公告管理', to: '/admin/content/announcements', pending: true }, { label: '考試時程', to: '/admin/content/exam-schedule' }, { label: '首頁版位', to: '/admin/content/homepage' }] },
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

export default function AdminLayout({ pendingAnnouncementCount }) {
    const { userData } = useAuth();
    const { pathname } = useLocation();
    const breadcrumb = getBreadcrumb(pathname);

    return (
        <div className="admin-shell">
            <aside className="admin-sidebar">
                <Link className="admin-brand" to="/admin"><span>源·語</span><small>ADMIN CONSOLE</small></Link>
                <nav className="admin-navigation" aria-label="後台主選單">
                    {NAV_GROUPS.map(({ label, icon: Icon, items }) => (
                        <section className="admin-nav-group" key={label}>
                            <h2><Icon size={16} aria-hidden="true" />{label}</h2>
                            <ul>
                                {items.map((item) => (
                                    <li key={item.label}>
                                        {item.to ? (
                                            <NavLink
                                                className={({ isActive }) => `admin-nav-link${isActive ? ' active' : ''}`}
                                                end={item.end}
                                                to={item.to}
                                            >
                                                <span>{item.label}</span>
                                                {item.pending && pendingAnnouncementCount > 0 && (
                                                    <span className="admin-count-badge">{pendingAnnouncementCount}</span>
                                                )}
                                            </NavLink>
                                        ) : (
                                            <div className="admin-nav-link admin-nav-disabled">
                                                <span>{item.label}</span>
                                                <span className="admin-planned-badge">規劃中</span>
                                            </div>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ))}
                </nav>
                <div className="admin-sidebar-user">
                    <div><span>目前身分</span><strong>{ROLE_LABELS[userData?.role] ?? userData?.role ?? '—'}</strong></div>
                    <Link to="/">回到前台</Link>
                </div>
            </aside>
            <div className="admin-main-column">
                <header className="admin-topbar">
                    <div className="admin-breadcrumb" aria-label="麵包屑">
                        {breadcrumb.map((part, index) => (
                            <span key={`${part}-${index}`}>{index > 0 && <i>›</i>}{part}</span>
                        ))}
                    </div>
                    <div className="admin-topbar-user">
                        <span className="admin-user-avatar">{ROLE_LABELS[userData?.role]?.charAt(0) ?? '管'}</span>
                        <div>
                            <strong>{ROLE_LABELS[userData?.role] ?? '後台人員'}</strong>
                            <small>{userData?.role ?? ''}</small>
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
                <div className="admin-route-content">
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
                        <Suspense fallback={(
                            <div className="admin-route-loading">
                                <Spinner animation="border" variant="primary" />
                            </div>
                        )}>
                            <Outlet />
                        </Suspense>
                    </ErrorBoundary>
                </div>
            </div>
        </div>
    );
}
