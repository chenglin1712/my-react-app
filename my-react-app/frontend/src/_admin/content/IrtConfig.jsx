import { useEffect, useState } from 'react';
import { Alert, Button, Form, Spinner } from 'react-bootstrap';
import { Save } from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { apiGet, apiPatch } from '../../../utils/apiClient';
import '../../../static/css/_admin/quiz-bank.css';

const PUBLISHERS = ['owner', 'admin'];
const EMPTY_FORM = {
    total_questions: 10, alpha0: 1.0, beta0: 1.0, default_guess: 0.25, learning_rate: 0.08,
    dq_alpha: 0.45, dq_beta: 0.35, dq_gamma: 0.20,
    type_aq_word_translate: 1.2, type_aq_word_match: 1.0, type_aq_sentence_fill: 0.9, type_aq_sentence_order: 1.1,
    beta1: 0.2, beta2: 0.2, beta3: 0.2, beta4: 0.2, beta5: 0.2,
};

const formatDateTime = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? '—'
        : new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

export default function IrtConfig() {
    const { userData } = useAuth();
    const role = userData?.role;
    const editable = PUBLISHERS.includes(role);
    const [form, setForm] = useState(EMPTY_FORM);
    const [metadata, setMetadata] = useState({ updated_by: '', updated_at: '' });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const item = await apiGet('/adminapi/irt-config/');
                if (!active) return;
                setForm(Object.fromEntries(Object.keys(EMPTY_FORM).map((key) => [key, item[key]])));
                setMetadata({ updated_by: item.updated_by ?? '', updated_at: item.updated_at ?? '' });
            } catch (err) { setError(err.message); }
            finally { if (active) setLoading(false); }
        })();
        return () => { active = false; };
    }, []);

    const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

    const save = async (event) => {
        event.preventDefault();
        setError(''); setSuccess('');
        setSaving(true);
        try {
            const payload = Object.fromEntries(
                Object.entries(form).map(([key, value]) => [key, key === 'total_questions' ? parseInt(value, 10) : Number(value)]),
            );
            const saved = await apiPatch('/adminapi/irt-config/', payload);
            setForm(Object.fromEntries(Object.keys(EMPTY_FORM).map((key) => [key, saved[key]])));
            setMetadata({ updated_by: saved.updated_by ?? '', updated_at: saved.updated_at ?? '' });
            setSuccess('IRT 參數已儲存');
        } catch (err) { setError(err.message); }
        finally { setSaving(false); }
    };

    if (loading) return <div className="quiz-bank-loading"><Spinner animation="border" /><span>載入中…</span></div>;

    return (
        <main className="quiz-bank-admin-page">
            <div className="quiz-bank-page-heading"><div><h1>IRT 適性測驗參數</h1><p>調整 Recommon 適性測驗（測驗學習功能）的數學模型參數</p></div></div>
            <Alert variant="info">
                這些是「Recommon 適性測驗」（前台測驗學習功能）背後的數學模型參數，會直接影響學生做題時系統怎麼判斷題目難度、
                怎麼調整下一題——不是一般的內容設定。除非你清楚這些參數各自的意義，否則不建議修改，改錯可能讓所有使用者的測驗
                難度判斷都跟著跑掉。
            </Alert>
            {!editable && <Alert variant="warning">你可以檢視目前的 IRT 參數；只有擁有者或管理員可以變更並儲存。</Alert>}
            {error && <Alert variant="danger">{error}</Alert>}{success && <Alert variant="success">{success}</Alert>}

            <Form className="quiz-bank-config-card" onSubmit={save}>
                <section className="quiz-bank-config-section">
                    <div className="quiz-bank-config-section-heading"><h2>基礎參數</h2><p>測驗題數、初始能力估計與學習率。</p></div>
                    <div className="quiz-bank-config-grid">
                        <Form.Group controlId="irt-total-questions"><Form.Label>每次測驗題數</Form.Label><Form.Control type="number" min="1" max="50" step="1" disabled={!editable} value={form.total_questions} onChange={(e) => update('total_questions', e.target.value)} /></Form.Group>
                        <Form.Group controlId="irt-alpha0"><Form.Label>alpha0</Form.Label><Form.Control type="number" step="0.01" disabled={!editable} value={form.alpha0} onChange={(e) => update('alpha0', e.target.value)} /></Form.Group>
                        <Form.Group controlId="irt-beta0"><Form.Label>beta0</Form.Label><Form.Control type="number" step="0.01" disabled={!editable} value={form.beta0} onChange={(e) => update('beta0', e.target.value)} /></Form.Group>
                        <Form.Group controlId="irt-default-guess"><Form.Label>猜測參數（0~1）</Form.Label><Form.Control type="number" min="0" max="0.99" step="0.01" disabled={!editable} value={form.default_guess} onChange={(e) => update('default_guess', e.target.value)} /></Form.Group>
                        <Form.Group controlId="irt-learning-rate"><Form.Label>學習率</Form.Label><Form.Control type="number" step="0.01" disabled={!editable} value={form.learning_rate} onChange={(e) => update('learning_rate', e.target.value)} /></Form.Group>
                    </div>
                </section>

                <section className="quiz-bank-config-section">
                    <div className="quiz-bank-config-section-heading"><h2>難度計算權重</h2><p>詞彙錯誤率、題型錯誤率、詞彙稀有度三者在難度計算裡的權重。</p></div>
                    <div className="quiz-bank-config-grid">
                        <Form.Group controlId="irt-dq-alpha"><Form.Label>dq_alpha（詞彙錯誤率）</Form.Label><Form.Control type="number" step="0.01" disabled={!editable} value={form.dq_alpha} onChange={(e) => update('dq_alpha', e.target.value)} /></Form.Group>
                        <Form.Group controlId="irt-dq-beta"><Form.Label>dq_beta（題型錯誤率）</Form.Label><Form.Control type="number" step="0.01" disabled={!editable} value={form.dq_beta} onChange={(e) => update('dq_beta', e.target.value)} /></Form.Group>
                        <Form.Group controlId="irt-dq-gamma"><Form.Label>dq_gamma（詞彙稀有度）</Form.Label><Form.Control type="number" step="0.01" disabled={!editable} value={form.dq_gamma} onChange={(e) => update('dq_gamma', e.target.value)} /></Form.Group>
                    </div>
                </section>

                <section className="quiz-bank-config-section">
                    <div className="quiz-bank-config-section-heading"><h2>題型鑑別度</h2><p>四種題型各自的鑑別度參數（a_q）。</p></div>
                    <div className="quiz-bank-config-grid">
                        <Form.Group controlId="irt-type-aq-word-translate"><Form.Label>詞彙翻譯題</Form.Label><Form.Control type="number" step="0.01" disabled={!editable} value={form.type_aq_word_translate} onChange={(e) => update('type_aq_word_translate', e.target.value)} /></Form.Group>
                        <Form.Group controlId="irt-type-aq-word-match"><Form.Label>詞彙配對題</Form.Label><Form.Control type="number" step="0.01" disabled={!editable} value={form.type_aq_word_match} onChange={(e) => update('type_aq_word_match', e.target.value)} /></Form.Group>
                        <Form.Group controlId="irt-type-aq-sentence-fill"><Form.Label>句子填空題</Form.Label><Form.Control type="number" step="0.01" disabled={!editable} value={form.type_aq_sentence_fill} onChange={(e) => update('type_aq_sentence_fill', e.target.value)} /></Form.Group>
                        <Form.Group controlId="irt-type-aq-sentence-order"><Form.Label>句子排序題</Form.Label><Form.Control type="number" step="0.01" disabled={!editable} value={form.type_aq_sentence_order} onChange={(e) => update('type_aq_sentence_order', e.target.value)} /></Form.Group>
                    </div>
                </section>

                <section className="quiz-bank-config-section">
                    <div className="quiz-bank-config-section-heading">
                        <h2>加分權重</h2>
                        <p>beta1（收藏數）／beta2（探索數）目前尚未實際生效——前端還沒有回填對應的收藏／探索資料給這套模型，調整這兩個值暫時不會改變任何行為。beta3~5 分別對應近期表現、平均作答時間、詞彙稀有度加分，目前正常生效。</p>
                    </div>
                    <div className="quiz-bank-config-grid">
                        <Form.Group controlId="irt-beta1"><Form.Label>beta1（收藏數，尚未生效）</Form.Label><Form.Control type="number" step="0.01" disabled={!editable} value={form.beta1} onChange={(e) => update('beta1', e.target.value)} /></Form.Group>
                        <Form.Group controlId="irt-beta2"><Form.Label>beta2（探索數，尚未生效）</Form.Label><Form.Control type="number" step="0.01" disabled={!editable} value={form.beta2} onChange={(e) => update('beta2', e.target.value)} /></Form.Group>
                        <Form.Group controlId="irt-beta3"><Form.Label>beta3（近期表現）</Form.Label><Form.Control type="number" step="0.01" disabled={!editable} value={form.beta3} onChange={(e) => update('beta3', e.target.value)} /></Form.Group>
                        <Form.Group controlId="irt-beta4"><Form.Label>beta4（平均作答時間）</Form.Label><Form.Control type="number" step="0.01" disabled={!editable} value={form.beta4} onChange={(e) => update('beta4', e.target.value)} /></Form.Group>
                        <Form.Group controlId="irt-beta5"><Form.Label>beta5（詞彙稀有度）</Form.Label><Form.Control type="number" step="0.01" disabled={!editable} value={form.beta5} onChange={(e) => update('beta5', e.target.value)} /></Form.Group>
                    </div>
                </section>

                <div className="quiz-bank-config-footer"><span>最後更新：{metadata.updated_by || '尚無紀錄'}{metadata.updated_at ? `・${formatDateTime(metadata.updated_at)}` : ''}</span>{editable && <Button type="submit" disabled={saving}><Save size={17} /> {saving ? '儲存中…' : '儲存設定'}</Button>}</div>
            </Form>
        </main>
    );
}
