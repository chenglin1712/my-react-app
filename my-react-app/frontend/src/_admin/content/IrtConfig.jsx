import { useEffect, useState } from 'react';
import { Alert, Button, Form, Spinner } from 'react-bootstrap';
import { Save } from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { apiGet, apiPatch } from '../../../utils/apiClient';
import { useActionLock } from '../hooks/useActionLock';
import { formatDateTime } from '../adminFormat';
import '../../../static/css/_admin/quiz-bank.css';

const PUBLISHERS = ['owner', 'admin'];
const EMPTY_FORM = {
    total_questions: 10, alpha0: 1.0, beta0: 1.0, default_guess: 0.25, learning_rate: 0.08,
    dq_alpha: 0.45, dq_beta: 0.35, dq_gamma: 0.20,
    type_aq_word_translate: 1.2, type_aq_word_match: 1.0, type_aq_sentence_fill: 0.9, type_aq_sentence_order: 1.1,
    beta1: 0.2, beta2: 0.2, beta3: 0.2, beta4: 0.2, beta5: 0.2,
};
const FORM_FIELDS = Object.keys(EMPTY_FORM);

// 用既有值當 fallback（?? 而不是直接覆寫）：後端回應若漏帶某個欄位，
// 表單對應的欄位會被寫成 undefined，受控 input 就會失去原本的值。
const formFrom = (item, fallback = EMPTY_FORM) => Object.fromEntries(
    FORM_FIELDS.map((key) => [key, item?.[key] ?? fallback[key]]),
);

// 每個小節裡幾乎一模一樣的 <Form.Group><Form.Label/><Form.Control
// type="number"/></Form.Group> 原本重複了 16 次；真正因欄位而異的只有
// label／min／max／step，其餘結構完全相同，用資料驅動能讓小節本身跟每個
// 欄位的定義一次列在同一個地方，不用在四個小節間分別找哪個欄位屬於哪組。
const FIELD_GROUPS = [
    {
        title: '基礎參數',
        description: '測驗題數、初始能力估計與學習率。',
        fields: [
            { key: 'total_questions', label: '每次測驗題數', min: 1, max: 50, step: 1 },
            { key: 'alpha0', label: 'alpha0', step: 0.01 },
            { key: 'beta0', label: 'beta0', step: 0.01 },
            { key: 'default_guess', label: '猜測參數（0~1）', min: 0, max: 0.99, step: 0.01 },
            { key: 'learning_rate', label: '學習率', step: 0.01 },
        ],
    },
    {
        title: '難度計算權重',
        description: '詞彙錯誤率、題型錯誤率、詞彙稀有度三者在難度計算裡的權重。',
        fields: [
            { key: 'dq_alpha', label: 'dq_alpha（詞彙錯誤率）', step: 0.01 },
            { key: 'dq_beta', label: 'dq_beta（題型錯誤率）', step: 0.01 },
            { key: 'dq_gamma', label: 'dq_gamma（詞彙稀有度）', step: 0.01 },
        ],
    },
    {
        title: '題型鑑別度',
        description: '四種題型各自的鑑別度參數（a_q）。',
        fields: [
            { key: 'type_aq_word_translate', label: '詞彙翻譯題', step: 0.01 },
            { key: 'type_aq_word_match', label: '詞彙配對題', step: 0.01 },
            { key: 'type_aq_sentence_fill', label: '句子填空題', step: 0.01 },
            { key: 'type_aq_sentence_order', label: '句子排序題', step: 0.01 },
        ],
    },
    {
        title: '加分權重',
        description: 'beta1（收藏數）／beta2（探索數）目前尚未實際生效——前端還沒有回填對應的收藏／探索資料給這套模型，調整這兩個值暫時不會改變任何行為。beta3~5 分別對應近期表現、平均作答時間、詞彙稀有度加分，目前正常生效。',
        fields: [
            { key: 'beta1', label: 'beta1（收藏數，尚未生效）', step: 0.01 },
            { key: 'beta2', label: 'beta2（探索數，尚未生效）', step: 0.01 },
            { key: 'beta3', label: 'beta3（近期表現）', step: 0.01 },
            { key: 'beta4', label: 'beta4（平均作答時間）', step: 0.01 },
            { key: 'beta5', label: 'beta5（詞彙稀有度）', step: 0.01 },
        ],
    },
];

export default function IrtConfig() {
    const { userData } = useAuth();
    const role = userData?.role;
    const editable = PUBLISHERS.includes(role);
    const [form, setForm] = useState(EMPTY_FORM);
    const [metadata, setMetadata] = useState({ updated_by: '', updated_at: '' });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const saveLock = useActionLock();
    const saving = saveLock.isLocked;

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const item = await apiGet('/adminapi/irt-config/');
                if (!active) return;
                setForm(formFrom(item));
                setMetadata({ updated_by: item.updated_by ?? '', updated_at: item.updated_at ?? '' });
            } catch (err) { setError(err.message); }
            finally { if (active) setLoading(false); }
        })();
        return () => { active = false; };
    }, []);

    const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

    const save = (event) => {
        event.preventDefault();
        setError(''); setSuccess('');

        const payload = Object.fromEntries(
            Object.entries(form).map(([key, value]) => [
                key, key === 'total_questions' ? parseInt(value, 10) : Number(value),
            ]),
        );

        // 數字欄位可以被使用者清空，這時候 total_questions 會是 NaN、其餘
        // 欄位會是 0——0 是合法的權重值，但空白欄位被悄悄送成 0 不是使用者
        // 的本意，NaN 更是不該送到後端的值。送出前擋下來，比讓後端的驗證
        // 錯誤訊息告訴使用者「某個看不出是哪一個的欄位不對」更明確。
        const invalidField = Object.entries(payload).find(([, value]) => !Number.isFinite(value));
        if (invalidField) {
            setError('所有參數都必須是有效數字，請確認每個欄位都有填寫。');
            return undefined;
        }

        return saveLock.runLocked('save', async () => {
            try {
                const saved = await apiPatch('/adminapi/irt-config/', payload);
                setForm(formFrom(saved));
                setMetadata({ updated_by: saved.updated_by ?? '', updated_at: saved.updated_at ?? '' });
                setSuccess('IRT 參數已儲存');
            } catch (err) { setError(err.message); }
        });
    };

    if (loading) return <div className="quiz-bank-loading"><Spinner animation="border" /><span>載入中…</span></div>;

    return (
        <main className="quiz-bank-admin-page">
            <div className="quiz-bank-page-heading">
                <div>
                    <h1>IRT 適性測驗參數</h1>
                    <p>調整 Recommon 適性測驗（測驗學習功能）的數學模型參數</p>
                </div>
            </div>
            <Alert variant="info">
                這些是「Recommon 適性測驗」（前台測驗學習功能）背後的數學模型參數，會直接影響學生做題時系統怎麼判斷題目難度、
                怎麼調整下一題——不是一般的內容設定。除非你清楚這些參數各自的意義，否則不建議修改，改錯可能讓所有使用者的測驗
                難度判斷都跟著跑掉。
            </Alert>
            {!editable && (
                <Alert variant="warning">你可以檢視目前的 IRT 參數；只有擁有者或管理員可以變更並儲存。</Alert>
            )}
            {error && <Alert variant="danger">{error}</Alert>}
            {success && <Alert variant="success">{success}</Alert>}

            <Form className="quiz-bank-config-card" onSubmit={save}>
                {FIELD_GROUPS.map((group) => (
                    <section className="quiz-bank-config-section" key={group.title}>
                        <div className="quiz-bank-config-section-heading">
                            <h2>{group.title}</h2>
                            <p>{group.description}</p>
                        </div>
                        <div className="quiz-bank-config-grid">
                            {group.fields.map((field) => (
                                <Form.Group controlId={`irt-${field.key.replaceAll('_', '-')}`} key={field.key}>
                                    <Form.Label>{field.label}</Form.Label>
                                    <Form.Control
                                        type="number"
                                        min={field.min}
                                        max={field.max}
                                        step={field.step}
                                        disabled={!editable}
                                        value={form[field.key]}
                                        onChange={(e) => update(field.key, e.target.value)}
                                    />
                                </Form.Group>
                            ))}
                        </div>
                    </section>
                ))}

                <div className="quiz-bank-config-footer">
                    <span>
                        最後更新：{metadata.updated_by || '尚無紀錄'}
                        {metadata.updated_at ? `・${formatDateTime(metadata.updated_at)}` : ''}
                    </span>
                    {editable && (
                        <Button type="submit" disabled={saving}>
                            <Save size={17} /> {saving ? '儲存中…' : '儲存設定'}
                        </Button>
                    )}
                </div>
            </Form>
        </main>
    );
}
