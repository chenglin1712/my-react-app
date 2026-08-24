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
    RefreshCw,
    Search,
    Trash2,
} from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { TRIBE_NAME_BY_SLUG } from '../../constants/tribes';
import { apiDelete } from '../../../utils/apiClient';
import { useAdminListQuery } from '../hooks/useAdminListQuery';
import { useActionLock } from '../hooks/useActionLock';
import { ACCOUNT_MANAGERS, STAFF_ROLES } from '../constants/roles';
import ReviewPagination from '../reviewWorkflow/ReviewPagination';
import '../../../static/css/_admin/moderation.css';

const PAGE_SIZE = 20;

// tribe:id 是這個清單真正的 identity——不同族語的錄音可能剛好有相同 id
// （table key 也是用這個組合，見下方 items.map），只用 id 當忙碌狀態的
// key 會誤判到另一個族語的同 id 錄音。
const recordingKey = (item) => `${item.tribe}:${item.id}`;

export default function RecordingsModeration() {
    const { userData } = useAuth();
    const role = userData?.role;
    const canRead = STAFF_ROLES.includes(role);
    const canManage = ACCOUNT_MANAGERS.includes(role);

    const {
        items, data, loading, error, setError, page, setPage, hasNext,
        filters, setFilters, search, reload: loadRecordings,
    } = useAdminListQuery({
        endpoint: '/adminapi/moderation/recordings/',
        initialFilters: { tribe: '', has_reports: false },
        pageSize: PAGE_SIZE,
        enabled: canRead,
        // has_reports 是布林，要轉成字串 'true' 才送出。
        buildParams: (params, query) => {
            if (query.tribe) params.set('tribe', query.tribe);
            if (query.has_reports) params.set('has_reports', 'true');
        },
    });

    const [success, setSuccess] = useState('');
    const deleteLock = useActionLock();

    const deleteRecording = (item) => {
        const confirmed = window.confirm(
            `確定要永久刪除「${item.word || item.id}」的發音錄音嗎？此操作無法復原。`,
        );
        if (!confirmed) return;

        deleteLock.runLocked(recordingKey(item), async () => {
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
            }
        });
    };


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
                                    {items.map((item) => {
                                        const key = recordingKey(item);
                                        const busy = deleteLock.pendingKey === key;
                                        const disabled = deleteLock.isLocked && !busy;

                                        return (
                                            <tr key={key}>
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
                                                                disabled={busy || disabled}
                                                                onClick={() => (
                                                                    deleteRecording(item)
                                                                )}
                                                            >
                                                                {busy ? (
                                                                    <Spinner animation="border" size="sm" />
                                                                ) : (
                                                                    <Trash2 size={14} />
                                                                )}
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
                                        );
                                    })}

                                    {!items.length && (
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

                        <ReviewPagination
                            data={data}
                            page={page}
                            setPage={setPage}
                            loading={loading}
                            hasNext={hasNext}
                            className="moderation-pagination"
                        />
                    </>
                )}
            </section>
        </main>
    );
}
