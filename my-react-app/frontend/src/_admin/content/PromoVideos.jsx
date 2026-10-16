import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Form, Spinner } from 'react-bootstrap';
import { Plus, Save, Trash2 } from 'lucide-react';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../../utils/apiClient';
import { useAuth } from '../../userServives/authContext';
import { useActionLock } from '../hooks/useActionLock';
import { useGuardedSelection } from '../hooks/useGuardedSelection';
import { countChars, formatApiError, isAborted, isOutcomeUnknown } from '../apiErrors';
import AdminEmpty from '../components/AdminEmpty';
import '../../../static/css/_admin/promo-videos.css';

const PUBLISHERS = ['owner', 'admin'];
const LIMITS = { title: 60, description: 300, transcript: 6000 };
const MB = 1024 * 1024;
// 與後端 promo_upload.KINDS 一致；後端仍會再檢查，這裡只是讓太大的檔案不必等上傳完才被拒絕
const FILE_RULES = {
    video: { label: '影片檔', accept: 'video/mp4,.mp4', maxBytes: 150 * MB, maxText: '150 MB' },
    cover: { label: '封面圖', accept: 'image/jpeg,image/webp,.jpg,.jpeg,.webp', maxBytes: 2 * MB, maxText: '2 MB' },
    caption: { label: '字幕檔', accept: 'text/vtt,.vtt', maxBytes: 200 * 1024, maxText: '200 KB' },
};
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000; // 150 MB 加上伺服器端檢查，60 秒的預設逾時不夠

const formOf = (video) => ({
    title: video?.title ?? '',
    description: video?.description ?? '',
    transcript: video?.transcript ?? '',
});
const normalized = (form) => JSON.stringify({
    title: form.title.trim(), description: form.description.trim(), transcript: form.transcript.trim(),
});

const formatDuration = (seconds) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return '';
    return `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒`;
};
const formatSize = (bytes) => (Number.isFinite(bytes) && bytes > 0 ? `${(bytes / MB).toFixed(1)} MB` : '');

const SLOT_HINTS = {
    video: 'MP4（H.264 影像、AAC 聲音，可以沒有聲音）。最大 150 MB、8 分鐘內、寬度不超過 1920。'
        + '播放前要先下載整段的檔案會被拒絕，請匯出時勾選「網路最佳化」或「快速啟動」。',
    cover: 'JPEG 或 WebP，最大 2 MB，寬高各不超過 4000。上傳後會重新編碼並移除拍攝資訊。影片載入前與失敗時顯示這張圖。',
    caption: 'WebVTT（.vtt），UTF-8，最大 200 KB。沒有字幕時，請把逐字稿填在下方。',
};

function validate(form) {
    const errors = {};
    if (!form.title.trim()) errors.title = '請填寫標題';
    else if (countChars(form.title.trim()) > LIMITS.title) errors.title = `標題最多 ${LIMITS.title} 字`;
    if (countChars(form.description.trim()) > LIMITS.description) errors.description = `說明最多 ${LIMITS.description} 字`;
    if (countChars(form.transcript.trim()) > LIMITS.transcript) errors.transcript = `逐字稿最多 ${LIMITS.transcript} 字`;
    return errors;
}

function StatusBadges({ video }) {
    const missing = video.video_path && !video.video_url;
    return (
        <span className="promo-videos-badges">
            {video.is_active && <Badge bg="success">首頁使用中</Badge>}
            {!video.video_path && <Badge bg="secondary">尚未上傳影片</Badge>}
            {missing && <Badge bg="danger">影片檔遺失</Badge>}
        </span>
    );
}

function UploadProgress({ progress, onCancel }) {
    const checking = progress.total > 0 && progress.loaded >= progress.total;
    const percent = progress.total > 0 ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : null;
    return (
        <div className="promo-videos-busy" role="status">
            {checking ? <Spinner size="sm" /> : percent !== null && (
                <progress value={progress.loaded} max={progress.total} aria-label="上傳進度" />
            )}
            <span>
                {checking
                    ? '已送出，伺服器檢查影片中，影片較長時可能需要一分鐘…'
                    : `上傳中${percent !== null ? ` ${percent}%` : ''}，請不要離開此頁…`}
            </span>
            {onCancel && !checking && <Button variant="outline-secondary" size="sm" onClick={onCancel}>取消上傳</Button>}
        </div>
    );
}

function FileSlot({ kind, video, editable, busyKind, progress, error, onUpload, onCancel, onClear, children }) {
    const rule = FILE_RULES[kind];
    const path = video[`${kind}_path`];
    const url = video[`${kind}_url`];
    const busy = busyKind === kind;
    const inputId = `promo-${kind}-${video.id}`;
    return (
        <Form.Group className="promo-videos-slot" controlId={inputId}>
            <Form.Label>{rule.label}{kind === 'caption' ? '（選填）' : ''}</Form.Label>
            {children}
            {path && !url && (
                <p className="promo-videos-missing" role="alert">
                    資料庫有這個檔案的紀錄，但伺服器上找不到檔案。請重新上傳。
                </p>
            )}
            {editable && (
                <div className="promo-videos-slot-actions">
                    <Form.Control
                        type="file"
                        accept={rule.accept}
                        disabled={Boolean(busyKind)}
                        isInvalid={Boolean(error)}
                        aria-invalid={Boolean(error)}
                        aria-describedby={`${inputId}-hint${error ? ` ${inputId}-error` : ''}`}
                        onChange={(event) => {
                            const file = event.target.files[0];
                            event.target.value = '';
                            if (file) onUpload(kind, file);
                        }}
                    />
                    {kind !== 'video' && path && (
                        <Button variant="outline-secondary" size="sm" disabled={Boolean(busyKind)} onClick={() => onClear(kind)}>
                            移除{rule.label}
                        </Button>
                    )}
                </div>
            )}
            {busy && <UploadProgress progress={progress} onCancel={onCancel} />}
            {error && <p className="promo-videos-error" id={`${inputId}-error`} role="alert">{error}</p>}
            <Form.Text id={`${inputId}-hint`}>{SLOT_HINTS[kind]}</Form.Text>
        </Form.Group>
    );
}

function Editor({ video, editable, activeId, onSaved, onCreated, onDeleted, onActiveChanged, onDirtyChange }) {
    const isNew = !video;
    const [form, setForm] = useState(formOf(video));
    const [showErrors, setShowErrors] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [slotErrors, setSlotErrors] = useState({});
    const [busyKind, setBusyKind] = useState(null);
    const [progress, setProgress] = useState({ loaded: 0, total: 0 });
    const [confirm, setConfirm] = useState(null); // null | 'delete' | 'activate' | 'deactivate'
    const abortRef = useRef(null);
    const lock = useActionLock();
    const errors = validate(form);
    const fieldError = (name) => (showErrors ? errors[name] : undefined);
    const update = (name, value) => setForm((current) => ({ ...current, [name]: value }));
    const isActive = Boolean(video && video.id === activeId);
    const dirty = normalized(form) !== normalized(formOf(video));

    useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
    useEffect(() => () => {
        onDirtyChange(false);
        abortRef.current?.abort(); // 離開時中止還在送的上傳，避免離頁後仍占著連線
    }, [onDirtyChange]);

    const run = (key, task) => lock.runLocked(key, async () => {
        setError(''); setSuccess('');
        try { await task(); } catch (err) { setError(formatApiError(err)); }
    });

    const save = () => {
        if (Object.keys(errors).length > 0) { setShowErrors(true); return undefined; }
        const payload = {
            title: form.title.trim(), description: form.description.trim(), transcript: form.transcript.trim(),
        };
        return run('save', async () => {
            if (isNew) {
                onCreated(await apiPost('/adminapi/promo-videos/', payload));
                return;
            }
            onSaved(await apiPatch(`/adminapi/promo-videos/${video.id}/`, payload));
            setShowErrors(false);
            setSuccess('已儲存');
        });
    };

    const upload = (kind, file) => {
        const rule = FILE_RULES[kind];
        setSlotErrors((current) => ({ ...current, [kind]: undefined }));
        if (file.size > rule.maxBytes) {
            setSlotErrors((current) => ({
                ...current,
                [kind]: `${rule.label}不可超過 ${rule.maxText}，這個檔案是 ${formatSize(file.size) || `${file.size} 位元組`}`,
            }));
            return undefined;
        }
        return lock.runLocked(`upload-${kind}`, async () => {
            setError(''); setSuccess('');
            setBusyKind(kind);
            setProgress({ loaded: 0, total: 0 });
            const controller = new AbortController();
            abortRef.current = controller;
            try {
                const body = new FormData();
                body.append('file', file);
                const saved = await apiPost(`/adminapi/promo-videos/${video.id}/${kind}/`, body, {
                    timeout: UPLOAD_TIMEOUT_MS,
                    signal: controller.signal,
                    onUploadProgress: (event) => setProgress({ loaded: event.loaded ?? 0, total: event.total ?? 0 }),
                });
                onSaved(saved);
                setSuccess(`${rule.label}已上傳`);
            } catch (err) {
                let message;
                if (isAborted(err)) {
                    message = '已取消上傳。若檔案已經送達伺服器，結果以頁面重新載入後為準。';
                } else if (isOutcomeUnknown(err)) {
                    // 沒收到回應不代表失敗：伺服器可能已經處理完。重新讀取實際狀態，並提醒先確認再重傳
                    message = '沒有收到伺服器的回應，無法確認上傳結果，伺服器可能還在處理。請先看下方是否已出現檔案，必要時稍後重新整理頁面確認，再決定要不要重傳。';
                    try { onSaved(await apiGet(`/adminapi/promo-videos/${video.id}/`)); } catch { /* 讀取也失敗就只顯示提醒 */ }
                } else {
                    message = formatApiError(err);
                }
                setSlotErrors((current) => ({ ...current, [kind]: message }));
            } finally {
                abortRef.current = null;
                setBusyKind(null);
            }
        });
    };

    const clear = (kind) => run(`clear-${kind}`, async () => {
        onSaved(await apiDelete(`/adminapi/promo-videos/${video.id}/clear-${kind}/`));
        setSuccess(`${FILE_RULES[kind].label}已移除`);
    });

    const setActive = (active) => run('active', async () => {
        setConfirm(null);
        await apiPatch('/adminapi/homepage-config/', { active_promo_video: active ? video.id : null });
        onActiveChanged(active ? video.id : null);
        setSuccess(active ? '已設為首頁宣傳影片，首頁會立即使用這支影片' : '已停用，首頁宣傳區改顯示備援內容');
    });

    const remove = () => run('delete', async () => {
        await apiDelete(`/adminapi/promo-videos/${video.id}/`);
        onDeleted(video.id);
    });

    const canActivate = Boolean(video?.video_url);

    return (
        <section className="promo-videos-editor" id="promo-editor" aria-labelledby="promo-editor-title">
            <h2 id="promo-editor-title">{isNew ? '新增宣傳影片' : video.title}</h2>
            {error && <Alert variant="danger" role="alert">{error}</Alert>}
            {success && <Alert variant="success" role="status">{success}</Alert>}

            <Form noValidate onSubmit={(event) => { event.preventDefault(); save(); }}>
                <Form.Group className="promo-videos-field" controlId="promo-title">
                    <Form.Label>標題</Form.Label>
                    <Form.Control
                        value={form.title} disabled={!editable} isInvalid={Boolean(fieldError('title'))}
                        aria-invalid={Boolean(fieldError('title'))}
                        aria-describedby={`promo-title-hint${fieldError('title') ? ' promo-title-error' : ''}`}
                        onChange={(e) => update('title', e.target.value)}
                    />
                    {fieldError('title') && <p className="promo-videos-error" id="promo-title-error" role="alert">{fieldError('title')}</p>}
                    <Form.Text id="promo-title-hint">顯示在影片區塊上，最多 {LIMITS.title} 字（目前 {countChars(form.title.trim())} 字）。</Form.Text>
                </Form.Group>
                <Form.Group className="promo-videos-field" controlId="promo-description">
                    <Form.Label>說明</Form.Label>
                    <Form.Control
                        as="textarea" rows={3} value={form.description} disabled={!editable}
                        isInvalid={Boolean(fieldError('description'))} aria-invalid={Boolean(fieldError('description'))}
                        aria-describedby={`promo-description-hint${fieldError('description') ? ' promo-description-error' : ''}`}
                        onChange={(e) => update('description', e.target.value)}
                    />
                    {fieldError('description') && <p className="promo-videos-error" id="promo-description-error" role="alert">{fieldError('description')}</p>}
                    <Form.Text id="promo-description-hint">選填，最多 {LIMITS.description} 字（目前 {countChars(form.description.trim())} 字）。</Form.Text>
                </Form.Group>
                <Form.Group className="promo-videos-field" controlId="promo-transcript">
                    <Form.Label>逐字稿</Form.Label>
                    <Form.Control
                        as="textarea" rows={6} value={form.transcript} disabled={!editable}
                        isInvalid={Boolean(fieldError('transcript'))} aria-invalid={Boolean(fieldError('transcript'))}
                        aria-describedby={`promo-transcript-hint${fieldError('transcript') ? ' promo-transcript-error' : ''}`}
                        onChange={(e) => update('transcript', e.target.value)}
                    />
                    {fieldError('transcript') && <p className="promo-videos-error" id="promo-transcript-error" role="alert">{fieldError('transcript')}</p>}
                    <Form.Text id="promo-transcript-hint">
                        選填。沒有上傳字幕檔時，請在這裡提供文字版內容，聽不到聲音的訪客與影片載入失敗時都會看到它。
                        最多 {LIMITS.transcript} 字（目前 {countChars(form.transcript.trim())} 字）。
                    </Form.Text>
                </Form.Group>
                {editable && (
                    <Button type="submit" disabled={lock.isLocked}>
                        <Save size={17} aria-hidden="true" /> {lock.pendingKey === 'save' ? '儲存中…' : isNew ? '建立並繼續上傳檔案' : '儲存文字內容'}
                    </Button>
                )}
            </Form>

            {isNew ? (
                <p className="promo-videos-note">建立之後，這裡會出現影片、封面與字幕的上傳欄位。</p>
            ) : (
                <>
                    <div className="promo-videos-files">
                        <FileSlot kind="video" video={video} editable={editable} busyKind={busyKind} progress={progress}
                            error={slotErrors.video} onUpload={upload} onCancel={() => abortRef.current?.abort()} onClear={clear}>
                            {video.video_url ? (
                                <>
                                    {/* 後台預覽不自動播放；字幕軌預設不開，由管理者自行檢查。字幕語言不固定，不硬寫 */}
                                    <video
                                        className="promo-videos-player" controls preload="metadata"
                                        aria-label={`${video.title}（預覽）`}
                                        src={video.video_url} poster={video.cover_url || undefined}
                                    >
                                        {video.caption_url && <track kind="captions" src={video.caption_url} label="字幕" />}
                                    </video>
                                    <p className="promo-videos-meta">
                                        {[formatDuration(video.duration_seconds), formatSize(video.size_bytes)].filter(Boolean).join('，')}
                                    </p>
                                </>
                            ) : <p className="promo-videos-placeholder">尚未上傳影片</p>}
                        </FileSlot>
                        <FileSlot kind="cover" video={video} editable={editable} busyKind={busyKind} progress={progress}
                            error={slotErrors.cover} onUpload={upload} onClear={clear}>
                            {video.cover_url ? <img className="promo-videos-cover" src={video.cover_url} alt="封面圖預覽" /> : <p className="promo-videos-placeholder">尚未上傳封面</p>}
                        </FileSlot>
                        <FileSlot kind="caption" video={video} editable={editable} busyKind={busyKind} progress={progress}
                            error={slotErrors.caption} onUpload={upload} onClear={clear}>
                            <p className="promo-videos-placeholder">{video.caption_url ? '已上傳字幕檔，可在上方播放器的字幕按鈕開啟檢查' : '尚未上傳字幕'}</p>
                        </FileSlot>
                    </div>

                    <section className="promo-videos-publish" aria-labelledby="promo-publish-title">
                        <h3 id="promo-publish-title">首頁使用</h3>
                        {isActive ? (
                            <p>這支影片目前顯示在首頁宣傳區。</p>
                        ) : (
                            <p>
                                {activeId ? '首頁目前使用另一支影片。' : '首頁目前沒有使用宣傳影片，宣傳區顯示備援內容。'}
                                {canActivate ? '設為使用後，首頁會立即改用這支影片。' : '要先上傳影片檔，才能設為首頁使用。'}
                            </p>
                        )}
                        {editable && (confirm === 'activate' || confirm === 'deactivate') && (
                            <div role="group" aria-label="確認變更首頁影片" className="promo-videos-confirm">
                                <p>
                                    {confirm === 'activate'
                                        ? `確定將「${video.title}」設為首頁宣傳影片？儲存後會立即公開。`
                                        : `確定停用「${video.title}」？首頁宣傳區會立即改顯示備援內容。`}
                                </p>
                                <Button disabled={lock.isLocked} onClick={() => setActive(confirm === 'activate')}>
                                    {confirm === 'activate' ? '確定設為首頁使用' : '確定停用'}
                                </Button>{' '}
                                <Button variant="outline-secondary" disabled={lock.isLocked} onClick={() => setConfirm(null)}>取消</Button>
                            </div>
                        )}
                        {editable && !confirm && (
                            <div className="promo-videos-publish-actions">
                                {isActive ? (
                                    <Button variant="outline-secondary" disabled={lock.isLocked} onClick={() => setConfirm('deactivate')}>停用，首頁改顯示備援</Button>
                                ) : (
                                    <Button disabled={lock.isLocked || !canActivate} onClick={() => setConfirm('activate')}>設為首頁宣傳影片</Button>
                                )}
                            </div>
                        )}
                    </section>

                    {editable && (
                        <section className="promo-videos-danger" aria-labelledby="promo-delete-title">
                            <h3 id="promo-delete-title">刪除</h3>
                            {isActive ? (
                                <p>這支影片正在首頁使用，要先停用才能刪除。</p>
                            ) : confirm === 'delete' ? (
                                <div role="group" aria-label="確認刪除">
                                    <p>
                                        確定要刪除「{video.title}」？檔案會保留 14 天後才從伺服器清除。
                                        {dirty ? '這支影片有未儲存的文字變更，刪除後會一併遺失。' : ''}
                                    </p>
                                    <Button variant="danger" disabled={lock.isLocked} onClick={remove}>
                                        <Trash2 size={16} aria-hidden="true" /> 確定刪除
                                    </Button>{' '}
                                    <Button variant="outline-secondary" disabled={lock.isLocked} onClick={() => setConfirm(null)}>取消</Button>
                                </div>
                            ) : (
                                <Button variant="outline-danger" disabled={lock.isLocked} onClick={() => setConfirm('delete')}>
                                    <Trash2 size={16} aria-hidden="true" /> 刪除這支影片
                                </Button>
                            )}
                        </section>
                    )}
                </>
            )}
        </section>
    );
}

export default function PromoVideos() {
    const { userData } = useAuth();
    const editable = PUBLISHERS.includes(userData?.role);
    const [videos, setVideos] = useState([]);
    const [activeId, setActiveId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const headingRef = useRef(null);
    const { selected, select, force, setDirty, hasPending, confirmSwitch, cancelSwitch } = useGuardedSelection();

    const load = useCallback(async () => {
        try {
            const data = await apiGet('/adminapi/promo-videos/');
            setVideos(data.results ?? []);
            setActiveId(data.active_promo_video ?? null);
            setError('');
        } catch (err) { setError(formatApiError(err)); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    const replaceVideo = useCallback((saved) => setVideos((list) => list.map((v) => (v.id === saved.id ? { ...v, ...saved } : v))), []);
    const current = typeof selected === 'number' ? videos.find((v) => v.id === selected) : null;

    if (loading) return <div className="promo-videos-loading"><Spinner animation="border" /><span>載入中…</span></div>;

    return (
        <main className="promo-videos-page">
            <div className="promo-videos-heading">
                <div>
                    <h1 ref={headingRef} tabIndex={-1}>宣傳影片</h1>
                    <p>管理首頁宣傳區的影片、封面與字幕。同一時間首頁只會使用一支。</p>
                </div>
                {editable && (
                    <Button onClick={() => select('new')}>
                        <Plus size={17} aria-hidden="true" /> 新增影片
                    </Button>
                )}
            </div>
            {!editable && <Alert variant="info">你可以檢視宣傳影片；只有擁有者或管理員可以新增、上傳與設定首頁使用。</Alert>}
            {error && <Alert variant="danger" role="alert">{error}</Alert>}
            {hasPending && (
                <Alert variant="warning" role="alert">
                    <p>目前這支影片有尚未儲存的文字變更，切換後會遺失。</p>
                    <Button size="sm" variant="outline-danger" onClick={confirmSwitch}>放棄變更並切換</Button>{' '}
                    <Button size="sm" variant="outline-secondary" onClick={cancelSwitch}>留在這裡</Button>
                </Alert>
            )}

            <div className="promo-videos-layout">
                <nav className="promo-videos-list" aria-label="宣傳影片清單">
                    {videos.length === 0 ? (
                        <AdminEmpty
                            compact
                            title="目前沒有宣傳影片"
                            description={editable ? '新增一支之後，就能上傳影片檔並設為首頁使用。' : '擁有者或管理員新增後會顯示在這裡。'}
                            action={editable ? { label: '新增影片', onClick: () => select('new') } : undefined}
                        />
                    ) : (
                        <ul>
                            {videos.map((video) => (
                                <li key={video.id}>
                                    <button
                                        type="button"
                                        className={`promo-videos-item${selected === video.id ? ' is-selected' : ''}`}
                                        aria-current={selected === video.id ? 'true' : undefined}
                                        aria-controls="promo-editor"
                                        onClick={() => select(video.id)}
                                    >
                                        <strong>{video.title}</strong>
                                        <StatusBadges video={{ ...video, is_active: video.id === activeId }} />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </nav>

                <div className="promo-videos-detail">
                    {selected === 'new' && (
                        <Editor
                            key="new" video={null} editable={editable} activeId={activeId} onDirtyChange={setDirty}
                            onCreated={async (created) => { await load(); force(created.id); }}
                        />
                    )}
                    {current && (
                        <Editor
                            key={current.id} video={current} editable={editable} activeId={activeId} onDirtyChange={setDirty}
                            onSaved={replaceVideo}
                            onActiveChanged={setActiveId}
                            onDeleted={async () => { force(null); await load(); headingRef.current?.focus(); }}
                        />
                    )}
                    {!selected && videos.length > 0 && (
                        <p className="promo-videos-placeholder">從左側選一支影片查看或編輯。</p>
                    )}
                </div>
            </div>
        </main>
    );
}
