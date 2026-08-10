import { useEffect, useMemo, useState } from 'react';
import {
    Alert, Badge, Button, Form, Spinner, Table,
} from 'react-bootstrap';
import { RotateCcw, Save, Search } from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { apiGet, apiPatch } from '../../../utils/apiClient';
import '../../../static/css/_admin/quiz-bank.css';
import '../../../static/css/_admin/system.css';

const PUBLISHERS = ['owner', 'admin'];
const STAFF_ROLES = ['owner', 'admin', 'editor', 'reviewer', 'analyst'];

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
                if (active) setError(err.message);
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

    const save = async (item) => {
        setError('');
        setSuccess('');
        setSavingId(item.id);

        try {
            const saved = await apiPatch(
                `/adminapi/rate-limit-rules/${item.id}/`,
                { rate: drafts[item.id] },
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
            setError(err.message);
        } finally {
            setSavingId(null);
        }
    };

    if (loading) {
        return (
            <div className="quiz-bank-loading">
                <Spinner animation="border" />
                <span>載入中…</span>
            </div>
        );
    }

    return (
        <main className="quiz-bank-admin-page">
            <div className="quiz-bank-page-heading">
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
            {success && <Alert variant="success">{success}</Alert>}

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
                        onChange={(event) => setBackend(event.target.value)}
                    >
                        <option value="all">全部</option>
                        <option value="django">Django</option>
                        <option value="fastapi">FastAPI</option>
                    </Form.Select>
                </Form.Group>
            </div>

            <div className="quiz-bank-table-card">
                <Table responsive hover className="quiz-bank-table system-rate-table">
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
                                            onChange={(event) => updateDraft(
                                                item.id,
                                                event.target.value,
                                            )}
                                        />
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
                                            <div className="quiz-bank-row-actions">
                                                <Button
                                                    size="sm"
                                                    disabled={!changed || savingId === item.id}
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
                                <td colSpan="7" className="quiz-bank-empty">
                                    沒有符合條件的限流規則
                                </td>
                            </tr>
                        )}
                    </tbody>
                </Table>
            </div>
        </main>
    );
}
