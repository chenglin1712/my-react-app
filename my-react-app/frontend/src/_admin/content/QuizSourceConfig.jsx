import { useEffect, useState } from 'react';
import { Alert, Button, Form, Spinner, Table } from 'react-bootstrap';
import { Save } from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { apiGet, apiPatch } from '../../../utils/apiClient';
import '../../../static/css/_admin/quiz-bank.css';

const CONTENT_EDITORS = ['owner', 'admin', 'editor'];
const TRIBES = { tayal: '泰雅語', amis: '阿美語', bunun: '布農語', kavalan: '噶瑪蘭語', paiwan: '排灣語' };

export default function QuizSourceConfig() {
    const { userData } = useAuth();
    const role = userData?.role;
    const editable = CONTENT_EDITORS.includes(role);
    const [items, setItems] = useState([]);
    const [drafts, setDrafts] = useState({});
    const [loading, setLoading] = useState(true);
    const [savingTribe, setSavingTribe] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const load = async () => {
        setLoading(true);
        setError('');
        try {
            const { results } = await apiGet('/adminapi/quiz-bank/sources/');
            setItems(results);
            setDrafts(Object.fromEntries(results.map((item) => [item.tribe, { dialect_id: item.dialect_id, display_name: item.display_name }])));
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const updateDraft = (tribe, field, value) => setDrafts((current) => ({ ...current, [tribe]: { ...current[tribe], [field]: value } }));

    const save = async (tribe) => {
        setSavingTribe(tribe);
        setError('');
        setSuccess('');
        try {
            const draft = drafts[tribe];
            const saved = await apiPatch(`/adminapi/quiz-bank/sources/${tribe}/`, {
                dialect_id: Number(draft.dialect_id), display_name: draft.display_name.trim(),
            });
            setItems((current) => current.map((item) => (item.tribe === tribe ? saved : item)));
            setSuccess(`已更新「${TRIBES[tribe] ?? tribe}」的外部題源設定`);
        } catch (err) {
            setError(err.message);
        } finally {
            setSavingTribe('');
        }
    };

    if (loading) return <div className="quiz-bank-loading"><Spinner animation="border" /><span>載入中…</span></div>;

    return (
        <main className="quiz-bank-admin-page">
            <div className="quiz-bank-page-heading">
                <div><h1>外部題源設定</h1><p>初級／中級測驗即時串接官方練習介面時使用的 dialect_id 與顯示名稱</p></div>
            </div>
            {!editable && <Alert variant="info">你可以檢視目前的外部題源設定；只有內容編輯以上的角色可以變更。</Alert>}
            {error && <Alert variant="danger">{error}</Alert>}{success && <Alert variant="success">{success}</Alert>}

            <div className="quiz-bank-table-card">
                <Table responsive hover className="quiz-bank-table quiz-bank-sources-table">
                    <thead><tr><th>族語</th><th>dialect_id</th><th>顯示名稱</th><th>最後更新</th><th>操作</th></tr></thead>
                    <tbody>{items.map((item) => (
                        <tr key={item.tribe}>
                            <td>{TRIBES[item.tribe] ?? item.tribe}</td>
                            <td><Form.Control type="number" aria-label={`${TRIBES[item.tribe] ?? item.tribe} dialect_id`} disabled={!editable} value={drafts[item.tribe]?.dialect_id ?? ''} onChange={(e) => updateDraft(item.tribe, 'dialect_id', e.target.value)} /></td>
                            <td><Form.Control aria-label={`${TRIBES[item.tribe] ?? item.tribe} 顯示名稱`} disabled={!editable} value={drafts[item.tribe]?.display_name ?? ''} onChange={(e) => updateDraft(item.tribe, 'display_name', e.target.value)} /></td>
                            <td>{item.updated_by ? `${item.updated_by}` : '—'}</td>
                            <td>{editable && <Button size="sm" disabled={savingTribe === item.tribe} onClick={() => save(item.tribe)}>{savingTribe === item.tribe ? <Spinner animation="border" size="sm" /> : <Save size={14} />} 儲存</Button>}</td>
                        </tr>
                    ))}</tbody>
                </Table>
            </div>
        </main>
    );
}
