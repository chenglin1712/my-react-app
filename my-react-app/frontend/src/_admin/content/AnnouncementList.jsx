import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Button, Form, Modal, Spinner, Table, Alert } from 'react-bootstrap';
import { Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { TRIBE_FULL_NAME_BY_SLUG } from '../../constants/tribes';
import { apiDelete, apiGet, apiPost } from '../../../utils/apiClient';
import ReviewActions from '../reviewWorkflow/ReviewActions';
import ReviewPagination from '../reviewWorkflow/ReviewPagination';
import { REVIEW_ACTION_META } from '../reviewWorkflow/reviewActionPolicy';
import { formatDateTime } from '../adminFormat';
import '../../../static/css/_admin/announcements.css';

const CONTENT_EDITORS = ['owner', 'admin', 'editor'];
const PUBLISHERS = ['owner', 'admin'];

const CATEGORIES = {
    announcement: '公告', activity: '活動', exam: '考試', maintenance: '系統維護',
};
const SOURCES = { admin: '後台建立', crawler: '爬蟲匯入' };
const STATUSES = {
    draft: { label: '草稿', bg: 'secondary' },
    pending_review: { label: '送審中', bg: 'warning' },
    rejected: { label: '已退件', bg: 'danger' },
    published: { label: '已發布', bg: 'success' },
    unpublished: { label: '已下架', bg: 'dark' },
};

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
    const [filters, setFilters] = useState({ keyword: '', status: searchParams.get('status') ?? '', category: '', tribe: '', source: '' });
    const [query, setQuery] = useState(filters);
    const [data, setData] = useState({ results: [], count: 0, page: 1, page_size: 10 });
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [actionId, setActionId] = useState(null);
    const [error, setError] = useState('');
    // 逐列動作（核准/退件/撤回/刪除…）跟同步爬蟲共用同一把鎖：光靠
    // actionId／syncing 這兩個 state 只能各自擋自己的重複觸發，擋不住
    // 「核准 A 列的同時按下同步」這種跨操作的情況——這兩者都會呼叫
    // loadAnnouncements() 重新整份清單，同時執行沒有意義。
    const actionLockRef = useRef(false);
    // 只有「目前最新的那一次清單查詢」可以寫回狀態：連續換頁或連續搜尋時，
    // 較舊的查詢若比較新的查詢晚回來，不能覆蓋新查詢的結果與 loading 狀態。
    const loadRequestRef = useRef(0);
    // type 用來區分一般公告送審的退件，以及已發布公告待審修改的退件。
    // 兩者共用同一個理由 Modal，但送出端點不同。
    const [rejectTarget, setRejectTarget] = useState(null);
    const [rejectReason, setRejectReason] = useState('');
    const [syncStatus, setSyncStatus] = useState(null);
    const [syncing, setSyncing] = useState(false);
    const [syncMessage, setSyncMessage] = useState('');

    const loadAnnouncements = useCallback(async () => {
        const requestId = loadRequestRef.current + 1;
        loadRequestRef.current = requestId;
        const isStale = () => loadRequestRef.current !== requestId;

        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams({ page: String(page), page_size: '10' });
            Object.entries(query).forEach(([key, value]) => value && params.set(key, value));
            const result = await apiGet(`/adminapi/announcements/?${params.toString()}`);
            if (isStale()) return;
            setData(result);
        } catch (err) {
            if (isStale()) return;
            setError(err.message);
        } finally {
            if (!isStale()) setLoading(false);
        }
    }, [page, query]);

    useEffect(() => { loadAnnouncements(); }, [loadAnnouncements]);

    // 只有能觸發同步的角色才需要知道上次同步結果——其餘角色看不到下面的
    // 同步按鈕，多打這支查詢對他們毫無用處。
    useEffect(() => {
        if (!CONTENT_EDITORS.includes(role)) return;
        (async () => {
            try {
                const result = await apiGet('/adminapi/announcements/sync-crawler/');
                setSyncStatus(result.status);
            } catch {
                // 狀態顯示是輔助資訊，載入失敗不阻擋公告列表本身的使用。
            }
        })();
    }, [role]);

    const runSync = async () => {
        if (actionLockRef.current) return;
        actionLockRef.current = true;
        setSyncing(true);
        setError('');
        setSyncMessage('');
        try {
            const result = await apiPost('/adminapi/announcements/sync-crawler/');
            setSyncStatus(result.status);
            setSyncMessage(`已同步：新增 ${result.imported} 筆、略過 ${result.skipped_existing} 筆`);
            await loadAnnouncements();
        } catch (err) {
            setError(err.message);
        } finally {
            actionLockRef.current = false;
            setSyncing(false);
        }
    };

    const search = (event) => {
        event.preventDefault();
        setPage(1);
        setQuery(filters);
    };

    // 回傳「這次動作是否真的完成」——呼叫端（submitReject）要靠這個決定
    // 該不該收掉退件 Modal；原本沒有回傳值時，submitReject 不管成功失敗
    // 都會接著關閉對話框，退件失敗時使用者剛打的理由就整段消失，只在
    // 頁面上方留一行錯誤訊息（跟 useReviewableContentCrud.js 修過的同一類
    // 問題）。
    const runAction = async (item, action, body) => {
        if (actionLockRef.current) return false;
        actionLockRef.current = true;
        setActionId(item.id);
        setError('');
        try {
            if (action === 'delete') {
                if (!window.confirm(`確定要刪除「${item.title}」嗎？`)) return false;
                await apiDelete(`/adminapi/announcements/${item.id}/`);
            } else {
                await apiPost(`/adminapi/announcements/${item.id}/${action}/`, body);
            }
            await loadAnnouncements();
            return true;
        } catch (err) {
            setError(err.message);
            return false;
        } finally {
            actionLockRef.current = false;
            setActionId(null);
        }
    };

    const openRejectModal = (item, type) => {
        setRejectTarget({ item, type });
        setRejectReason('');
    };

    const closeRejectModal = () => {
        setRejectTarget(null);
        setRejectReason('');
    };

    const submitReject = async () => {
        if (!rejectTarget || !rejectReason.trim()) return;

        const action = rejectTarget.type === 'pending-revision'
            ? 'pending-revision/reject'
            : 'reject';

        const succeeded = await runAction(
            rejectTarget.item,
            action,
            { review_comment: rejectReason.trim() },
        );
        // 只有真的送出成功才收掉對話框；失敗時保留使用者打好的退件理由，
        // 讓他可以直接重試，不用整段重打。
        if (succeeded) closeRejectModal();
    };

    // FE-2：這一整段原本是 ~180 行、跟題庫那幾支面板同一種形狀的手寫規則。
    // 公告跟題庫有三個真實差異（多一個 unpublished 中介狀態與「重新發布」、
    // 核准門檻是 publishers 不含 reviewer、編輯/檢視是連到另一個路由頁面而
    // 不是開對話框），這些差異都用參數表達，不需要自己再寫一份規則。
    const ANNOUNCEMENT_ROLES = {
        editors: CONTENT_EDITORS,
        approvers: PUBLISHERS,
        publishers: PUBLISHERS,
    };

    // 編輯與檢視要保留成真正的連結（可以在新分頁開啟），不是 onClick 後才導頁。
    const hrefFor = (actionKey, item) => (
        actionKey === 'edit' || actionKey === 'view'
            ? `/admin/content/announcements/${item.id}`
            : ''
    );

    const handleAction = (actionKey, item) => {
        if (actionKey === 'reject') return openRejectModal(item, 'reject');
        if (actionKey === 'rejectRevision') return openRejectModal(item, 'pending-revision');
        const { endpointAction } = REVIEW_ACTION_META[actionKey];
        const body = endpointAction?.endsWith('approve') ? { review_comment: '' } : undefined;
        return runAction(item, endpointAction, body);
    };


    const hasNext = data.page * data.page_size < data.count;
    const rejectSubmitting = Boolean(rejectTarget) && actionId === rejectTarget.item.id;

    return (
        <main className="announcement-admin-page">
            <div className="announcement-page-heading">
                <div>
                    <h1>公告管理</h1>
                    <p>建立、審核與發布後台公告</p>
                </div>
                {CONTENT_EDITORS.includes(role) && (
                    <div className="announcement-heading-actions">
                        <Button as={Link} to="/admin/content/announcements/new">
                            <Plus size={18} /> 新增公告
                        </Button>
                        <Button variant="outline-primary" disabled={syncing || Boolean(actionId)} onClick={runSync}>
                            {syncing ? <Spinner animation="border" size="sm" /> : <RefreshCw size={18} />} 同步爬蟲活動
                        </Button>
                    </div>
                )}
            </div>

            {CONTENT_EDITORS.includes(role) && (
                <p className="announcement-sync-status">
                    上次同步：{syncStatus?.last_success_at ? formatDateTime(syncStatus.last_success_at) : '尚未同步過'}
                    {syncStatus?.last_success_at != null && ` · 新增 ${syncStatus.last_imported_count ?? 0} 筆、略過 ${syncStatus.last_skipped_count ?? 0} 筆`}
                </p>
            )}

            {(syncStatus?.consecutive_failures ?? 0) >= 3 && (
                <Alert variant="danger">
                    爬蟲同步已連續失敗 {syncStatus.consecutive_failures} 次，請確認外部來源是否正常。
                </Alert>
            )}

            {syncMessage && (
                <Alert variant="success" dismissible onClose={() => setSyncMessage('')}>
                    {syncMessage}
                </Alert>
            )}
            {error && <Alert variant="danger">{error}</Alert>}

            <Form className="announcement-filter-panel" onSubmit={search}>
                <Form.Control
                    aria-label="關鍵字搜尋"
                    placeholder="搜尋標題或內文"
                    value={filters.keyword}
                    onChange={(e) => setFilters({ ...filters, keyword: e.target.value })}
                />
                <Form.Select
                    aria-label="狀態"
                    value={filters.status}
                    onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                >
                    <option value="">全部狀態</option>
                    {Object.entries(STATUSES).map(([value, meta]) => (
                        <option key={value} value={value}>{meta.label}</option>
                    ))}
                </Form.Select>
                <Form.Select
                    aria-label="分類"
                    value={filters.category}
                    onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                >
                    <option value="">全部分類</option>
                    {Object.entries(CATEGORIES).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                    ))}
                </Form.Select>
                <Form.Select
                    aria-label="族語"
                    value={filters.tribe}
                    onChange={(e) => setFilters({ ...filters, tribe: e.target.value })}
                >
                    <option value="">全部族語</option>
                    {Object.entries(TRIBE_FULL_NAME_BY_SLUG).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                    ))}
                </Form.Select>
                <Form.Select
                    aria-label="來源"
                    value={filters.source}
                    onChange={(e) => setFilters({ ...filters, source: e.target.value })}
                >
                    <option value="">全部來源</option>
                    {Object.entries(SOURCES).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                    ))}
                </Form.Select>
                <Button type="submit">搜尋</Button>
            </Form>

            <div className="announcement-table-card">
                {loading ? (
                    <div className="announcement-loading">
                        <Spinner animation="border" />
                        <span>載入公告中…</span>
                    </div>
                ) : (
                    <Table responsive hover className="announcement-table">
                        <thead>
                            <tr>
                                <th>標題</th>
                                <th>分類</th>
                                <th>族語</th>
                                <th>狀態</th>
                                <th>置頂</th>
                                <th>建立者</th>
                                <th>最後更新</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.results.length ? data.results.map((item) => (
                                <tr key={item.id}>
                                    <td className="announcement-title-cell">
                                        {item.title}
                                        {item.source === 'crawler' && (
                                            <Badge bg="info" className="ms-2">爬蟲</Badge>
                                        )}
                                    </td>
                                    <td>{CATEGORIES[item.category] ?? item.category}</td>
                                    <td>
                                        {item.tribes?.length
                                            ? item.tribes.map((tribe) => TRIBE_FULL_NAME_BY_SLUG[tribe] ?? tribe).join('、')
                                            : '全部族語'}
                                    </td>
                                    <td>
                                        <Badge bg={STATUSES[item.status]?.bg ?? 'secondary'}>
                                            {STATUSES[item.status]?.label ?? item.status}
                                        </Badge>
                                        {item.status === 'published' && item.has_pending_revision && (
                                            <Badge bg="warning" text="dark" className="ms-2">
                                                有待審修改
                                            </Badge>
                                        )}
                                    </td>
                                    <td>
                                        {item.is_pinned ? (
                                            <>
                                                是
                                                <span className="announcement-cell-note">
                                                    至 {formatDate(item.pin_until)}
                                                </span>
                                            </>
                                        ) : '否'}
                                    </td>
                                    <td>{item.created_by || '—'}</td>
                                    <td>{formatDateTime(item.updated_at)}</td>
                                    <td>
                                        <div className="announcement-row-actions">
                                            <ReviewActions
                                                item={item}
                                                role={role}
                                                roles={ANNOUNCEMENT_ROLES}
                                                busy={actionId === item.id}
                                                disabled={syncing || (Boolean(actionId) && actionId !== item.id)}
                                                supportsUnpublishedState
                                                viewFallback
                                                hrefFor={hrefFor}
                                                onAction={handleAction}
                                            />
                                        </div>
                                    </td>
                                </tr>
                            )) : (
                                <tr>
                                    <td colSpan="8" className="announcement-empty">
                                        沒有符合條件的公告
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </Table>
                )}

                <ReviewPagination
                    data={data}
                    page={page}
                    setPage={setPage}
                    loading={loading}
                    hasNext={hasNext}
                    className="announcement-pagination"
                />
            </div>

            <Modal
                show={Boolean(rejectTarget)}
                onHide={rejectSubmitting ? undefined : closeRejectModal}
                centered
                backdrop={rejectSubmitting ? 'static' : true}
                keyboard={!rejectSubmitting}
            >
                <Modal.Header closeButton={!rejectSubmitting}>
                    <Modal.Title>
                        {rejectTarget?.type === 'pending-revision' ? '退件修改原因' : '退件原因'}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form.Group controlId="announcement-reject-reason">
                        <Form.Label>請說明需要修改的內容</Form.Label>
                        <Form.Control
                            as="textarea"
                            rows={4}
                            required
                            disabled={rejectSubmitting}
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            isInvalid={Boolean(rejectTarget) && !rejectReason.trim()}
                        />
                        <Form.Control.Feedback type="invalid">
                            退件理由為必填
                        </Form.Control.Feedback>
                    </Form.Group>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" disabled={rejectSubmitting} onClick={closeRejectModal}>
                        取消
                    </Button>
                    <Button
                        variant="danger"
                        disabled={!rejectReason.trim() || rejectSubmitting}
                        onClick={submitReject}
                    >
                        {rejectSubmitting ? '送出中…' : '確認退件'}
                    </Button>
                </Modal.Footer>
            </Modal>
        </main>
    );
}
