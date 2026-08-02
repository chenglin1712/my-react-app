import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Badge, Spinner } from 'react-bootstrap';
import { Activity, BarChart3, ClipboardCheck, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { apiGet } from '../../../utils/apiClient';
import '../../../static/css/_admin/dashboard.css';

const ACTION_LABELS = { create: '建立', update: '編輯', submit: '送審', withdraw: '撤回', approve: '核准', reject: '退件', unpublish: '下架', republish: '重新發布' };
const formatDateTime = (value) => value
    ? new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
    : '—';

const ComingSoonStat = ({ icon: Icon, title }) => (
    <article className="admin-stat-card admin-stat-placeholder">
        <div className="admin-stat-icon"><Icon size={20} /></div>
        <div><span className="admin-stat-title">{title}</span><strong>—</strong><Badge bg="light" text="secondary">即將推出</Badge></div>
    </article>
);

const EmptyPanel = ({ title, message, className = '' }) => (
    <section className={`dashboard-panel dashboard-empty-panel ${className}`}><h2>{title}</h2><div><BarChart3 size={28} /><p>{message}</p></div></section>
);

export default function Dashboard() {
    const { userData } = useAuth();
    const canViewAudit = ['owner', 'admin'].includes(userData?.role);
    const [pendingCount, setPendingCount] = useState(null);
    const [pendingLoading, setPendingLoading] = useState(true);
    const [pendingError, setPendingError] = useState('');
    const [auditItems, setAuditItems] = useState([]);
    const [auditLoading, setAuditLoading] = useState(canViewAudit);
    const [auditError, setAuditError] = useState('');

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const data = await apiGet('/adminapi/announcements/?status=pending_review&page_size=1');
                if (active) setPendingCount(data.count);
            } catch (err) { if (active) setPendingError(err.message); }
            finally { if (active) setPendingLoading(false); }
        })();
        return () => { active = false; };
    }, []);

    useEffect(() => {
        if (!canViewAudit) return;
        let active = true;
        setAuditLoading(true);
        (async () => {
            try {
                const data = await apiGet('/adminapi/audit-log/?limit=8');
                if (active) setAuditItems(data.results ?? []);
            } catch (err) { if (active) setAuditError(err.message); }
            finally { if (active) setAuditLoading(false); }
        })();
        return () => { active = false; };
    }, [canViewAudit]);

    return (
        <main className="admin-dashboard-page">
            <div className="dashboard-heading"><h1>儀表板</h1><p>後台工作與服務概況</p></div>
            <div className="dashboard-stat-grid">
                <Link className="admin-stat-card admin-stat-link" to="/admin/content/announcements?status=pending_review">
                    <div className="admin-stat-icon"><ClipboardCheck size={20} /></div>
                    <div><span className="admin-stat-title">待審公告</span>{pendingLoading ? <Spinner animation="border" size="sm" /> : pendingError ? <small className="dashboard-inline-error">{pendingError}</small> : <strong>{pendingCount}</strong>}<span className="admin-stat-detail">前往公告管理</span></div>
                </Link>
                <ComingSoonStat icon={Users} title="今日活躍使用者" />
                <ComingSoonStat icon={UserPlus} title="本週新註冊" />
                <ComingSoonStat icon={Activity} title="今日測驗完成" />
            </div>
            <div className="dashboard-primary-grid">
                <EmptyPanel className="dashboard-chart-panel" title="每日活躍與新註冊" message="尚未串接資料來源，開發中" />
                <EmptyPanel title="族語使用分布" message="尚未串接資料來源，開發中" />
            </div>
            <div className={`dashboard-bottom-grid${canViewAudit ? '' : ' without-audit'}`}>
                {canViewAudit && <section className="dashboard-panel dashboard-audit-panel">
                    <h2>最近操作</h2>
                    {auditLoading ? <div className="dashboard-panel-loading"><Spinner animation="border" size="sm" />載入中</div> : auditError ? <Alert variant="danger">{auditError}</Alert> : auditItems.length ? (
                        <ul>{auditItems.map((item) => <li key={item.id}><div><strong>{item.actor_uid || '—'}</strong><span>{ACTION_LABELS[item.action] ?? item.action} {item.target_type} #{item.target_id}</span></div><time>{formatDateTime(item.created_at)}</time></li>)}</ul>
                    ) : <p className="dashboard-no-records">目前沒有操作紀錄</p>}
                </section>}
                <EmptyPanel title="系統健康" message="尚未串接健康檢查資料" />
            </div>
        </main>
    );
}
