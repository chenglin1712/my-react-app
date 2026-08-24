import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Spinner, Table } from 'react-bootstrap';
import { Save } from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { TRIBE_FULL_NAME_BY_SLUG } from '../../constants/tribes';
import { apiGet, apiPatch } from '../../../utils/apiClient';
import { useActionLock } from '../hooks/useActionLock';
import { formatDateTime } from '../adminFormat';
import '../../../static/css/_admin/quiz-bank.css';

const CONTENT_EDITORS = ['owner', 'admin', 'editor'];

const draftFrom = (item) => ({ dialect_id: item.dialect_id, display_name: item.display_name });

export default function QuizSourceConfig() {
    const { userData } = useAuth();
    const role = userData?.role;
    const editable = CONTENT_EDITORS.includes(role);
    const [items, setItems] = useState([]);
    const [drafts, setDrafts] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    // 每一列各自的「儲存」彼此都應該互斥，共用同一把鎖——原本每列都靠同一個
    // savingTribe（單一字串）當忙碌旗標，不同列同時儲存時，先完成的那次
    // 會把後開始那次的忙碌狀態一起清掉。
    const saveLock = useActionLock();
    const savingTribe = saveLock.pendingKey;

    // 只有「目前最新的那一次查詢」可以寫回狀態，同時避免元件卸載後
    // setState——這批唯一一個原本連 active flag 都沒有的清單載入。
    const loadRequestRef = useRef(0);
    const mountedRef = useRef(true);
    useEffect(() => () => { mountedRef.current = false; }, []);

    const load = useCallback(async () => {
        const requestId = loadRequestRef.current + 1;
        loadRequestRef.current = requestId;
        const isStale = () => loadRequestRef.current !== requestId;

        setLoading(true);
        setError('');
        try {
            const { results } = await apiGet('/adminapi/quiz-bank/sources/');
            if (isStale()) return;
            setItems(results);
            setDrafts(Object.fromEntries(results.map((item) => [item.tribe, draftFrom(item)])));
        } catch (err) {
            if (isStale()) return;
            setError(err.message);
        } finally {
            if (!isStale()) setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const updateDraft = (tribe, field, value) => setDrafts((current) => ({
        ...current,
        [tribe]: { ...current[tribe], [field]: value },
    }));

    const save = (tribe) => saveLock.runLocked(tribe, async () => {
        setError('');
        setSuccess('');
        try {
            const draft = drafts[tribe];
            const saved = await apiPatch(`/adminapi/quiz-bank/sources/${tribe}/`, {
                dialect_id: Number(draft.dialect_id), display_name: draft.display_name.trim(),
            });
            if (!mountedRef.current) return;
            setItems((current) => current.map((item) => (item.tribe === tribe ? saved : item)));
            // 用伺服器回應回填草稿：後端可能會正規化 dialect_id／display_name，
            // 不這樣做的話畫面會繼續顯示送出前的字串，跟實際存的值不一致。
            setDrafts((current) => ({ ...current, [tribe]: draftFrom(saved) }));
            setSuccess(`已更新「${TRIBE_FULL_NAME_BY_SLUG[tribe] ?? tribe}」的外部題源設定`);
        } catch (err) {
            if (!mountedRef.current) return;
            setError(err.message);
        }
    });

    if (loading) return <div className="quiz-bank-loading"><Spinner animation="border" /><span>載入中…</span></div>;

    return (
        <main className="quiz-bank-admin-page">
            <div className="quiz-bank-page-heading">
                <div><h1>外部題源設定</h1><p>初級／中級測驗即時串接官方練習介面時使用的 dialect_id 與顯示名稱</p></div>
            </div>
            {!editable && <Alert variant="info">你可以檢視目前的外部題源設定；只有內容編輯以上的角色可以變更。</Alert>}
            {error && <Alert variant="danger">{error}</Alert>}
            {success && <Alert variant="success">{success}</Alert>}

            <div className="quiz-bank-table-card">
                <Table responsive hover className="quiz-bank-table quiz-bank-sources-table">
                    <thead>
                        <tr>
                            <th>族語</th>
                            <th>dialect_id</th>
                            <th>顯示名稱</th>
                            <th>最後更新</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((item) => {
                            const label = TRIBE_FULL_NAME_BY_SLUG[item.tribe] ?? item.tribe;
                            const busy = savingTribe === item.tribe;
                            const disabled = Boolean(savingTribe) && !busy;

                            return (
                                <tr key={item.tribe}>
                                    <td>{label}</td>
                                    <td>
                                        <Form.Control
                                            type="number"
                                            aria-label={`${label} dialect_id`}
                                            disabled={!editable}
                                            value={drafts[item.tribe]?.dialect_id ?? ''}
                                            onChange={(e) => updateDraft(item.tribe, 'dialect_id', e.target.value)}
                                        />
                                    </td>
                                    <td>
                                        <Form.Control
                                            aria-label={`${label} 顯示名稱`}
                                            disabled={!editable}
                                            value={drafts[item.tribe]?.display_name ?? ''}
                                            onChange={(e) => updateDraft(item.tribe, 'display_name', e.target.value)}
                                        />
                                    </td>
                                    <td>
                                        {item.updated_by
                                            ? `${item.updated_by}${item.updated_at ? `・${formatDateTime(item.updated_at)}` : ''}`
                                            : '—'}
                                    </td>
                                    <td>
                                        {editable && (
                                            <Button
                                                type="button"
                                                size="sm"
                                                disabled={busy || disabled}
                                                onClick={() => save(item.tribe)}
                                            >
                                                {busy ? <Spinner animation="border" size="sm" /> : <Save size={14} />} 儲存
                                            </Button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </Table>
            </div>
        </main>
    );
}
