import { useCallback, useEffect, useState } from 'react';
import {
    Alert,
    Badge,
    Button,
    Form,
    Spinner,
    Table,
} from 'react-bootstrap';
import {
    RefreshCw,
    Search,
    Trash2,
} from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { TRIBE_NAME_BY_SLUG } from '../../constants/tribes';
import { apiDelete, apiGet } from '../../../utils/apiClient';
import '../../../static/css/_admin/moderation.css';

const STAFF_ROLES = ['owner', 'admin', 'editor', 'reviewer', 'analyst'];
const ACCOUNT_MANAGERS = ['owner', 'admin'];

const PAGE_SIZE = 20;

export default function RecordingsModeration() {
    const { userData } = useAuth();
    const role = userData?.role;
    const canRead = STAFF_ROLES.includes(role);
    const canManage = ACCOUNT_MANAGERS.includes(role);

    const [filters, setFilters] = useState({
        tribe: '',
        has_reports: false,
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
    const [actionId, setActionId] = useState(null);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const loadRecordings = useCallback(async () => {
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

            if (query.tribe) {
                params.set('tribe', query.tribe);
            }
            if (query.has_reports) {
                params.set('has_reports', 'true');
            }

            setData(
                await apiGet(
                    `/adminapi/moderation/recordings/?${params.toString()}`,
                ),
            );
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [canRead, page, query]);

    useEffect(() => {
        loadRecordings();
    }, [loadRecordings]);

    const search = (event) => {
        event.preventDefault();
        setPage(1);
        setQuery(filters);
    };

    const deleteRecording = async (item) => {
        const confirmed = window.confirm(
            `確定要永久刪除「${item.word || item.id}」的發音錄音嗎？此操作無法復原。`,
        );
        if (!confirmed) return;

        setActionId(item.id);
        setError('');
        setSuccess('');

        try {
            const result = await apiDelete(
                `/adminapi/moderation/recordings/${item.tribe}/${item.id}/`,
            );

            setSuccess(
                result.storage_deleted === false
                    ? '已刪除（音檔清除失敗，需人工複查）'
                    : '發音錄音已刪除',
            );
            await loadRecordings();
        } catch (err) {
            setError(err.message);
        } finally {
            setActionId(null);
        }
    };

    const hasNext = data.page * data.page_size < data.count;

    if (!canRead) {
        return (
            <main className="moderation-admin-page">
                <Alert variant="danger">你沒有檢視發音錄音審核頁面的權限。</Alert>
            </main>
        );
    }

    return (
        <main className="moderation-admin-page">
            <div className="moderation-page-heading">
                <div>
                    <h1>發音錄音審核</h1>
                    <p>試聽使用者上傳的錄音並處理遭檢舉的內容</p>
                </div>
                <Button
                    variant="outline-primary"
                    disabled={loading}
                    onClick={loadRecordings}
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
                <Form.Select
                    aria-label="族語"
                    value={filters.tribe}
                    onChange={(event) => setFilters({
                        ...filters,
                        tribe: event.target.value,
                    })}
                >
                    <option value="">全部族語</option>
                    {Object.entries(TRIBE_NAME_BY_SLUG).map(([value, label]) => (
                        <option key={value} value={value}>
                            {label}
                        </option>
                    ))}
                </Form.Select>

                <Form.Check
                    id="recordings-has-reports"
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
                        載入發音錄音中……
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
                                        <th>錄音</th>
                                        <th>詞彙</th>
                                        <th>族語</th>
                                        <th>分數</th>
                                        <th>檢舉數</th>
                                        <th>上傳者</th>
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.results.map((item) => (
                                        <tr key={`${item.tribe}-${item.id}`}>
                                            <td>
                                                <audio
                                                    className="moderation-audio"
                                                    controls
                                                    preload="none"
                                                    src={item.storage_url}
                                                >
                                                    你的瀏覽器不支援音訊播放。
                                                </audio>
                                            </td>
                                            <td>
                                                <strong>{item.word || '—'}</strong>
                                                <small className="moderation-cell-note">
                                                    ID：{item.id}
                                                </small>
                                            </td>
                                            <td>
                                                {TRIBE_NAME_BY_SLUG[item.tribe]
                                                    ?? item.tribe
                                                    ?? '—'}
                                            </td>
                                            <td>{item.score ?? '—'}</td>
                                            <td>
                                                {(item.report_count ?? 0) > 0 ? (
                                                    <Badge bg="danger">
                                                        {item.report_count}
                                                    </Badge>
                                                ) : (
                                                    <span>0</span>
                                                )}
                                            </td>
                                            <td className="moderation-uid-cell">
                                                {item.uid || '—'}
                                            </td>
                                            <td>
                                                <div className="moderation-row-actions">
                                                    {canManage ? (
                                                        <Button
                                                            size="sm"
                                                            variant="outline-danger"
                                                            disabled={
                                                                actionId
                                                                === item.id
                                                            }
                                                            onClick={() => (
                                                                deleteRecording(item)
                                                            )}
                                                        >
                                                            <Trash2 size={14} />
                                                            刪除
                                                        </Button>
                                                    ) : (
                                                        <span className="moderation-readonly">
                                                            僅供檢視
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}

                                    {!data.results.length && (
                                        <tr>
                                            <td
                                                className="moderation-empty"
                                                colSpan={7}
                                            >
                                                沒有符合條件的發音錄音
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
