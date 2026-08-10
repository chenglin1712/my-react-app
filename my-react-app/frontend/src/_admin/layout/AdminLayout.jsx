import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { BarChart3, BookOpen, ClipboardCheck, FileQuestion, Gamepad2, LayoutDashboard, Megaphone, Settings, Users } from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import '../../../static/css/_admin/layout.css';

const ROLE_LABELS = { owner: '擁有者', admin: '管理員', editor: '內容編輯', reviewer: '審核者', analyst: '數據觀察者' };

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

const getBreadcrumb = (pathname) => {
    if (pathname === '/admin' || pathname === '/admin/') return ['總覽', '儀表板'];
    if (pathname === '/admin/analytics/search') return ['分析', '搜尋分析'];
    if (pathname === '/admin/analytics/quiz-quality') return ['分析', '題目品質分析'];
    if (pathname === '/admin/analytics/retention') return ['分析', '留存分析'];
    if (pathname === '/admin/content/announcements') return ['內容', '公告管理'];
    if (pathname.startsWith('/admin/content/announcements/')) return ['內容', '公告管理', '編輯'];
    if (pathname === '/admin/content/exam-schedule') return ['內容', '考試時程'];
    if (pathname === '/admin/content/homepage') return ['內容', '首頁版位'];
    if (pathname === '/admin/quiz-bank/true-false') return ['題庫', '初級是非題'];
    if (pathname === '/admin/quiz-bank/choice') return ['題庫', '中級選擇題'];
    if (pathname === '/admin/quiz-bank/vocab') return ['題庫', '中高級／高級'];
    if (pathname.startsWith('/admin/quiz-bank/vocab/')) return ['題庫', '中高級／高級', '編輯'];
    if (pathname === '/admin/quiz-bank/cloze') return ['題庫', '中高級／高級'];
    if (pathname.startsWith('/admin/quiz-bank/cloze/')) return ['題庫', '中高級／高級', '編輯'];
    if (pathname === '/admin/quiz-bank/sources') return ['題庫', '外部題源'];
    if (pathname === '/admin/quiz-bank/situations') return ['題庫', '情境題'];
    if (pathname.startsWith('/admin/quiz-bank/situations/')) return ['題庫', '情境題', '編輯'];
    if (pathname === '/admin/quiz-bank/irt-config') return ['題庫', 'IRT 參數'];
    if (pathname === '/admin/review') return ['審核', '送審佇列'];
    if (pathname === '/admin/moderation/notes') return ['審核', '分享筆記'];
    if (pathname === '/admin/moderation/recordings') return ['審核', '發音錄音'];
    if (pathname === '/admin/moderation/reports') return ['審核', '檢舉佇列'];
    if (pathname === '/admin/users') return ['使用者', '使用者管理'];
    if (pathname.startsWith('/admin/users/')) return ['使用者', '使用者管理', '詳情'];
    if (pathname === '/admin/games/settings') return ['遊戲', '遊戲參數設定'];
    if (pathname === '/admin/system/cache') return ['系統', '快取管理'];
    if (pathname === '/admin/system/rate-limits') return ['系統', '限流設定'];
    if (pathname === '/admin/system/feature-flags') return ['系統', '功能開關'];
    return [decodeURIComponent(pathname.split('/').filter(Boolean).at(-1) || '總覽')];
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
                            <ul>{items.map((item) => (
                                <li key={item.label}>{item.to ? (
                                    <NavLink className={({ isActive }) => `admin-nav-link${isActive ? ' active' : ''}`} end={item.end} to={item.to}>
                                        <span>{item.label}</span>{item.pending && pendingAnnouncementCount > 0 && <span className="admin-count-badge">{pendingAnnouncementCount}</span>}
                                    </NavLink>
                                ) : <div className="admin-nav-link admin-nav-disabled"><span>{item.label}</span><span className="admin-planned-badge">規劃中</span></div>}</li>
                            ))}</ul>
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
                    <div className="admin-breadcrumb" aria-label="麵包屑">{breadcrumb.map((part, index) => <span key={`${part}-${index}`}>{index > 0 && <i>›</i>}{part}</span>)}</div>
                    <div className="admin-topbar-user"><span className="admin-user-avatar">{ROLE_LABELS[userData?.role]?.charAt(0) ?? '管'}</span><div><strong>{ROLE_LABELS[userData?.role] ?? '後台人員'}</strong><small>{userData?.role ?? ''}</small></div></div>
                </header>
                <div className="admin-route-content"><Outlet /></div>
            </div>
        </div>
    );
}
