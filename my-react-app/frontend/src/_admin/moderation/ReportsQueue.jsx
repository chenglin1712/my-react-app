import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    Alert,
    Badge,
    Button,
    Form,
    Modal,
    Spinner,
    Table,
} from 'react-bootstrap';
import {
    Check,
    ExternalLink,
    RefreshCw,
    Search,
    X,
} from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { apiGet, apiPost } from '../../../utils/apiClient';
import '../../../static/css/_admin/moderation.css';

const STAFF_ROLES = ['owner', 'admin', 'editor', 'reviewer', 'analyst'];
const ACCOUNT_MANAGERS = ['owner', 'admin'];

const REASONS = {
    inappropriate: '不當內容',
    wrong_content: '內容錯誤',
    spam: '垃圾內容',
    other: '其他',
};

const STATUSES = {
    pending: { label: '待處理', bg: 'warning' },
    resolved: { label: '已核結', bg: 'success' },
    dismissed: { label: '已駁回', bg: 'secondary' },
};

const TARGET_TYPES = {
    note: { label: '分享筆記', bg: 'primary' },
    recording: { label: '發音錄音', bg: 'info' },
};

const TRIBES = {
    tayal: '泰雅',
    amis: '阿美',
    bunun: '布農',
    kavalan: '噶瑪蘭',
    paiwan: '排灣',
};

const PAGE_SIZE = 20;

// preview 是筆記內文的原始 HTML（見 noteService.jsx），跟 noteshare.jsx／
// SharedNotesModeration.jsx 同一種處理方式：不用 dangerouslySetInnerHTML
// 呈現，但也要把標籤拿掉才不會顯示一堆 <span style="...">。
const stripHtml = (value) => (value || '').replace(/<[^>]+>/g, ' ').trim();

function TargetSummary({ report }) {
    const summary = report.target_summary;

    if (!summary) {
        return <span className="moderation-missing-target">內容已不存在</span>;
    }

    if (report.target_type === 'note') {
        return (
            <div className="moderation-summary">
                <span className="moderation-preview">
                    {stripHtml(summary.preview) || '（無文字內容）'}
                </span>
                <small>作者：{summary.username || '—'}</small>
            </div>
        );
    }

    return (
        <div className="moderation-summary">
            <strong>{summary.word || '—'}</strong>
            <small>
                族語：{TRIBES[summary.tribe] ?? summary.tribe ?? '—'}
                {' · '}
                分數：{summary.score ?? '—'}
            </small>
        </div>
    );
}

export default function ReportsQueue() {
    const { userData } = useAuth();
    const role = userData?.role;
    const canRead = STAFF_ROLES.includes(role);
    const canManage = ACCOUNT_MANAGERS.includes(role);

    const [filters, setFilters] = useState({
        status: 'pending',
        target_type: '',
    });
    const [query, setQuery] = useState(filters);
    const [data, setData] = useState({
        results: [],
        count: 0,
        page: 1,
        page_size: PAGE_SIZE,
    });
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(canRead);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [actionTarget, setActionTarget] = useState(null);
    const [resolutionNote, setResolutionNote] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const loadReports = useCallback(async () => {
        if (!canRead) {
            setLoading(false);
            return;
        }

        setLoading(true);
        setError('');

        try {
            const params = new URLSearchParams({
                page: String(page),
                page_size: String(PAGE_SIZE),
            });

            if (query.status) {
                params.set('status', query.status);
            }
            if (query.target_type) {
                params.set('target_type', query.target_type);
            }

            setData(
                await apiGet(`/adminapi/reports/?${params.toString()}`),
            );
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [canRead, page, query]);

    useEffect(() => {
        loadReports();
    }, [loadReports]);

    const search = (event) => {
        event.preventDefault();
        setPage(1);
        setQuery(filters);
    };

    const openActionModal = (report, action) => {
        setActionTarget({ report, action });
        setResolutionNote('');
        setError('');
    };

    const closeActionModal = () => {
        if (submitting) return;
        setActionTarget(null);
        setResolutionNote('');
    };

    const submitAction = async () => {
        if (!actionTarget) return;

        const { report, action } = actionTarget;

        setSubmitting(true);
        setError('');
        setSuccess('');

        try {
            await apiPost(
                `/adminapi/reports/${report.id}/${action}/`,
                { resolution_note: resolutionNote.trim() },
            );

            setSuccess(
                action === 'resolve'
                    ? '檢舉已核結'
                    : '檢舉已駁回',
            );
            setActionTarget(null);
            setResolutionNote('');
            await loadReports();
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    const hasNext = data.page * data.page_size < data.count;
    const modalIsResolve = actionTarget?.action === 'resolve';

    if (!canRead) {
        return (
            <main className="moderation-admin-page">
                <Alert variant="danger">你沒有檢視檢舉佇列的權限。</Alert>
            </main>
        );
    }

    return (
        <main className="moderation-admin-page">
            <div className="moderation-page-heading">
                <div>
                    <h1>檢舉佇列</h1>
                    <p>核結或駁回使用者檢舉；內容上下架需另行處理</p>
                </div>
                <Button
                    variant="outline-primary"
                    disabled={loading}
                    onClick={loadReports}
                >
                    <RefreshCw size={18} /> 重新整理
                </Button>
            </div>

            <Alert variant="info" className="moderation-info-alert">
                核結或駁回檢舉不會自動下架內容。如需下架，請前往對應的內容審核頁面操作。
            </Alert>

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
                <Form.Select
                    aria-label="狀態"
                    value={filters.status}
                    onChange={(event) => setFilters({
                        ...filters,
                        status: event.target.value,
                    })}
                >
                    <option value="">全部狀態</option>
                    {Object.entries(STATUSES).map(([value, meta]) => (
                        <option key={value} value={value}>
                            {meta.label}
                        </option>
                    ))}
                </Form.Select>

                <Form.Select
                    aria-label="內容類型"
                    value={filters.target_type}
                    onChange={(event) => setFilters({
                        ...filters,
                        target_type: event.target.value,
                    })}
                >
                    <option value="">全部內容類型</option>
                    <option value="note">分享筆記</option>
                    <option value="recording">發音錄音</option>
                </Form.Select>

                <Button type="submit">
                    <Search size={17} /> 搜尋
                </Button>
            </Form>

            <section className="moderation-table-card">
                {loading ? (
                    <div className="moderation-loading">
                        <Spinner animation="border" size="sm" />
                        載入檢舉資料中……
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
                                        <th>類型</th>
                                        <th>內容摘要</th>
                                        <th>檢舉原因</th>
                                        <th>檢舉人</th>
                                        <th>狀態</th>
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.results.map((report) => {
                                        const typeMeta = TARGET_TYPES[
                                            report.target_type
                                        ] ?? {
                                            label: report.target_type,
                                            bg: 'secondary',
                                        };
                                        const statusMeta = STATUSES[
                                            report.status
                                        ] ?? {
                                            label: report.status,
                                            bg: 'secondary',
                                        };
                                        const targetPath = (
                                            report.target_type === 'recording'
                                                ? '/admin/moderation/recordings'
                                                : '/admin/moderation/notes'
                                        );

                                        return (
                                            <tr key={report.id}>
                                                <td>
                                                    <Badge bg={typeMeta.bg}>
                                                        {typeMeta.label}
                                                    </Badge>
                                                    <small className="moderation-cell-note">
                                                        ID：{report.target_id}
                                                    </small>
                                                </td>
                                                <td>
                                                    <TargetSummary
                                                        report={report}
                                                    />
                                                </td>
                                                <td>
                                                    <strong>
                                                        {REASONS[report.reason]
                                                            ?? report.reason
                                                            ?? '—'}
                                                    </strong>
                                                    {report.reason_text && (
                                                        <span className="moderation-reason-text">
                                                            {report.reason_text}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="moderation-uid-cell">
                                                    {report.reporter_uid || '—'}
                                                </td>
                                                <td>
                                                    <Badge bg={statusMeta.bg}>
                                                        {statusMeta.label}
                                                    </Badge>
                                                    {report.resolution_note && (
                                                        <small className="moderation-cell-note">
                                                            備註：
                                                            {report.resolution_note}
                                                        </small>
                                                    )}
                                                </td>
                                                <td>
                                                    <div className="moderation-row-actions">
                                                        <Button
                                                            as={Link}
                                                            to={targetPath}
                                                            size="sm"
                                                            variant="outline-secondary"
                                                        >
                                                            <ExternalLink size={14} />
                                                            查看內容
                                                        </Button>

                                                        {canManage
                                                            && report.status
                                                            === 'pending' && (
                                                            <>
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline-success"
                                                                    onClick={() => (
                                                                        openActionModal(
                                                                            report,
                                                                            'resolve',
                                                                        )
                                                                    )}
                                                                >
                                                                    <Check size={14} />
                                                                    核結
                                                                </Button>
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline-danger"
                                                                    onClick={() => (
                                                                        openActionModal(
                                                                            report,
                                                                            'dismiss',
                                                                        )
                                                                    )}
                                                                >
                                                                    <X size={14} />
                                                                    駁回
                                                                </Button>
                                                            </>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}

                                    {!data.results.length && (
                                        <tr>
                                            <td
                                                className="moderation-empty"
                                                colSpan={6}
                                            >
                                                沒有符合條件的檢舉
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

            <Modal
                show={Boolean(actionTarget)}
                onHide={closeActionModal}
                centered
            >
                <Modal.Header closeButton={!submitting}>
                    <Modal.Title>
                        {modalIsResolve ? '核結檢舉' : '駁回檢舉'}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <p className="moderation-modal-description">
                        {modalIsResolve
                            ? '確認此檢舉已完成處理。這項操作不會自動下架被檢舉的內容。'
                            : '確認駁回此檢舉。這項操作不會變更被檢舉內容。'}
                    </p>
                    <Form.Group controlId="resolution-note">
                        <Form.Label>處理備註（選填）</Form.Label>
                        <Form.Control
                            as="textarea"
                            rows={4}
                            value={resolutionNote}
                            disabled={submitting}
                            placeholder="記錄判斷依據或後續處理事項"
                            onChange={(event) => (
                                setResolutionNote(event.target.value)
                            )}
                        />
                    </Form.Group>
                </Modal.Body>
                <Modal.Footer>
                    <Button
                        variant="outline-secondary"
                        disabled={submitting}
                        onClick={closeActionModal}
                    >
                        取消
                    </Button>
                    <Button
                        variant={modalIsResolve ? 'success' : 'danger'}
                        disabled={submitting}
                        onClick={submitAction}
                    >
                        {submitting && (
                            <Spinner
                                animation="border"
                                size="sm"
                                className="me-2"
                            />
                        )}
                        {modalIsResolve ? '確認核結' : '確認駁回'}
                    </Button>
                </Modal.Footer>
            </Modal>
        </main>
    );
}
