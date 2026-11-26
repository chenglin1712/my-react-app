import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Form,
  Spinner,
} from 'react-bootstrap';
import AdminTable from '../components/AdminTable';
import { RotateCcw, Save, Search } from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { confirmAction } from '@components/ui/ConfirmDialog';
import { apiGet, apiPatch } from '../../../utils/apiClient';
import { formatApiError } from '../apiErrors';
import EditConflictAlert from '../components/EditConflictAlert';
import { isEditConflict } from '../hooks/editConflict';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import '../../../static/css/_admin/system.css';
import { SuccessNotice } from '../components/AdminToast';

const PUBLISHERS = ['owner', 'admin'];
const STAFF_ROLES = ['owner', 'admin', 'editor', 'reviewer', 'analyst'];

// 與後端 RateLimitRuleSerializer.validate_rate 同一套規則：格式、依後端分的單位、次數至少 1。
// 前端先預檢，讓格式錯誤在輸入時就看得到，不用等按下儲存才被 400 擋回（稽核 FE7a-20）。
const DJANGO_UNITS = ['s', 'm', 'h', 'd'];
const FASTAPI_UNITS = ['second', 'minute', 'hour', 'day'];

function validateRate(value, backend) {
    const match = /^(\d+)\/(s|m|h|d|second|minute|hour|day)$/.exec((value ?? '').trim());
    if (!match) return '格式不正確，範例："30/m"（Django）或 "20/minute"（FastAPI）';
    const [, count, unit] = match;
    const units = backend === 'django' ? DJANGO_UNITS : FASTAPI_UNITS;
    if (!units.includes(unit)) {
        return `這筆規則屬於 ${backend === 'django' ? 'Django' : 'FastAPI'}，範例：${backend === 'django' ? '"30/m"' : '"20/minute"'}`;
    }
    if (Number(count) < 1) return '請求次數必須至少為 1';
    return '';
}

export default function RateLimitSettings() {
    const { userData } = useAuth();
    const role = userData?.role;
    const editable = PUBLISHERS.includes(role);
    const canView = STAFF_ROLES.includes(role);

    const [items, setItems] = useState([]);
    const [drafts, setDrafts] = useState({});
    const [backend, setBackend] = useState('all');
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [savingId, setSavingId] = useState(null);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    // 收到 409 的那一列：提示「有人剛更新過」，並提供只重新載入這一列的出路（稽核 FE7b-08）
    const [conflictItem, setConflictItem] = useState(null);
    const [reloadingConflict, setReloadingConflict] = useState(false);

    useEffect(() => {
        let active = true;

        (async () => {
            setLoading(true);
            setError('');
            setSuccess('');

            try {
                const url = backend === 'all'
                    ? '/adminapi/rate-limit-rules/'
                    : `/adminapi/rate-limit-rules/?backend=${backend}`;
                const { results } = await apiGet(url);
                if (!active) return;

                const rows = results ?? [];
                setItems(rows);
                setDrafts(Object.fromEntries(
                    rows.map((item) => [item.id, item.rate]),
                ));
            } catch (err) {
                if (active) setError(formatApiError(err));
            } finally {
                if (active) setLoading(false);
            }
        })();

        return () => {
            active = false;
        };
    }, [backend]);

    const visibleItems = useMemo(() => {
        const query = search.trim().toLocaleLowerCase();
        if (!query) return items;

        return items.filter((item) => (
            item.key.toLocaleLowerCase().includes(query)
            || (item.description ?? '').toLocaleLowerCase().includes(query)
        ));
    }, [items, search]);

    const updateDraft = (id, value) => {
        setDrafts((current) => ({ ...current, [id]: value }));
    };

    const dirtyCount = items.filter((item) => (drafts[item.id] ?? item.rate) !== item.rate).length;
    useUnsavedChangesGuard(dirtyCount > 0);

    // 切換「後端」會重新載入並覆蓋所有草稿；有沒存的修改時先確認，不要無聲丟掉（稽核 FE7a-20）
    const changeBackend = async (next) => {
        if (next === backend) return;
        if (dirtyCount > 0) {
            const confirmed = await confirmAction({
                title: '切換後端篩選',
                message: `目前有 ${dirtyCount} 筆限流值尚未儲存，切換後會被捨棄。確定要切換嗎？`,
                confirmLabel: '捨棄並切換',
            });
            if (!confirmed) return;
        }
        setBackend(next);
    };

    const reloadConflict = async () => {
        if (!conflictItem) return;
        setReloadingConflict(true);
        try {
            const latest = await apiGet(`/adminapi/rate-limit-rules/${conflictItem.id}/`);
            setItems((current) => current.map((row) => (row.id === latest.id ? latest : row)));
            setDrafts((current) => ({ ...current, [latest.id]: latest.rate }));
            setConflictItem(null);
            setError('');
        } catch (err) {
            setError(formatApiError(err));
        } finally {
            setReloadingConflict(false);
        }
    };

    const save = async (item) => {
        setError('');
        setSuccess('');
        setConflictItem(null);
        setSavingId(item.id);

        try {
            const saved = await apiPatch(
                `/adminapi/rate-limit-rules/${item.id}/`,
                // 這條規則載入（或上次儲存）時的 updated_at：兩個人同時改同一條時，後存的人會收到 409，不會無聲蓋掉
                { rate: drafts[item.id], ...(item.updated_at ? { base_updated_at: item.updated_at } : {}) },
            );
            setItems((current) => current.map((row) => (
                row.id === item.id ? saved : row
            )));
            setDrafts((current) => ({
                ...current,
                [item.id]: saved.rate,
            }));
            setSuccess(`已更新「${item.key}」的限流值`);
        } catch (err) {
            if (isEditConflict(err)) setConflictItem(item);
            else setError(formatApiError(err));
        } finally {
            setSavingId(null);
        }
    };

    if (loading) {
        return (
            <div className="admin-loading">
                <Spinner animation="border" />
                <span>載入中…</span>
            </div>
        );
    }

    return (
        <main className="admin-page system-page">
            <div className="admin-page-heading">
                <div>
                    <h1>限流設定</h1>
                    <p>調整 Django／FastAPI 各端點的請求頻率限制</p>
                </div>
            </div>

            {!canView && (
                <Alert variant="danger">你的角色沒有權限檢視限流設定。</Alert>
            )}
            {!editable && canView && (
                <Alert variant="warning">
                    你可以檢視目前的限流設定；只有擁有者或管理員可以變更。
                </Alert>
            )}
            {error && <Alert variant="danger">{error}</Alert>}
            {conflictItem && (
                <EditConflictAlert onReload={reloadConflict} busy={reloadingConflict}>
                    「{conflictItem.key}」的限流值已被其他人更新，你的修改尚未儲存。載入最新值後，請重新確認再儲存。
                </EditConflictAlert>
            )}
            <SuccessNotice message={success} />

            <div className="system-filter-panel">
                <Form.Group controlId="rate-limit-search">
                    <Form.Label>搜尋</Form.Label>
                    <div className="system-search-control">
                        <Search size={17} aria-hidden="true" />
                        <Form.Control
                            value={search}
                            placeholder="搜尋 key 或說明"
                            onChange={(event) => setSearch(event.target.value)}
                        />
                    </div>
                </Form.Group>

                <Form.Group controlId="rate-limit-backend">
                    <Form.Label>後端</Form.Label>
                    <Form.Select
                        value={backend}
                        onChange={(event) => changeBackend(event.target.value)}
                    >
                        <option value="all">全部</option>
                        <option value="django">Django</option>
                        <option value="fastapi">FastAPI</option>
                    </Form.Select>
                </Form.Group>
            </div>

            <div className="admin-table-card">
                <AdminTable label="限流設定列表" hover className="admin-table system-rate-table">
                    <thead>
                        <tr>
                            <th>key</th>
                            <th>說明</th>
                            <th>目前限流值</th>
                            <th>預設值</th>
                            <th>後端</th>
                            <th>最後更新</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {visibleItems.length > 0 ? visibleItems.map((item) => {
                            const draft = drafts[item.id] ?? '';
                            const changed = draft !== item.rate;
                            // 沒改過的列不標錯（既有資料不該一進來就紅一片）
                            const rateError = changed ? validateRate(draft, item.backend) : '';

                            return (
                                <tr key={item.id}>
                                    <td><code>{item.key}</code></td>
                                    <td>{item.description || '—'}</td>
                                    <td>
                                        <Form.Control
                                            aria-label={`${item.key} 限流值`}
                                            placeholder="30/m 或 20/minute"
                                            disabled={!editable}
                                            value={draft}
                                            isInvalid={Boolean(rateError)}
                                            aria-describedby={rateError ? `rate-error-${item.id}` : undefined}
                                            onChange={(event) => updateDraft(
                                                item.id,
                                                event.target.value,
                                            )}
                                        />
                                        {rateError && (
                                            <Form.Control.Feedback type="invalid" id={`rate-error-${item.id}`}>
                                                {rateError}
                                            </Form.Control.Feedback>
                                        )}
                                    </td>
                                    <td>{item.default_rate}</td>
                                    <td>
                                        <Badge bg={item.backend === 'django' ? 'primary' : 'success'}>
                                            {item.backend === 'django' ? 'Django' : 'FastAPI'}
                                        </Badge>
                                    </td>
                                    <td>{item.updated_by || '—'}</td>
                                    <td>
                                        {editable && (
                                            <div className="admin-row-actions">
                                                <Button
                                                    size="sm"
                                                    disabled={!changed || Boolean(rateError) || savingId === item.id}
                                                    onClick={() => save(item)}
                                                >
                                                    {savingId === item.id
                                                        ? (
                                                            <Spinner
                                                                animation="border"
                                                                size="sm"
                                                            />
                                                        )
                                                        : <Save size={14} />}
                                                    儲存
                                                </Button>
                                                {item.rate !== item.default_rate && (
                                                    <Button
                                                        size="sm"
                                                        variant="outline-secondary"
                                                        disabled={savingId === item.id}
                                                        onClick={() => updateDraft(
                                                            item.id,
                                                            item.default_rate,
                                                        )}
                                                    >
                                                        <RotateCcw size={14} />
                                                        重設為預設值
                                                    </Button>
                                                )}
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            );
                        }) : (
                            <tr>
                                <td colSpan="7" className="admin-empty">
                                    沒有符合條件的限流規則
                                </td>
                            </tr>
                        )}
                    </tbody>
                </AdminTable>
            </div>
        </main>
    );
}
