import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { BarChart3, BookOpen, ClipboardCheck, FileQuestion, LayoutDashboard, Megaphone, Settings, Users } from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import '../../../static/css/_admin/layout.css';

const ROLE_LABELS = { owner: '擁有者', admin: '管理員', editor: '內容編輯', reviewer: '審核者', analyst: '數據觀察者' };

const NAV_GROUPS = [
    { label: '總覽', icon: LayoutDashboard, items: [{ label: '儀表板', to: '/admin', end: true }] },
    { label: '內容', icon: Megaphone, items: [{ label: '公告管理', to: '/admin/content/announcements', pending: true }, { label: '考試時程', to: '/admin/content/exam-schedule' }, { label: '首頁版位', to: '/admin/content/homepage' }] },
    { label: '辭典', icon: BookOpen, items: [{ label: '詞條' }, { label: '語法' }, { label: '主檔' }] },
    { label: '題庫', icon: FileQuestion, items: [{ label: '中高級／高級' }, { label: '外部題源' }] },
    { label: '審核', icon: ClipboardCheck, items: [{ label: '送審佇列' }, { label: '分享筆記' }] },
    { label: '使用者', icon: Users, items: [{ label: '使用者管理' }] },
    { label: '分析', icon: BarChart3, items: [{ label: '學習數據' }] },
    { label: '系統', icon: Settings, items: [{ label: '系統維運' }] },
];

const getBreadcrumb = (pathname) => {
    if (pathname === '/admin' || pathname === '/admin/') return ['總覽', '儀表板'];
    if (pathname === '/admin/content/announcements') return ['內容', '公告管理'];
    if (pathname.startsWith('/admin/content/announcements/')) return ['內容', '公告管理', '編輯'];
    if (pathname === '/admin/content/exam-schedule') return ['內容', '考試時程'];
    if (pathname === '/admin/content/homepage') return ['內容', '首頁版位'];
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
