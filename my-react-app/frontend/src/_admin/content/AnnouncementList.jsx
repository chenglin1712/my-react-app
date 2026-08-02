import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Button, Form, Modal, Spinner, Table, Alert } from 'react-bootstrap';
import { Edit3, Eye, Plus, Send, Trash2, Undo2, Check, X, Archive, Upload } from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { apiDelete, apiGet, apiPost } from '../../../utils/apiClient';
import '../../../static/css/_admin/announcements.css';

const CONTENT_EDITORS = ['owner', 'admin', 'editor'];
const PUBLISHERS = ['owner', 'admin'];

const CATEGORIES = {
    announcement: '公告', activity: '活動', exam: '考試', maintenance: '系統維護',
};
const TRIBES = {
    tayal: '泰雅語', amis: '阿美語', bunun: '布農語', kavalan: '噶瑪蘭語', paiwan: '排灣語',
};
const STATUSES = {
    draft: { label: '草稿', bg: 'secondary' },
    pending_review: { label: '送審中', bg: 'warning' },
    rejected: { label: '已退件', bg: 'danger' },
    published: { label: '已發布', bg: 'success' },
    unpublished: { label: '已下架', bg: 'dark' },
};

const formatDateTime = (value) => value
    ? new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
    : '—';
// pin_until 後端是純日期欄位（DateField，不帶時間，例如 "2026-09-01"）。
// new Date("2026-09-01") 會被 ECMA-262 解讀成 UTC 午夜，再用瀏覽器本地
// 時區格式化——在 UTC 負偏移地區（例如美洲）會被往前推一天，顯示的日期
// 跟後端存的不是同一天。純日期字串直接拆字串顯示，完全不經過 Date／
// 時區換算，才不會有這個位移。
const formatDate = (value) => {
    if (!value) return '—';
    const [year, month, day] = value.split('-');
    return `${year}/${month}/${day}`;
};

export default function AnnouncementList() {
    const { userData } = useAuth();
    const role = userData?.role;
    // 儀表板的「待審公告」卡片連到 /admin/content/announcements?status=
    // pending_review，這裡只在掛載當下讀一次網址上的 status 帶入初始篩選，
    // 不用 useEffect 同步——使用者在頁面上改篩選條件後，網址不需要跟著變。
    const [searchParams] = useSearchParams();
    const [filters, setFilters] = useState({ keyword: '', status: searchParams.get('status') ?? '', category: '', tribe: '' });
    const [query, setQuery] = useState(filters);
    const [data, setData] = useState({ results: [], count: 0, page: 1, page_size: 10 });
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [actionId, setActionId] = useState(null);
    const [error, setError] = useState('');
    const [rejectTarget, setRejectTarget] = useState(null);
    const [rejectReason, setRejectReason] = useState('');

    const loadAnnouncements = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams({ page: String(page), page_size: '10' });
            Object.entries(query).forEach(([key, value]) => value && params.set(key, value));
            setData(await apiGet(`/adminapi/announcements/?${params.toString()}`));
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [page, query]);

    useEffect(() => { loadAnnouncements(); }, [loadAnnouncements]);

    const search = (event) => {
        event.preventDefault();
        setPage(1);
        setQuery(filters);
    };

    const runAction = async (item, action, body) => {
        setActionId(item.id);
        setError('');
        try {
            if (action === 'delete') {
                if (!window.confirm(`確定要刪除「${item.title}」嗎？`)) return;
                await apiDelete(`/adminapi/announcements/${item.id}/`);
            } else {
                await apiPost(`/adminapi/announcements/${item.id}/${action}/`, body);
            }
            await loadAnnouncements();
        } catch (err) {
            setError(err.message);
        } finally {
            setActionId(null);
        }
    };

    const submitReject = async () => {
        if (!rejectReason.trim()) return;
        await runAction(rejectTarget, 'reject', { review_comment: rejectReason.trim() });
        setRejectTarget(null);
        setRejectReason('');
    };

    const actionsFor = (item) => {
        const busy = actionId === item.id;
        const buttons = [];
        if (CONTENT_EDITORS.includes(role) && ['draft', 'rejected'].includes(item.status)) {
            buttons.push(<Button key="edit" as={Link} to={`/admin/content/announcements/${item.id}`} size="sm" variant="outline-primary"><Edit3 size={14} /> 編輯</Button>);
            buttons.push(<Button key="submit" size="sm" variant="outline-success" disabled={busy} onClick={() => runAction(item, 'submit')}><Send size={14} /> 送審</Button>);
        }
        // 已下架的內容也能編輯（後端視同重新起草，儲存後退回 draft）。
        if (item.status === 'unpublished' && CONTENT_EDITORS.includes(role)) {
            buttons.push(<Button key="edit" as={Link} to={`/admin/content/announcements/${item.id}`} size="sm" variant="outline-primary"><Edit3 size={14} /> 編輯</Button>);
        }
        // 刪除固定是 PUBLISHERS 專屬——跟後端 _delete_announcement 的
        // require_role(PUBLISHERS) 對齊，不能讓 editor 在畫面上看到一顆
        // 點下去一定 403 的按鈕。
        if (item.status === 'draft' && PUBLISHERS.includes(role)) {
            buttons.push(<Button key="delete" size="sm" variant="outline-danger" disabled={busy} onClick={() => runAction(item, 'delete')}><Trash2 size={14} /> 刪除</Button>);
        }
        // 後端 announcement_withdraw 用 require_role(CONTENT_EDITORS)，owner／
        // admin 跟 editor 一樣能撤回任何一筆待審公告（沒有限定只能撤回自己
        // 送的），畫面上不能只給 editor 看到這顆按鈕。
        if (item.status === 'pending_review' && CONTENT_EDITORS.includes(role)) {
            buttons.push(<Button key="withdraw" size="sm" variant="outline-secondary" disabled={busy} onClick={() => runAction(item, 'withdraw')}><Undo2 size={14} /> 撤回</Button>);
        }
        if (item.status === 'pending_review' && PUBLISHERS.includes(role)) {
            buttons.push(<Button key="approve" size="sm" variant="outline-success" disabled={busy} onClick={() => runAction(item, 'approve', { review_comment: '' })}><Check size={14} /> 核准</Button>);
            buttons.push(<Button key="reject" size="sm" variant="outline-danger" disabled={busy} onClick={() => { setRejectTarget(item); setRejectReason(''); }}><X size={14} /> 退件</Button>);
        }
        if (item.status === 'published' && PUBLISHERS.includes(role)) {
            buttons.push(<Button key="unpublish" size="sm" variant="outline-secondary" disabled={busy} onClick={() => runAction(item, 'unpublish')}><Archive size={14} /> 下架</Button>);
        }
        if (item.status === 'unpublished' && PUBLISHERS.includes(role)) {
            buttons.push(<Button key="republish" size="sm" variant="outline-success" disabled={busy} onClick={() => runAction(item, 'republish')}><Upload size={14} /> 重新發布</Button>);
        }
        // 沒有狀態操作權限時仍提供檢視入口，避免審核及分析角色無法查看內容。
        if (!buttons.length) buttons.push(<Button key="view" as={Link} to={`/admin/content/announcements/${item.id}`} size="sm" variant="outline-secondary"><Eye size={14} /> 檢視</Button>);
        return buttons;
    };

    const hasNext = data.page * data.page_size < data.count;

    return (
        <main className="announcement-admin-page">
            <div className="announcement-page-heading">
                <div><h1>公告管理</h1><p>建立、審核與發布後台公告</p></div>
                {CONTENT_EDITORS.includes(role) && <Button as={Link} to="/admin/content/announcements/new"><Plus size={18} /> 新增公告</Button>}
            </div>
            {error && <Alert variant="danger">{error}</Alert>}
            <Form className="announcement-filter-panel" onSubmit={search}>
                <Form.Control aria-label="關鍵字搜尋" placeholder="搜尋標題或內文" value={filters.keyword} onChange={(e) => setFilters({ ...filters, keyword: e.target.value })} />
                <Form.Select aria-label="狀態" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                    <option value="">全部狀態</option>{Object.entries(STATUSES).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
                </Form.Select>
                <Form.Select aria-label="分類" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
                    <option value="">全部分類</option>{Object.entries(CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Form.Select>
                <Form.Select aria-label="族語" value={filters.tribe} onChange={(e) => setFilters({ ...filters, tribe: e.target.value })}>
                    <option value="">全部族語</option>{Object.entries(TRIBES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Form.Select>
                <Button type="submit">搜尋</Button>
            </Form>

            <div className="announcement-table-card">
                {loading ? <div className="announcement-loading"><Spinner animation="border" /><span>載入公告中…</span></div> : (
                    <Table responsive hover className="announcement-table">
                        <thead><tr><th>標題</th><th>分類</th><th>族語</th><th>狀態</th><th>置頂</th><th>建立者</th><th>最後更新</th><th>操作</th></tr></thead>
                        <tbody>{data.results.length ? data.results.map((item) => (
                            <tr key={item.id}>
                                <td className="announcement-title-cell">{item.title}</td>
                                <td>{CATEGORIES[item.category] ?? item.category}</td>
                                <td>{item.tribes?.length ? item.tribes.map((tribe) => TRIBES[tribe] ?? tribe).join('、') : '全部族語'}</td>
                                <td><Badge bg={STATUSES[item.status]?.bg ?? 'secondary'}>{STATUSES[item.status]?.label ?? item.status}</Badge></td>
                                <td>{item.is_pinned ? <>是<span className="announcement-cell-note">至 {formatDate(item.pin_until)}</span></> : '否'}</td>
                                <td>{item.created_by || '—'}</td><td>{formatDateTime(item.updated_at)}</td>
                                <td><div className="announcement-row-actions">{actionsFor(item)}</div></td>
                            </tr>
                        )) : <tr><td colSpan="8" className="announcement-empty">沒有符合條件的公告</td></tr>}</tbody>
                    </Table>
                )}
                <div className="announcement-pagination"><span>共 {data.count} 筆</span><div><Button variant="outline-secondary" disabled={loading || page <= 1} onClick={() => setPage((value) => value - 1)}>上一頁</Button><span>第 {data.page} 頁</span><Button variant="outline-secondary" disabled={loading || !hasNext} onClick={() => setPage((value) => value + 1)}>下一頁</Button></div></div>
            </div>

            <Modal show={Boolean(rejectTarget)} onHide={() => setRejectTarget(null)} centered>
                <Modal.Header closeButton><Modal.Title>退件原因</Modal.Title></Modal.Header>
                <Modal.Body><Form.Group controlId="announcement-reject-reason"><Form.Label>請說明需要修改的內容</Form.Label><Form.Control as="textarea" rows={4} required value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} isInvalid={Boolean(rejectTarget) && !rejectReason.trim()} /><Form.Control.Feedback type="invalid">退件理由為必填</Form.Control.Feedback></Form.Group></Modal.Body>
                <Modal.Footer><Button variant="secondary" onClick={() => setRejectTarget(null)}>取消</Button><Button variant="danger" disabled={!rejectReason.trim() || actionId === rejectTarget?.id} onClick={submitReject}>確認退件</Button></Modal.Footer>
            </Modal>
        </main>
    );
}
