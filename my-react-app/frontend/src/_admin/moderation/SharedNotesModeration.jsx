import { useState } from 'react';
import {
    Alert,
    Badge,
    Button,
    Form,
    Spinner,
    Table,
} from 'react-bootstrap';
import {
    Archive,
    RefreshCw,
    RotateCcw,
    Search,
} from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { apiPost } from '../../../utils/apiClient';
import { useAdminListQuery } from '../hooks/useAdminListQuery';
import '../../../static/css/_admin/moderation.css';

const STAFF_ROLES = ['owner', 'admin', 'editor', 'reviewer', 'analyst'];
const ACCOUNT_MANAGERS = ['owner', 'admin'];

const PAGE_SIZE = 20;

// preview 存的是筆記內文的原始 HTML（見 noteService.jsx 的 shareNote()），
// 跟 noteshare.jsx 關鍵字搜尋時的處理方式一致：不用 dangerouslySetInnerHTML
// 呈現（避免 XSS），但也不能把原始 HTML 標籤原封不動當純文字顯示，否則
// 審核者看到的是一堆 <span style="..."> 而不是筆記內容本身。
const stripHtml = (value) => (value || '').replace(/<[^>]+>/g, ' ').trim();

export default function SharedNotesModeration() {
    const { userData } = useAuth();
    const role = userData?.role;
    const canRead = STAFF_ROLES.includes(role);
    const canManage = ACCOUNT_MANAGERS.includes(role);

    const {
        items, data, loading, error, setError, page, setPage, hasNext,
        filters, setFilters, search, reload: loadNotes,
    } = useAdminListQuery({
        endpoint: '/adminapi/moderation/notes/',
        initialFilters: { keyword: '', deleted: '', has_reports: false },
        pageSize: PAGE_SIZE,
        enabled: canRead,
        // 這一頁的參數不是「非空就原名帶上」：keyword 要 trim、deleted 允許
        // 帶 'false' 這種字串值（不能被當成空值濾掉）、has_reports 是布林要
        // 轉成 'true'。
        buildParams: (params, query) => {
            if (query.keyword.trim()) params.set('keyword', query.keyword.trim());
            if (query.deleted !== '') params.set('deleted', query.deleted);
            if (query.has_reports) params.set('has_reports', 'true');
        },
    });

    const [actionId, setActionId] = useState(null);
    const [success, setSuccess] = useState('');


    const toggleDeleted = async (item) => {
        const actionLabel = item.deleted ? '恢復' : '下架';
        const previewText = stripHtml(item.preview) || item.id;
        const confirmation = item.deleted
            ? `確定要恢復「${previewText}」嗎？`
            : `確定要下架「${previewText}」嗎？`;

        if (!window.confirm(confirmation)) return;

        setActionId(item.id);
        setError('');
        setSuccess('');

        try {
            // 帶上「我看到的狀態」，後端不符就回 409——避免清單過期時按鈕文字
            // 說的是「下架」、伺服器卻反轉成「恢復」（見後端 note_toggle_deleted）。
            await apiPost(
                `/adminapi/moderation/notes/${item.id}/toggle-deleted/`,
                { expected_deleted: Boolean(item.deleted) },
            );
            setSuccess(`分享筆記已${actionLabel}`);
            await loadNotes();
        } catch (err) {
            setError(err.message);
        } finally {
            setActionId(null);
        }
    };


    if (!canRead) {
        return (
            <main className="moderation-admin-page">
                <Alert variant="danger">你沒有檢視分享筆記審核頁面的權限。</Alert>
            </main>
        );
    }

    return (
        <main className="moderation-admin-page">
            <div className="moderation-page-heading">
                <div>
                    <h1>分享筆記審核</h1>
                    <p>檢視使用者分享的筆記、檢舉狀況與上下架狀態</p>
                </div>
                <Button
                    variant="outline-primary"
                    disabled={loading}
                    onClick={loadNotes}
                >
                    <RefreshCw size={18} /> 重新整理
                </Button>
            </div>

            {success && (
                <Alert
                    variant="success"
                    dismissible
                    onClose={() => setSuccess('')}
                >
                    {success}
                </Alert>
            )}
            {error && <Alert variant="danger">{error}</Alert>}

            <Form className="moderation-filter-panel" onSubmit={search}>
                <Form.Control
                    aria-label="關鍵字"
                    placeholder="搜尋筆記內容或作者"
                    value={filters.keyword}
                    onChange={(event) => setFilters({
                        ...filters,
                        keyword: event.target.value,
                    })}
                />

                <Form.Select
                    aria-label="狀態"
                    value={filters.deleted}
                    onChange={(event) => setFilters({
                        ...filters,
                        deleted: event.target.value,
                    })}
                >
                    <option value="">全部狀態</option>
                    <option value="false">正常</option>
                    <option value="true">已下架</option>
                </Form.Select>

                <Form.Check
                    id="notes-has-reports"
                    className="moderation-filter-check"
                    type="checkbox"
                    label="只看有檢舉的"
                    checked={filters.has_reports}
                    onChange={(event) => setFilters({
                        ...filters,
                        has_reports: event.target.checked,
                    })}
                />

                <Button type="submit">
                    <Search size={17} /> 搜尋
                </Button>
            </Form>

            <section className="moderation-table-card">
                {loading ? (
                    <div className="moderation-loading">
                        <Spinner animation="border" size="sm" />
                        載入分享筆記中……
                    </div>
                ) : (
                    <>
                        <div className="moderation-table-scroll">
                            <Table
                                responsive
                                hover
                                className="moderation-table"
                            >
                                <thead>
                                    <tr>
                                        <th>筆記內容</th>
                                        <th>作者</th>
                                        <th>讚數</th>
                                        <th>檢舉數</th>
                                        <th>狀態</th>
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {items.map((item) => (
                                        <tr key={item.id}>
                                            <td>
                                                <div className="moderation-note-cell">
                                                    {item.image && (
                                                        <img
                                                            src={item.image}
                                                            alt=""
                                                            loading="lazy"
                                                        />
                                                    )}
                                                    <div>
                                                        <span className="moderation-preview">
                                                            {stripHtml(item.preview) || '（無文字內容）'}
                                                        </span>
                                                        <small>ID：{item.id}</small>
                                                    </div>
                                                </div>
                                            </td>
                                            <td>
                                                <span>{item.username || '—'}</span>
                                                <small className="moderation-cell-note">
                                                    {item.uid}
                                                </small>
                                            </td>
                                            <td>{item.likes ?? 0}</td>
                                            <td>
                                                {(item.report_count ?? 0) > 0 ? (
                                                    <Badge bg="danger">
                                                        {item.report_count}
                                                    </Badge>
                                                ) : (
                                                    <span>0</span>
                                                )}
                                            </td>
                                            <td>
                                                <Badge
                                                    bg={item.deleted
                                                        ? 'dark'
                                                        : 'success'}
                                                >
                                                    {item.deleted
                                                        ? '已下架'
                                                        : '正常'}
                                                </Badge>
                                            </td>
                                            <td>
                                                <div className="moderation-row-actions">
                                                    {canManage ? (
                                                        item.deleted ? (
                                                            <Button
                                                                size="sm"
                                                                variant="outline-success"
                                                                disabled={
                                                                    actionId
                                                                    === item.id
                                                                }
                                                                onClick={() => (
                                                                    toggleDeleted(item)
                                                                )}
                                                            >
                                                                <RotateCcw size={14} />
                                                                恢復
                                                            </Button>
                                                        ) : (
                                                            <Button
                                                                size="sm"
                                                                variant="outline-danger"
                                                                disabled={
                                                                    actionId
                                                                    === item.id
                                                                }
                                                                onClick={() => (
                                                                    toggleDeleted(item)
                                                                )}
                                                            >
                                                                <Archive size={14} />
                                                                下架
                                                            </Button>
                                                        )
                                                    ) : (
                                                        <span className="moderation-readonly">
                                                            僅供檢視
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}

                                    {!items.length && (
                                        <tr>
                                            <td
                                                className="moderation-empty"
                                                colSpan={6}
                                            >
                                                沒有符合條件的分享筆記
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </Table>
                        </div>

                        <div className="moderation-pagination">
                            <span>共 {data.count} 筆</span>
                            <div>
                                <Button
                                    size="sm"
                                    variant="outline-secondary"
                                    disabled={page <= 1}
                                    onClick={() => setPage((value) => value - 1)}
                                >
                                    上一頁
                                </Button>
                                <span>第 {data.page} 頁</span>
                                <Button
                                    size="sm"
                                    variant="outline-secondary"
                                    disabled={!hasNext}
                                    onClick={() => setPage((value) => value + 1)}
                                >
                                    下一頁
                                </Button>
                            </div>
                        </div>
                    </>
                )}
            </section>
        </main>
    );
}
