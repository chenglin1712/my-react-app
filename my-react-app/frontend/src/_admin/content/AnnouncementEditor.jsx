import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert, Badge, Button, Form, Spinner } from 'react-bootstrap';
import { ArrowLeft, ImagePlus, Save, Send } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '../../../utils/apiClient';
import { uploadToCloudinary } from '@utils/uploadToCloudinary';
import { useAuth } from '../../userServives/authContext';
import { TRIBES } from '../../constants/tribes';
import '../../../static/css/_admin/announcements.css';

const CONTENT_EDITORS = ['owner', 'admin', 'editor'];
const CATEGORIES = [
    ['announcement', '公告'], ['activity', '活動'], ['exam', '考試'], ['maintenance', '系統維護'],
];
const TRIBE_OPTIONS = TRIBES.map((tribe) => [tribe.slug, tribe.fullName]);
const STATUS_LABELS = {
    draft: '草稿',
    pending_review: '送審中',
    rejected: '已退件',
    published: '已發布',
    unpublished: '已下架',
};
const EMPTY_FORM = {
    title: '',
    body: '',
    category: 'announcement',
    tribes: [],
    cover_image_url: '',
    link_url: '',
    is_pinned: false,
    pin_until: '',
    publish_at: '',
    unpublish_at: '',
    display_date_text: '',
};

// 純日期值（例如 "2026-09-01"，只有 pin_until 會走這條路）不能透過
// new Date(dateOnlyString) 解析——ECMA-262 會把它當 UTC 午夜，再用
// getTimezoneOffset() 換算回本地時間，在 UTC 負偏移地區會把日期往前推
// 一天，使用者存的跟畫面上看到的不是同一天。純日期直接拆字串、原樣
// 帶回 <input type="date">，完全不經過 Date／時區換算。
const toLocalInput = (value, type = 'datetime') => {
    if (!value) return '';
    if (type === 'date') return value.slice(0, 10);
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString();
    return local.slice(0, 16);
};

const itemToForm = (item) => ({
    title: item.title ?? '',
    body: item.body ?? '',
    category: item.category ?? 'announcement',
    tribes: item.tribes ?? [],
    cover_image_url: item.cover_image_url ?? '',
    link_url: item.link_url ?? '',
    is_pinned: Boolean(item.is_pinned),
    pin_until: toLocalInput(item.pin_until, 'date'),
    publish_at: toLocalInput(item.publish_at),
    unpublish_at: toLocalInput(item.unpublish_at),
    display_date_text: item.display_date_text ?? '',
});

export default function AnnouncementEditor() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { userData } = useAuth();
    const role = userData?.role;
    const [form, setForm] = useState(EMPTY_FORM);
    const [status, setStatus] = useState('draft');
    // 新增公告一定是後台自建（source='admin'），沒有 id 就不用另外打 API
    // 確認——這個 state 只用來顯示「爬蟲匯入」提示，不參與任何送出的 payload。
    const [source, setSource] = useState('admin');
    const [loading, setLoading] = useState(Boolean(id));
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [preview, setPreview] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    // 狀態允許編輯只是後端狀態機的一半條件，角色也要對得上——reviewer／
    // analyst 沒有 CONTENT_EDITORS 權限，就算內容是 draft，儲存也一定會被
    // 後端 require_role(CONTENT_EDITORS) 擋成 403。兩個條件都要成立才顯示
    // 可編輯的表單，不能只看狀態就讓非編輯角色以為自己能存檔。
    //
    // published 也允許編輯，但儲存時不會 PATCH 公告本身，而是建立或更新
    // pending revision；目前已發布的內容會繼續生效，直到修改被核准。
    const statusEditable = !id || ['draft', 'rejected', 'published', 'unpublished'].includes(status);
    const editable = statusEditable && CONTENT_EDITORS.includes(role);

    useEffect(() => {
        if (!id) return;

        let active = true;

        (async () => {
            try {
                const item = await apiGet(`/adminapi/announcements/${id}/`);
                if (!active) return;

                let formSource = item;

                // 已發布公告可能已經有一筆尚未審完的修改。若存在，就把 payload
                // 覆蓋到目前正式公告上，讓使用者接續編輯先前的提案；payload
                // 沒帶到的欄位仍沿用正式公告目前的值。
                if (item.status === 'published') {
                    try {
                        const revision = await apiGet(
                            `/adminapi/announcements/${id}/pending-revision/`,
                        );
                        if (!active) return;
                        if (revision?.payload) {
                            formSource = { ...item, ...revision.payload };
                        }
                    } catch (err) {
                        // 404 是正常情況，代表這篇公告尚未建立待審修改；其他錯誤
                        // 仍應交給外層顯示，避免權限或伺服器錯誤被誤當成沒有提案。
                        if (err.status !== 404) throw err;
                    }
                }

                if (!active) return;
                setStatus(item.status);
                setSource(item.source ?? 'admin');
                setForm(itemToForm(formSource));
                setPreview(formSource.cover_image_url ?? '');
            } catch (err) {
                if (active) setError(err.message);
            } finally {
                if (active) setLoading(false);
            }
        })();

        return () => {
            active = false;
        };
    }, [id]);

    const update = (field, value) => {
        setForm((current) => ({ ...current, [field]: value }));
    };

    const toggleTribe = (tribe) => {
        update(
            'tribes',
            form.tribes.includes(tribe)
                ? form.tribes.filter((value) => value !== tribe)
                : [...form.tribes, tribe],
        );
    };

    const handleFileChange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
            setError('圖片不得超過 5 MB，請重新選擇。');
            return;
        }

        setError('');
        setPreview(URL.createObjectURL(file));
        setUploading(true);

        try {
            const secureUrl = await uploadToCloudinary(file);
            update('cover_image_url', secureUrl);
            setPreview(secureUrl);
        } catch (err) {
            console.error('圖片上傳失敗', err);
            setError('圖片上傳失敗');
        } finally {
            setUploading(false);
        }
    };

    // <input type="datetime-local"> 的值是沒有時區資訊的「當地時間」字串
    // （例如 "2026-08-15T14:30"）。後端 Django 設定 TIME_ZONE="UTC"，收到
    // 這種沒有時區標記的字串會直接當成 UTC 時間存起來——不做轉換的話，
    // 使用者在台灣（UTC+8）設定的「下午 2:30 發布」會被存成 UTC 14:30，
    // 實際發布時間變成台灣時間晚上 10:30，整整差 8 小時卻不會有任何錯誤訊息。
    // new Date(naiveString) 在有時間部分時會依 ECMA-262 規範解讀成瀏覽器的
    // 本地時區，.toISOString() 再轉成明確帶 "Z" 後綴的 UTC 字串送出，後端
    // 才能正確還原使用者實際選擇的時間點。
    const toIsoOrNull = (value) => (value ? new Date(value).toISOString() : null);

    const buildPayload = () => ({
        ...form,
        title: form.title.trim(),
        body: form.body,
        link_url: form.link_url.trim(),
        display_date_text: form.display_date_text.trim(),
        pin_until: form.is_pinned ? form.pin_until : null,
        publish_at: toIsoOrNull(form.publish_at),
        unpublish_at: toIsoOrNull(form.unpublish_at),
    });

    const save = async (submitAfterSave) => {
        setError('');
        setSuccess('');

        if (!form.title.trim()) {
            setError('標題為必填');
            return;
        }
        if (form.is_pinned && !form.pin_until) {
            setError('開啟置頂時，置頂到期日為必填');
            return;
        }
        if (uploading) {
            setError('請等待封面圖上傳完成');
            return;
        }

        setSaving(true);

        try {
            // published 的儲存不直接改公告本身，也不需要再呼叫 submit：
            // 建立／更新 pending revision 本身就代表已提交等待審核。
            if (id && status === 'published') {
                await apiPost(
                    `/adminapi/announcements/${id}/pending-revision/`,
                    buildPayload(),
                );
                setSuccess('已提交修改，待審核核准後生效');
                return;
            }

            const saved = id
                ? await apiPatch(`/adminapi/announcements/${id}/`, buildPayload())
                : await apiPost('/adminapi/announcements/', buildPayload());
            const savedId = id || saved.id;

            if (submitAfterSave) {
                await apiPost(`/adminapi/announcements/${savedId}/submit/`);
                setStatus('pending_review');
                setSuccess('已儲存並送審');
            } else {
                setStatus(saved.status ?? status);
                setSuccess('公告已儲存');
            }

            if (!id) {
                navigate(`/admin/content/announcements/${savedId}`, { replace: true });
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="announcement-editor-loading">
                <Spinner animation="border" />
                <span>載入公告中…</span>
            </div>
        );
    }

    return (
        <main className="announcement-admin-page announcement-editor-page">
            <Link className="announcement-back-link" to="/admin/content/announcements">
                <ArrowLeft size={17} /> 返回公告列表
            </Link>

            <div className="announcement-page-heading">
                <div>
                    <h1>{id ? '編輯公告' : '新增公告'}</h1>
                    <p>
                        {id
                            ? `目前狀態：${STATUS_LABELS[status] ?? status}`
                            : '建立新的公告草稿'}
                        {source === 'crawler' && (
                            <Badge bg="info" className="ms-2">爬蟲匯入</Badge>
                        )}
                    </p>
                </div>
            </div>

            {!editable && (
                <Alert variant="warning">
                    目前為「{STATUS_LABELS[status] ?? status}」狀態，欄位暫時無法編輯。
                    {status === 'pending_review' && '送審中的公告請先撤回。'}
                    {statusEditable && !CONTENT_EDITORS.includes(role)
                        && '目前角色沒有內容編輯權限，無法在此狀態下修改。'}
                </Alert>
            )}

            {error && <Alert variant="danger">{error}</Alert>}
            {success && <Alert variant="success">{success}</Alert>}

            <Form
                className="announcement-editor-card"
                onSubmit={(event) => {
                    event.preventDefault();
                    save(false);
                }}
            >
                {/* controlId 讓 react-bootstrap 自動幫 Form.Label 跟底下的 Form.Control
                    產生對應的 htmlFor/id，沒有這個的話兩者不會有程式化關聯——螢幕閱讀器
                    唸不出欄位名稱，點文字標籤也無法聚焦到輸入框，是真的無障礙缺陷，
                    不是只有測試工具找不到而已。 */}
                <Form.Group className="announcement-field" controlId="announcement-title">
                    <Form.Label>
                        標題 <span className="required-mark">*</span>
                    </Form.Label>
                    <Form.Control
                        required
                        disabled={!editable}
                        value={form.title}
                        onChange={(e) => update('title', e.target.value)}
                    />
                </Form.Group>

                <Form.Group className="announcement-field" controlId="announcement-body">
                    <Form.Label>內文</Form.Label>
                    <Form.Control
                        as="textarea"
                        rows={10}
                        disabled={!editable}
                        value={form.body}
                        onChange={(e) => update('body', e.target.value)}
                    />
                </Form.Group>

                <div className="announcement-form-grid">
                    <Form.Group className="announcement-field" controlId="announcement-category">
                        <Form.Label>分類</Form.Label>
                        <Form.Select
                            disabled={!editable}
                            value={form.category}
                            onChange={(e) => update('category', e.target.value)}
                        >
                            {CATEGORIES.map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                            ))}
                        </Form.Select>
                    </Form.Group>

                    <Form.Group className="announcement-field" controlId="announcement-link">
                        <Form.Label>外部連結</Form.Label>
                        <Form.Control
                            type="url"
                            disabled={!editable}
                            value={form.link_url}
                            onChange={(e) => update('link_url', e.target.value)}
                            placeholder="https://"
                        />
                    </Form.Group>

                    {/* 純文字欄位而不是日期選擇器：爬蟲匯入的活動這裡可能是像
                        「115年8月1日」這種民國年中文日期，沒有對應的日期元件能表示。 */}
                    <Form.Group className="announcement-field" controlId="announcement-display-date">
                        <Form.Label>顯示日期文字（選填）</Form.Label>
                        <Form.Control
                            disabled={!editable}
                            value={form.display_date_text}
                            onChange={(e) => update('display_date_text', e.target.value)}
                            placeholder="例如：2026-08-01 ~ 2026-08-10"
                        />
                        <Form.Text>
                            爬蟲匯入的活動會自動帶入活動日期，也可以手動填寫或修改。
                        </Form.Text>
                    </Form.Group>
                </div>

                <fieldset className="announcement-field" disabled={!editable}>
                    <legend>適用族語</legend>
                    <div className="announcement-tribe-options">
                        <Form.Check
                            id="announcement-tribe-all"
                            type="checkbox"
                            label="全部族語"
                            checked={form.tribes.length === 0}
                            onChange={() => update('tribes', [])}
                        />
                        {TRIBE_OPTIONS.map(([value, label]) => (
                            <Form.Check
                                key={value}
                                id={`announcement-tribe-${value}`}
                                type="checkbox"
                                label={label}
                                checked={form.tribes.includes(value)}
                                onChange={() => toggleTribe(value)}
                            />
                        ))}
                    </div>
                    <Form.Text>全部不選即代表適用所有族語。</Form.Text>
                </fieldset>

                <Form.Group className="announcement-field" controlId="announcement-cover">
                    <Form.Label>封面圖</Form.Label>
                    <div className="announcement-cover-uploader">
                        {preview ? (
                            <img src={preview} alt="封面圖預覽" />
                        ) : (
                            <div className="announcement-cover-placeholder">
                                <ImagePlus size={30} />
                                <span>尚未選擇圖片</span>
                            </div>
                        )}
                        <div>
                            <Form.Control
                                type="file"
                                accept="image/*"
                                disabled={!editable || uploading}
                                onChange={handleFileChange}
                            />
                            {uploading && (
                                <span className="announcement-upload-status">
                                    <Spinner size="sm" /> 圖片上傳中…
                                </span>
                            )}
                        </div>
                    </div>
                </Form.Group>

                <div className="announcement-form-grid">
                    <Form.Group
                        className="announcement-field announcement-switch-field"
                        controlId="announcement-pinned"
                    >
                        <Form.Check
                            type="switch"
                            label="置頂公告"
                            disabled={!editable}
                            checked={form.is_pinned}
                            onChange={(e) => update('is_pinned', e.target.checked)}
                        />
                    </Form.Group>

                    {form.is_pinned && (
                        <Form.Group
                            className="announcement-field"
                            controlId="announcement-pin-until"
                        >
                            <Form.Label>
                                置頂到期日 <span className="required-mark">*</span>
                            </Form.Label>
                            <Form.Control
                                type="date"
                                required
                                disabled={!editable}
                                value={form.pin_until}
                                onChange={(e) => update('pin_until', e.target.value)}
                            />
                        </Form.Group>
                    )}
                </div>

                <div className="announcement-form-grid">
                    <Form.Group
                        className="announcement-field"
                        controlId="announcement-publish-at"
                    >
                        <Form.Label>排程發布時間</Form.Label>
                        <Form.Control
                            type="datetime-local"
                            disabled={!editable}
                            value={form.publish_at}
                            onChange={(e) => update('publish_at', e.target.value)}
                        />
                    </Form.Group>

                    <Form.Group
                        className="announcement-field"
                        controlId="announcement-unpublish-at"
                    >
                        <Form.Label>排程下架時間</Form.Label>
                        <Form.Control
                            type="datetime-local"
                            disabled={!editable}
                            value={form.unpublish_at}
                            onChange={(e) => update('unpublish_at', e.target.value)}
                        />
                    </Form.Group>
                </div>

                <div className="announcement-editor-actions">
                    <Button
                        as={Link}
                        variant="outline-secondary"
                        to="/admin/content/announcements"
                    >
                        取消
                    </Button>

                    {editable && (
                        status === 'published' ? (
                            <Button
                                type="submit"
                                variant="success"
                                disabled={saving || uploading}
                            >
                                <Send size={17} /> 提交修改
                            </Button>
                        ) : (
                            <>
                                <Button
                                    type="submit"
                                    variant="outline-primary"
                                    disabled={saving || uploading}
                                >
                                    <Save size={17} /> 儲存
                                </Button>
                                <Button
                                    type="button"
                                    variant="success"
                                    disabled={saving || uploading}
                                    onClick={() => save(true)}
                                >
                                    <Send size={17} /> 儲存並送審
                                </Button>
                            </>
                        )
                    )}
                </div>
            </Form>
        </main>
    );
}
