import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Form, Spinner } from 'react-bootstrap';
import { ImagePlus, Plus, Save, Send, Trash2 } from 'lucide-react';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../../utils/apiClient';
import { useAuth } from '../../userServives/authContext';
import { useMediaUpload } from '../hooks/useMediaUpload';
import { useActionLock } from '../hooks/useActionLock';
import { useGuardedSelection } from '../hooks/useGuardedSelection';
import { countChars, formatApiError } from '../apiErrors';
import AdminEmpty from '../components/AdminEmpty';
import '../../../static/css/_admin/featured-topics.css';

const CONTENT_EDITORS = ['owner', 'admin', 'editor'];
const PUBLISHERS = ['owner', 'admin'];
const MAX_PUBLISHED = 3;
const LIMITS = { title: 40, summary: 120, category: 12 };
const EDITABLE_STATUSES = ['draft', 'rejected', 'unpublished'];
const STATUSES = {
    draft: { label: '草稿', bg: 'secondary' },
    pending_review: { label: '送審中', bg: 'warning' },
    rejected: { label: '已退件', bg: 'danger' },
    published: { label: '已發布', bg: 'success' },
    unpublished: { label: '已下架', bg: 'dark' },
};

const formOf = (topic) => ({
    title: topic?.title ?? '',
    summary: topic?.summary ?? '',
    image_url: topic?.image_url ?? '',
    link_url: topic?.link_url ?? '',
    category_label: topic?.category_label ?? '',
    sort_order: topic?.sort_order ?? 0,
});

// 與後端 validate_hero_link_url 同一個意思：站內路徑（/ 開頭且不是 //）或 https 網址。後端是最終判斷。
const linkLooksValid = (value) => !value || (/^\/(?!\/)/.test(value) && !value.includes('\\')) || /^https:\/\//i.test(value);

function validate(form) {
    const errors = {};
    if (!form.title.trim()) errors.title = '請填寫標題';
    else if (countChars(form.title.trim()) > LIMITS.title) errors.title = `標題最多 ${LIMITS.title} 字`;
    if (countChars(form.summary.trim()) > LIMITS.summary) errors.summary = `摘要最多 ${LIMITS.summary} 字`;
    if (countChars(form.category_label.trim()) > LIMITS.category) errors.category_label = `分類標籤最多 ${LIMITS.category} 字`;
    const order = Number(form.sort_order);
    if (form.sort_order === '' || !Number.isInteger(order) || order < 0 || order > 99) errors.sort_order = '排序請填 0 到 99 的整數';
    if (!linkLooksValid(form.link_url.trim())) errors.link_url = '連結請填站內路徑（以 / 開頭）或 https:// 開頭的網址';
    return errors;
}

function Field({ id, label, hint, error, children }) {
    return (
        <Form.Group className="featured-topics-field" controlId={id}>
            <Form.Label>{label}</Form.Label>
            {children}
            {error && <p className="featured-topics-error" id={`${id}-error`} role="alert">{error}</p>}
            <Form.Text id={`${id}-hint`}>{hint}</Form.Text>
        </Form.Group>
    );
}

const normalized = (form) => JSON.stringify({
    ...form, title: form.title.trim(), summary: form.summary.trim(), link_url: form.link_url.trim(),
    category_label: form.category_label.trim(), sort_order: String(form.sort_order),
});

function Editor({ topic, role, publishedCount, onChanged, onCreated, onDeleted, onNotice, onStale, onDirtyChange }) {
    const isNew = !topic;
    const canEdit = CONTENT_EDITORS.includes(role);
    const canPublish = PUBLISHERS.includes(role);
    const status = topic?.status ?? 'draft';
    const fieldsLocked = !canEdit || status === 'pending_review';
    const [form, setForm] = useState(formOf(topic));
    const [baseline, setBaseline] = useState(formOf(topic));
    const [showErrors, setShowErrors] = useState(false);
    const [error, setError] = useState('');
    const [comment, setComment] = useState('');
    const [commentError, setCommentError] = useState('');
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [revisionNote, setRevisionNote] = useState(false);
    const media = useMediaUpload({ resetKey: topic?.id ?? 'new' });
    const uploading = Boolean(media.uploadingKey);
    const lock = useActionLock();
    const errors = validate(form);
    const fieldError = (name) => (showErrors ? errors[name] : undefined);
    const update = (name, value) => setForm((current) => ({ ...current, [name]: value }));
    const describedBy = (id, name) => `${id}-hint${fieldError(name) ? ` ${id}-error` : ''}`;
    const preview = media.previews.image ?? form.image_url;
    const dirty = normalized(form) !== normalized(baseline);

    useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
    useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

    useEffect(() => {
        media.setPreview('image', topic?.image_url ?? '');
        if (!topic || topic.status !== 'published') return undefined;
        // 已發布的專題可能已有一筆待審修改，帶進來接續編輯（404 代表沒有）
        let active = true;
        (async () => {
            try {
                const revision = await apiGet(`/adminapi/featured-topics/${topic.id}/pending-revision/`);
                if (!active || !revision?.payload) return;
                setForm(formOf({ ...topic, ...revision.payload }));
                setBaseline(formOf({ ...topic, ...revision.payload }));
                media.setPreview('image', revision.payload.image_url ?? topic.image_url ?? '');
                setRevisionNote(true);
            } catch (err) {
                if (err.status !== 404 && active) setError(formatApiError(err));
            }
        })();
        return () => { active = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const payload = () => ({
        title: form.title.trim(),
        summary: form.summary.trim(),
        image_url: form.image_url,
        link_url: form.link_url.trim(),
        category_label: form.category_label.trim(),
        sort_order: Number(form.sort_order),
    });

    const run = (key, task) => {
        setError('');
        return lock.runLocked(key, async () => {
            try { await task(); } catch (err) {
                // 409 = 狀態衝突（別人剛改過這則專題，或已發布數量到上限）：保留後端說的原因，並重新載入讓畫面和伺服器一致
                if (err?.status === 409) onStale(`${formatApiError(err)}`, topic?.id, topic?.status);
                else setError(formatApiError(err));
            }
        });
    };

    const guardForm = () => {
        if (uploading) { setError('請等待圖片上傳完成'); return false; }
        if (Object.keys(errors).length > 0) { setShowErrors(true); setError('有欄位需要修正，請看標示的欄位'); return false; }
        return true;
    };

    const save = ({ submit = false } = {}) => {
        if (!guardForm()) return undefined;
        return run(submit ? 'submit' : 'save', async () => {
            if (status === 'published') {
                await apiPost(`/adminapi/featured-topics/${topic.id}/pending-revision/`, payload());
                onNotice('已提交修改，待審核核准後生效');
                onChanged({ ...topic, has_pending_revision: true }, { keepForm: true });
                setRevisionNote(true);
                return;
            }
            let saved = isNew
                ? await apiPost('/adminapi/featured-topics/', payload())
                : await apiPatch(`/adminapi/featured-topics/${topic.id}/`, payload());
            if (submit) {
                try {
                    saved = await apiPost(`/adminapi/featured-topics/${saved.id}/submit/`);
                } catch (err) {
                    // 已儲存、只是送審失敗：不要讓使用者以為整個沒存
                    if (isNew) onCreated(saved, '已儲存為草稿，但送審失敗');
                    else onChanged(saved);
                    throw err;
                }
            }
            if (isNew) onCreated(saved, submit ? '已建立並送審' : '已建立草稿');
            else { onChanged(saved); onNotice(submit ? '已儲存並送審' : '已儲存'); }
        });
    };

    const act = (key, path, message, body) => run(key, async () => {
        const saved = await apiPost(`/adminapi/featured-topics/${topic.id}/${path}/`, body);
        onChanged(saved);
        onNotice(message);
    });

    const reject = () => {
        if (!comment.trim()) { setCommentError('退件必須填寫理由，讓送審的人知道要改什麼'); return undefined; }
        setCommentError('');
        return act('reject', 'reject', '已退件', { review_comment: comment.trim() });
    };

    const remove = () => run('delete', async () => {
        await apiDelete(`/adminapi/featured-topics/${topic.id}/`);
        onDeleted();
    });

    const atLimit = publishedCount >= MAX_PUBLISHED;
    const busy = lock.isLocked || uploading;

    return (
        <section className="featured-topics-editor" id="topic-editor" aria-labelledby="topic-editor-title">
            <div className="featured-topics-editor-head">
                <h2 id="topic-editor-title">{isNew ? '新增專題' : topic.title}</h2>
                {!isNew && <Badge bg={STATUSES[status]?.bg ?? 'secondary'}>{STATUSES[status]?.label ?? status}</Badge>}
            </div>
            {(error || media.error) && <Alert variant="danger" role="alert">{error || media.error}</Alert>}
            {status === 'rejected' && topic.review_comment && (
                <Alert variant="warning">退件理由：{topic.review_comment}</Alert>
            )}
            {status === 'pending_review' && <Alert variant="info">送審中，內容暫時不能修改。要修改請先撤回。</Alert>}
            {status === 'published' && canEdit && (
                <Alert variant="info">
                    這則專題已公開。修改不會立刻生效，會送出一筆待審修改，核准後才更新首頁。
                    {revisionNote ? '目前已有一筆待審修改，再次送出會覆蓋它。' : ''}
                </Alert>
            )}
            {!canEdit && <Alert variant="info">你可以檢視本期專題；擁有者、管理員與編輯可以修改。</Alert>}

            <Form noValidate onSubmit={(event) => { event.preventDefault(); save(); }}>
                <Field id="topic-title" label="標題" error={fieldError('title')}
                    hint={`最多 ${LIMITS.title} 字（目前 ${countChars(form.title.trim())} 字）。`}>
                    <Form.Control value={form.title} disabled={fieldsLocked} isInvalid={Boolean(fieldError('title'))}
                        aria-invalid={Boolean(fieldError('title'))} aria-describedby={describedBy('topic-title', 'title')}
                        onChange={(e) => update('title', e.target.value)} />
                </Field>
                <Field id="topic-summary" label="摘要" error={fieldError('summary')}
                    hint={`選填，最多 ${LIMITS.summary} 字（目前 ${countChars(form.summary.trim())} 字）。`}>
                    <Form.Control as="textarea" rows={3} value={form.summary} disabled={fieldsLocked}
                        isInvalid={Boolean(fieldError('summary'))} aria-invalid={Boolean(fieldError('summary'))}
                        aria-describedby={describedBy('topic-summary', 'summary')}
                        onChange={(e) => update('summary', e.target.value)} />
                </Field>
                <div className="featured-topics-grid">
                    <Field id="topic-category" label="分類標籤" error={fieldError('category_label')}
                        hint={`選填，顯示在卡片上，最多 ${LIMITS.category} 字。`}>
                        <Form.Control value={form.category_label} disabled={fieldsLocked}
                            isInvalid={Boolean(fieldError('category_label'))} aria-invalid={Boolean(fieldError('category_label'))}
                            aria-describedby={describedBy('topic-category', 'category_label')}
                            onChange={(e) => update('category_label', e.target.value)} />
                    </Field>
                    <Field id="topic-order" label="排序" error={fieldError('sort_order')}
                        hint="0 到 99，數字小的排在前面。同樣數字時，先建立的在前。">
                        <Form.Control type="number" min="0" max="99" value={form.sort_order} disabled={fieldsLocked}
                            isInvalid={Boolean(fieldError('sort_order'))} aria-invalid={Boolean(fieldError('sort_order'))}
                            aria-describedby={describedBy('topic-order', 'sort_order')}
                            onChange={(e) => update('sort_order', e.target.value)} />
                    </Field>
                </div>
                <Field id="topic-link" label="連結" error={fieldError('link_url')}
                    hint="選填。站內路徑（以 / 開頭，例如 /quiz/select）或 https:// 開頭的網址。留白時卡片不能點。">
                    <Form.Control value={form.link_url} disabled={fieldsLocked} isInvalid={Boolean(fieldError('link_url'))}
                        aria-invalid={Boolean(fieldError('link_url'))} aria-describedby={describedBy('topic-link', 'link_url')}
                        onChange={(e) => update('link_url', e.target.value)} placeholder="/quiz/select 或 https://example.com" />
                </Field>
                <Form.Group className="featured-topics-field" controlId="topic-image">
                    <Form.Label>圖片</Form.Label>
                    <div className="featured-topics-uploader">
                        {preview ? <img src={preview} alt="專題圖片預覽" /> : (
                            <div className="featured-topics-placeholder"><ImagePlus size={28} aria-hidden="true" /><span>尚未選擇圖片</span></div>
                        )}
                        <div>
                            <Form.Control type="file" accept="image/*" disabled={fieldsLocked || uploading}
                                aria-describedby="topic-image-hint"
                                onChange={(event) => {
                                    const file = event.target.files[0];
                                    media.upload(file, 'image', { localPreview: true, onUploaded: (url) => update('image_url', url) });
                                }} />
                            {uploading && <p className="featured-topics-busy" role="status"><Spinner size="sm" /> 圖片上傳中…</p>}
                            {form.image_url && !fieldsLocked && (
                                <Button variant="outline-secondary" size="sm" className="featured-topics-remove-image"
                                    onClick={() => { update('image_url', ''); media.setPreview('image', ''); }}>
                                    移除圖片
                                </Button>
                            )}
                        </div>
                    </div>
                    <Form.Text id="topic-image-hint">選填，最大 5 MB。圖片會上傳到網站的圖片服務；沒有圖片時卡片只顯示文字。</Form.Text>
                </Form.Group>

                {canEdit && status !== 'pending_review' && (
                    <div className="featured-topics-actions">
                        <Button type="submit" variant={status === 'published' ? 'primary' : 'outline-secondary'} disabled={busy}>
                            <Save size={17} aria-hidden="true" />{' '}
                            {lock.pendingKey === 'save' ? '儲存中…' : status === 'published' ? '提交修改（待審核）' : isNew ? '建立草稿' : '儲存草稿'}
                        </Button>
                        {status !== 'published' && (
                            <Button disabled={busy} onClick={() => save({ submit: true })}>
                                <Send size={16} aria-hidden="true" /> {lock.pendingKey === 'submit' ? '送審中…' : '儲存並送審'}
                            </Button>
                        )}
                    </div>
                )}
            </Form>

            {!isNew && (
                <section className="featured-topics-workflow" aria-labelledby="topic-workflow-title">
                    <h3 id="topic-workflow-title">審核與發布</h3>
                    <p className="featured-topics-count">
                        首頁最多同時顯示 {MAX_PUBLISHED} 則專題，目前已發布 {publishedCount} 則。
                    </p>
                    {status === 'pending_review' && canEdit && (
                        <Button variant="outline-secondary" disabled={busy} onClick={() => act('withdraw', 'withdraw', '已撤回為草稿')}>撤回送審</Button>
                    )}
                    {status === 'pending_review' && canPublish && (
                        <div className="featured-topics-review">
                            {atLimit && <Alert variant="warning">已發布的專題已滿 {MAX_PUBLISHED} 則，核准前要先下架其中一則。</Alert>}
                            <Form.Group controlId="topic-review-comment">
                                <Form.Label>審核意見</Form.Label>
                                <Form.Control as="textarea" rows={2} value={comment} isInvalid={Boolean(commentError)}
                                    aria-invalid={Boolean(commentError)}
                                    aria-describedby={`topic-review-comment-hint${commentError ? ' topic-review-comment-error' : ''}`}
                                    onChange={(e) => setComment(e.target.value)} />
                                {commentError && <p className="featured-topics-error" id="topic-review-comment-error" role="alert">{commentError}</p>}
                                <Form.Text id="topic-review-comment-hint">核准時選填；退件時必填。</Form.Text>
                            </Form.Group>
                            <div className="featured-topics-actions">
                                <Button disabled={busy || atLimit} onClick={() => act('approve', 'approve', '已核准並發布', { review_comment: comment.trim() })}>核准並發布</Button>
                                <Button variant="outline-danger" disabled={busy} onClick={reject}>退件</Button>
                            </div>
                        </div>
                    )}
                    {status === 'published' && canPublish && (
                        <Button variant="outline-secondary" disabled={busy} onClick={() => act('unpublish', 'unpublish', '已下架')}>下架</Button>
                    )}
                    {status === 'unpublished' && canPublish && (
                        <>
                            {atLimit && <Alert variant="warning">已發布的專題已滿 {MAX_PUBLISHED} 則，重新發布前要先下架其中一則。</Alert>}
                            <Button disabled={busy || atLimit} onClick={() => act('republish', 'republish', '已重新發布')}>重新發布</Button>
                        </>
                    )}
                    {['draft', 'rejected'].includes(status) && <p className="featured-topics-hint">儲存並送審後，由擁有者或管理員核准才會出現在首頁。</p>}
                </section>
            )}

            {!isNew && canPublish && EDITABLE_STATUSES.includes(status) && (
                <section className="featured-topics-danger" aria-labelledby="topic-delete-title">
                    <h3 id="topic-delete-title">刪除</h3>
                    {confirmDelete ? (
                        <div role="group" aria-label="確認刪除">
                            <p>
                                確定要刪除「{topic.title}」？
                                {dirty ? '這則專題有未儲存的變更，刪除後會一併遺失。' : ''}
                            </p>
                            <Button variant="danger" disabled={busy} onClick={remove}><Trash2 size={16} aria-hidden="true" /> 確定刪除</Button>{' '}
                            <Button variant="outline-secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>取消</Button>
                        </div>
                    ) : (
                        <Button variant="outline-danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
                            <Trash2 size={16} aria-hidden="true" /> 刪除這則專題
                        </Button>
                    )}
                </section>
            )}
        </section>
    );
}

export default function FeaturedTopics() {
    const { userData } = useAuth();
    const role = userData?.role;
    const canCreate = CONTENT_EDITORS.includes(role);
    const [topics, setTopics] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState(null); // { variant, text }
    const [version, setVersion] = useState(0); // 自己的動作成功後才加一，讓編輯區用最新資料重新建立
    const headingRef = useRef(null);
    const { selected, select, force, setDirty, hasPending, confirmSwitch, cancelSwitch } = useGuardedSelection();
    const say = useCallback((text, variant = 'success') => setNotice(text ? { variant, text } : null), []);

    const load = useCallback(async () => {
        try {
            const data = await apiGet('/adminapi/featured-topics/');
            setTopics(data.results ?? []);
            setError('');
            return data.results ?? [];
        } catch (err) { setError(formatApiError(err)); }
        finally { setLoading(false); }
        return null;
    }, []);

    useEffect(() => { load(); }, [load]);

    const publishedCount = topics.filter((t) => t.status === 'published').length;
    const current = typeof selected === 'number' ? topics.find((t) => t.id === selected) : null;

    const changed = async () => { await load(); setVersion((v) => v + 1); };
    // 409 不一定是畫面過期（也可能是已發布滿 3 則、內容驗證失敗）：重新載入後，只有這則專題的狀態真的
    // 變了才重建編輯區；沒變就保留使用者正在填的內容，只顯示原因。
    const stale = async (text, id, knownStatus) => {
        say(text, 'warning');
        const fresh = await load();
        const latest = fresh?.find((t) => t.id === id);
        if (!latest || latest.status !== knownStatus) setVersion((v) => v + 1);
    };

    if (loading) return <div className="featured-topics-loading"><Spinner animation="border" /><span>載入中…</span></div>;

    return (
        <main className="featured-topics-page">
            <div className="featured-topics-heading">
                <div>
                    <h1 ref={headingRef} tabIndex={-1}>本期專題</h1>
                    <p>首頁的專題卡片，最多同時顯示 {MAX_PUBLISHED} 則，發布前需要審核。</p>
                </div>
                {canCreate && (
                    <Button onClick={() => { say(''); select('new'); }}>
                        <Plus size={17} aria-hidden="true" /> 新增專題
                    </Button>
                )}
            </div>
            {error && <Alert variant="danger" role="alert">{error}</Alert>}
            {notice && <Alert variant={notice.variant} role={notice.variant === 'success' ? 'status' : 'alert'}>{notice.text}</Alert>}
            {hasPending && (
                <Alert variant="warning" role="alert">
                    <p>目前這則專題有尚未儲存的變更，切換後會遺失。</p>
                    <Button size="sm" variant="outline-danger" onClick={confirmSwitch}>放棄變更並切換</Button>{' '}
                    <Button size="sm" variant="outline-secondary" onClick={cancelSwitch}>留在這裡</Button>
                </Alert>
            )}

            <div className="featured-topics-layout">
                <nav className="featured-topics-list" aria-label="專題清單">
                    {topics.length === 0 ? (
                        <AdminEmpty
                            compact
                            title="目前沒有專題"
                            description={canCreate ? '新增並送審、核准後，就會出現在首頁。' : '編輯新增後會顯示在這裡。'}
                            action={canCreate ? { label: '新增專題', onClick: () => select('new') } : undefined}
                        />
                    ) : (
                        <ul>
                            {topics.map((topic) => (
                                <li key={topic.id}>
                                    <button type="button" className={`featured-topics-item${selected === topic.id ? ' is-selected' : ''}`}
                                        aria-current={selected === topic.id ? 'true' : undefined}
                                        aria-controls="topic-editor"
                                        onClick={() => { say(''); select(topic.id); }}>
                                        <strong>{topic.title}</strong>
                                        <span className="featured-topics-badges">
                                            <Badge bg={STATUSES[topic.status]?.bg ?? 'secondary'}>{STATUSES[topic.status]?.label ?? topic.status}</Badge>
                                            {topic.has_pending_revision && <Badge bg="info">有待審修改</Badge>}
                                            <span className="featured-topics-order">排序 {topic.sort_order}</span>
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </nav>

                <div className="featured-topics-detail">
                    {selected === 'new' && (
                        <Editor key="new" topic={null} role={role} publishedCount={publishedCount}
                            onNotice={say} onStale={stale} onDirtyChange={setDirty}
                            onCreated={async (created, message) => { await load(); say(message); force(created.id); }} />
                    )}
                    {current && (
                        <Editor key={`${current.id}-${version}`} topic={current} role={role}
                            publishedCount={publishedCount} onNotice={say} onStale={stale} onChanged={changed}
                            onDirtyChange={setDirty}
                            onDeleted={async () => { force(null); say('已刪除'); await load(); headingRef.current?.focus(); }} />
                    )}
                    {!selected && topics.length > 0 && <p className="featured-topics-hint">從左側選一則專題查看或編輯。</p>}
                </div>
            </div>
        </main>
    );
}
