import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Form, Spinner } from 'react-bootstrap';
import AdminTable from '../components/AdminTable';
import { useAuth } from '../../userServives/authContext';
import { apiGet, apiPost } from '../../../utils/apiClient';
import '../../../static/css/_admin/system.css';
import '../../../static/css/_admin/ai-usage.css';
import '../../../static/css/_admin/ai-assistant-settings.css';

// 設定與審核事件都只開放 owner／admin（後端同步檢查）；前端先擋，省得其他角色看到必定 403 的頁面。
const VIEWER_ROLES = ['owner', 'admin'];

const POLICY_OPTIONS = [
    { value: 'strict', label: '嚴格', hint: '離題問題一律回固定說明，不呼叫模型。' },
    { value: 'gentle', label: '寬鬆', hint: '離題問題由輕量模型簡短回應，再邀請學生回到族語學習（可以聊聊天）。' },
];

const INTENT_LABELS = { off_topic: '離題', unsafe: '不當內容', model_refusal: '模型拒答' };
const ACTION_LABELS = { fixed: '固定說明', gentle: '友善引導', refused: '模型拒答' };

const formatTime = (iso) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '時間不明';
    return date.toLocaleString('zh-TW', { hour12: false, timeZone: 'Asia/Taipei' });
};

const sameContent = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function Field({ id, label, hint, count, limit, children }) {
    return (
        <div className="ai-assistant-field">
            <Form.Label htmlFor={id}>{label}</Form.Label>
            {children}
            <div className="ai-assistant-field-meta">
                <span id={`${id}-hint`}>{hint}</span>
                {limit ? <span aria-label={`已輸入 ${count} 字，上限 ${limit} 字`}>{count}/{limit}</span> : null}
            </div>
        </div>
    );
}

function VersionList({ versions, busy, onRollback }) {
    const [confirmId, setConfirmId] = useState(null);
    const confirmRef = useRef(null);
    const triggerRefs = useRef({});
    const returnFocusTo = useRef(null);

    // 確認區取代了觸發按鈕：開啟時把焦點移到確認鈕，取消時還給原本的回滾鈕
    useEffect(() => {
        if (confirmId !== null) confirmRef.current?.focus();
        else if (returnFocusTo.current !== null) {
            triggerRefs.current[returnFocusTo.current]?.focus();
            returnFocusTo.current = null;
        }
    }, [confirmId]);

    const cancelConfirm = (id) => { returnFocusTo.current = id; setConfirmId(null); };

    return (
        <section className="ai-assistant-section" aria-labelledby="ai-assistant-versions">
            <h2 id="ai-assistant-versions">版本紀錄</h2>
            <p className="ai-assistant-lede">每次儲存都會新增一個版本，舊版本不會被改動。回滾會把舊版本的內容再存成新版本，立即生效。</p>
            {versions.length === 0 ? (
                <p className="admin-empty">還沒有儲存過任何版本，目前使用程式內建的預設值。</p>
            ) : (
                <AdminTable label="設定版本紀錄" className="admin-table">
                    <thead>
                        <tr><th scope="col">版本</th><th scope="col">時間</th><th scope="col">備註</th><th scope="col">操作</th></tr>
                    </thead>
                    <tbody>
                        {versions.map((v) => (
                            <tr key={v.id}>
                                <th scope="row">v{v.id}{v.active ? <span className="ai-assistant-badge">使用中</span> : null}</th>
                                <td className="ai-usage-nowrap">{formatTime(v.createdAt)}</td>
                                <td>{v.note || (v.source.startsWith('rollback') ? '回滾' : '')}</td>
                                <td>
                                    {v.active ? <span className="ai-assistant-muted">目前版本</span> : confirmId === v.id ? (
                                        <span className="ai-assistant-confirm" role="group" aria-label={`確認回滾到 v${v.id}`}>
                                            <Button ref={confirmRef} size="sm" variant="primary" disabled={busy} onClick={() => { returnFocusTo.current = v.id; setConfirmId(null); onRollback(v); }}>
                                                確定回滾到 v{v.id}
                                            </Button>
                                            <Button size="sm" variant="outline-secondary" onClick={() => cancelConfirm(v.id)}>取消</Button>
                                        </span>
                                    ) : (
                                        <Button ref={(el) => { triggerRefs.current[v.id] = el; }} size="sm" variant="outline-secondary" disabled={busy} onClick={() => setConfirmId(v.id)}>
                                            回滾到這版
                                        </Button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </AdminTable>
            )}
        </section>
    );
}

function ModerationSection() {
    const [data, setData] = useState(null);
    const [intent, setIntent] = useState('');
    const [page, setPage] = useState(1);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError('');
        const params = new URLSearchParams({ page: String(page) });
        if (intent) params.set('intent', intent);
        (async () => {
            try {
                const result = await apiGet(`/adminapi/ai-assistant/moderation/?${params}`);
                if (active) setData(result);
            } catch (err) {
                if (active) { setData(null); setError(err.message); }
            } finally {
                if (active) setLoading(false);
            }
        })();
        return () => { active = false; };
    }, [intent, page]);

    const summary = data?.summary;
    return (
        <section className="ai-assistant-section" aria-labelledby="ai-assistant-moderation">
            <h2 id="ai-assistant-moderation">內容審核事件</h2>
            <p className="ai-assistant-lede">
                被攔下或被引導的訊息。安全類不保存訊息文字；其他類型只存開頭 40 字的摘錄（網址、電子郵件、電話、帳號、姓名、學校與地址已遮掉）與單向雜湊的使用者代號，保存 30 天。為了保護隱私寧可多遮，摘錄裡的地名與學校名可能被遮掉。
                若發現正常的學習問題被誤攔，請調整上面的離題處理，或把案例補進評測題組。
            </p>
            {error && <Alert variant="danger">{error}</Alert>}
            {summary && (
                <p className="ai-assistant-muted" aria-live="polite">
                    共 {summary.total} 筆：{Object.entries(INTENT_LABELS).map(([key, label]) => `${label} ${summary.byIntent[key] ?? 0}`).join('、')}
                </p>
            )}
            <div className="ai-assistant-filter">
                <Form.Label htmlFor="ai-moderation-intent">類型</Form.Label>
                <Form.Select id="ai-moderation-intent" value={intent} onChange={(e) => { setIntent(e.target.value); setPage(1); }}>
                    <option value="">全部</option>
                    {Object.entries(INTENT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </Form.Select>
            </div>
            {loading && !data ? (
                <div className="admin-loading"><Spinner animation="border" size="sm" /><span>載入中…</span></div>
            ) : data && (
                <>
                    <AdminTable label="內容審核事件" hover className="admin-table" >
                        <thead>
                            <tr><th scope="col">時間</th><th scope="col">類型</th><th scope="col">處理</th><th scope="col">訊息摘錄</th><th scope="col">使用者</th></tr>
                        </thead>
                        <tbody>
                            {data.items.map((row) => (
                                <tr key={row.id}>
                                    <td className="ai-usage-nowrap">{formatTime(row.createdAt)}</td>
                                    <td>{INTENT_LABELS[row.intent] ?? row.intent}</td>
                                    <td>{ACTION_LABELS[row.action] ?? row.action}</td>
                                    <td className="ai-assistant-excerpt">{row.intent === 'unsafe' ? '（安全類不保存原文）' : (row.excerpt || '（空白）')}</td>
                                    <td className="ai-assistant-muted">{row.user}</td>
                                </tr>
                            ))}
                            {data.items.length === 0 && <tr><td colSpan={5} className="admin-empty">沒有符合條件的事件</td></tr>}
                        </tbody>
                    </AdminTable>
                    {data.pages > 1 && (
                        <nav className="ai-feedback-pager" aria-label="審核事件分頁">
                            <Button size="sm" variant="outline-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一頁</Button>
                            <span>第 {data.page} / {data.pages} 頁</span>
                            <Button size="sm" variant="outline-secondary" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>下一頁</Button>
                        </nav>
                    )}
                </>
            )}
        </section>
    );
}

export default function AiAssistantSettings() {
    const { userData, loading: authLoading } = useAuth();
    const canView = VIEWER_ROLES.includes(userData?.role);
    const [overview, setOverview] = useState(null);
    const [draft, setDraft] = useState(null);
    const [note, setNote] = useState('');
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [trialText, setTrialText] = useState('');
    const [trial, setTrial] = useState(null);
    const [reloadKey, setReloadKey] = useState(0);
    const trialGeneration = useRef(0);

    const adopt = useCallback((next) => {
        setOverview(next);
        setDraft(next.active);
        setNote('');
    }, []);

    useEffect(() => {
        if (!canView) {
            setOverview(null);
            setLoading(false);
            return undefined;
        }
        let active = true;
        setLoading(true);
        setError('');
        (async () => {
            try {
                const result = await apiGet('/adminapi/ai-assistant/settings/');
                if (active) adopt(result);
            } catch (err) {
                if (active) setError(err.message);
            } finally {
                if (active) setLoading(false);
            }
        })();
        return () => { active = false; };
    }, [canView, adopt, reloadKey]);

    const dirty = useMemo(() => overview && draft && !sameContent(overview.active, draft), [overview, draft]);
    const patch = (change) => {
        setDraft((prev) => ({ ...prev, ...change }));
        setNotice('');
        setTrial(null);
        trialGeneration.current += 1;          // 草稿變了：進行中的試跑結果已經過期
    };
    const setSuggestion = (index, value) => patch({ suggestions: draft.suggestions.map((s, i) => (i === index ? value : s)) });

    const save = async () => {
        setBusy(true);
        setError('');
        setNotice('');
        try {
            const next = await apiPost('/adminapi/ai-assistant/settings/', { content: draft, note });
            adopt(next);
            setTrial(null);
            setNotice(`已儲存為 v${next.activeVersion} 並生效。多台伺服器最久 30 秒後都會套用。`);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const rollback = async (version) => {
        setBusy(true);
        setError('');
        setNotice('');
        try {
            const next = await apiPost(`/adminapi/ai-assistant/settings/${version.id}/rollback/`, {});
            adopt(next);
            setTrial(null);
            setNotice(`已回滾到 v${version.id} 的內容，新版本為 v${next.activeVersion}，已生效。`);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const runTrial = async () => {
        const messages = trialText.split('\n').map((line) => line.trim()).filter(Boolean);
        const generation = ++trialGeneration.current;
        setBusy(true);
        setError('');
        setTrial(null);
        try {
            const result = await apiPost('/adminapi/ai-assistant/settings/trial/', { content: draft, messages });
            if (generation === trialGeneration.current) setTrial(result);
        } catch (err) {
            if (generation === trialGeneration.current) setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const limits = overview?.limits;
    const trialLines = trialText.split('\n').map((line) => line.trim()).filter(Boolean).length;

    return (
        <main className="admin-page system-page ai-assistant-page">
            <div className="admin-page-heading">
                <div>
                    <h1>AI 助手設定</h1>
                    <p>調整離題處理、開場白、建議問題與語氣補充。每次儲存都留版本，可以隨時回滾。</p>
                </div>
            </div>

            {!canView && !authLoading && <Alert variant="danger">只有擁有者與管理員可以調整 AI 助手設定。</Alert>}
            {canView && error && <Alert variant="danger" role="alert">{error}</Alert>}
            {canView && notice && <Alert variant="success" role="status">{notice}</Alert>}

            {canView && error && !overview && !loading && (
                <Button variant="outline-primary" onClick={() => setReloadKey((k) => k + 1)}>重新載入</Button>
            )}

            {canView && loading && !overview && (
                <div className="admin-loading"><Spinner animation="border" /><span>載入中…</span></div>
            )}

            {canView && overview && draft && (
                <div className="ai-usage-content" aria-busy={busy}>
                    <section className="ai-usage-summary" aria-label="目前生效的設定">
                        <dl>
                            <div><dt>使用中版本</dt><dd>{overview.activeVersion > 0 ? `v${overview.activeVersion}` : '預設值'}</dd></div>
                            <div><dt>提示詞版本</dt><dd>{overview.promptVersion}</dd></div>
                        </dl>
                        <p className="ai-assistant-muted">提示詞版本會記在每筆 AI 用量與學生回饋上，用來對回「哪一版設定造成的」。</p>
                    </section>

                    <section className="ai-assistant-section" aria-labelledby="ai-assistant-edit">
                        <h2 id="ai-assistant-edit">編輯設定</h2>
                        <Form onSubmit={(event) => { event.preventDefault(); if (dirty && !busy) save(); }} noValidate>
                            <fieldset className="ai-assistant-form" disabled={busy}>
                            <fieldset className="ai-assistant-field">
                                <legend>離題處理</legend>
                                {POLICY_OPTIONS.map((option) => (
                                    <Form.Check
                                        key={option.value}
                                        type="radio"
                                        id={`ai-policy-${option.value}`}
                                        name="offtopic_policy"
                                        label={`${option.label}：${option.hint}`}
                                        checked={draft.offtopic_policy === option.value}
                                        onChange={() => patch({ offtopic_policy: option.value })}
                                    />
                                ))}
                                <div className="ai-assistant-field-meta">
                                    <span>不當內容一律攔下，不受這個選項影響。需要先在伺服器開啟意圖路由（AI_INTENT_ROUTING）才會分辨離題。</span>
                                </div>
                            </fieldset>

                            <Field id="ai-off-topic" label="離題固定說明" hint="嚴格模式下，離題問題會看到這段文字。" count={draft.off_topic_message.length} limit={limits.offTopicMessage}>
                                <Form.Control id="ai-off-topic" as="textarea" rows={2} maxLength={limits.offTopicMessage} aria-describedby="ai-off-topic-hint"
                                    value={draft.off_topic_message} onChange={(e) => patch({ off_topic_message: e.target.value })} />
                            </Field>

                            <Field id="ai-greeting" label="開場白" hint="用 {tribe} 代表族語名稱，例如「泰雅語」。已經開始的對話不會被換掉。" count={draft.greeting.length} limit={limits.greeting}>
                                <Form.Control id="ai-greeting" maxLength={limits.greeting} aria-describedby="ai-greeting-hint"
                                    value={draft.greeting} onChange={(e) => patch({ greeting: e.target.value })} />
                            </Field>

                            <fieldset className="ai-assistant-field">
                                <legend>建議問題（三句）</legend>
                                {draft.suggestions.map((text, index) => (
                                    <div key={index} className="ai-assistant-suggestion">
                                        <Form.Label htmlFor={`ai-suggestion-${index}`} className="visually-hidden">建議問題 {index + 1}</Form.Label>
                                        <Form.Control id={`ai-suggestion-${index}`} maxLength={limits.suggestion} value={text}
                                            onChange={(e) => setSuggestion(index, e.target.value)} />
                                        <span className="ai-assistant-count" aria-hidden="true">{text.length}/{limits.suggestion}</span>
                                    </div>
                                ))}
                                <div className="ai-assistant-field-meta">
                                    <span>學生有常錯的詞時，第一句會換成針對該詞的複習建議。</span>
                                </div>
                            </fieldset>

                            <Field id="ai-chat-extra" label="語氣與說明方式補充（選填）" hint="只調整語氣，例如「多舉生活例子」。不能改變安全或辭典規則；含「忽略、解除、不要拒絕」這類措辭會被擋下。" count={draft.chat_extra.length} limit={limits.chatExtra}>
                                <Form.Control id="ai-chat-extra" as="textarea" rows={4} maxLength={limits.chatExtra} aria-describedby="ai-chat-extra-hint"
                                    value={draft.chat_extra} onChange={(e) => patch({ chat_extra: e.target.value })} />
                            </Field>

                            <Field id="ai-note" label="這次修改的備註（選填）" hint="寫給之後回滾時辨認用。" count={note.length} limit={limits.note}>
                                <Form.Control id="ai-note" maxLength={limits.note} aria-describedby="ai-note-hint" value={note} onChange={(e) => setNote(e.target.value)} />
                            </Field>

                            <div className="ai-assistant-actions">
                                <Button type="submit" disabled={!dirty || busy}>{busy ? '處理中…' : '儲存為新版本'}</Button>
                                <Button type="button" variant="outline-secondary" disabled={!dirty || busy}
                                    onClick={() => { setDraft(overview.active); setNotice(''); setTrial(null); trialGeneration.current += 1; }}>
                                    放棄修改
                                </Button>
                                {!dirty && <span className="ai-assistant-muted">沒有未儲存的修改</span>}
                            </div>
                            </fieldset>
                        </Form>
                    </section>

                    <section className="ai-assistant-section" aria-labelledby="ai-assistant-trial">
                        <h2 id="ai-assistant-trial">儲存前試跑</h2>
                        <p className="ai-assistant-lede">
                            用上面尚未儲存的草稿回答你輸入的問題（一行一題，最多 3 題，每分鐘 3 次）。會呼叫真實模型並產生費用，不會影響學生。
                            要完整比較品質，請在伺服器執行 <code>python manage.py run_ai_eval --live</code>。
                        </p>
                        <Form.Label htmlFor="ai-trial-input">試跑的問題</Form.Label>
                        <Form.Control id="ai-trial-input" as="textarea" rows={3} value={trialText} placeholder={'lokah 是什麼意思？\n幫我寫一個 Python 排序'}
                            onChange={(e) => setTrialText(e.target.value)} />
                        <div className="ai-assistant-actions">
                            <Button variant="outline-primary" disabled={busy || trialLines < 1 || trialLines > 3} onClick={runTrial}>用草稿試跑</Button>
                            {trialLines > 3 && <span className="ai-assistant-muted">最多 3 題</span>}
                        </div>
                        {trial && (
                            <div className="ai-assistant-trial-result" aria-live="polite">
                                <p className="ai-assistant-muted">草稿的提示詞版本：{trial.promptVersion}</p>
                                <ul>
                                    {trial.replies.map((r, index) => (
                                        <li key={index}>
                                            <p className="ai-assistant-trial-q">{r.question}</p>
                                            <p>{r.error || r.reply || '（沒有回覆）'}{r.refused ? '（模型拒答）' : ''}</p>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </section>

                    <VersionList versions={overview.versions} busy={busy} onRollback={rollback} />
                    <ModerationSection />
                </div>
            )}
        </main>
    );
}
