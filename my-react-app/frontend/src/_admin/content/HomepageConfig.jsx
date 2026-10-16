import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Spinner } from 'react-bootstrap';
import { ImagePlus, Save } from 'lucide-react';
import { apiGet, apiPatch } from '../../../utils/apiClient';
import { useAuth } from '../../userServives/authContext';
import { useMediaUpload } from '../hooks/useMediaUpload';
import { useActionLock } from '../hooks/useActionLock';
import { formatDateTime } from '../adminFormat';
import '../../../static/css/_admin/homepage-config.css';

const PUBLISHERS = ['owner', 'admin'];

// 上限與後端 HOMEPAGE_CONTRACT.md 一致；後端仍會再驗證一次，這裡只是讓錯誤在送出前就看得到。
const LIMITS = { marqueeItems: 10, marqueeItemChars: 40, tagline: 60, quote: 120 };

const EMPTY_FORM = {
    hero_image_url: '', hero_link_url: '', hero_title_override: '',
    marquee_items: '', show_marquee: true,
    tagline: '', show_tagline: true,
    quote_text: '', show_quote: true,
    show_news_section: true, show_calendar_section: true, news_display_count: 6,
    button1_enabled: true, button2_enabled: true, button3_enabled: true,
};
const FORM_FIELDS = Object.keys(EMPTY_FORM);

const countChars = (text) => Array.from(text ?? '').length;

// 跑馬燈在表單裡是「一行一則」的文字，送出時才轉成清單；空白行與前後空白會被整理掉。
const parseMarquee = (text) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

// 用既有值當 fallback（?? 而不是直接覆寫）：後端回應若漏帶某個欄位，
// 表單對應的欄位會被寫成 undefined，受控 input 就會失去原本的值。
const formFrom = (item, fallback = EMPTY_FORM) => Object.fromEntries(
    FORM_FIELDS.map((key) => {
        if (key === 'marquee_items') {
            return [key, Array.isArray(item?.marquee_items) ? item.marquee_items.join('\n') : fallback[key]];
        }
        return [key, item?.[key] ?? fallback[key]];
    }),
);

function validate(form) {
    const errors = {};
    const items = parseMarquee(form.marquee_items);
    if (items.length > LIMITS.marqueeItems) {
        errors.marquee_items = `最多 ${LIMITS.marqueeItems} 則，目前有 ${items.length} 則`;
    } else {
        const tooLong = items.findIndex((item) => countChars(item) > LIMITS.marqueeItemChars);
        if (tooLong >= 0) errors.marquee_items = `第 ${tooLong + 1} 則超過 ${LIMITS.marqueeItemChars} 字，請縮短`;
    }
    if (countChars(form.tagline.trim()) > LIMITS.tagline) errors.tagline = `標語最多 ${LIMITS.tagline} 字`;
    if (countChars(form.quote_text.trim()) > LIMITS.quote) errors.quote_text = `引言最多 ${LIMITS.quote} 字`;
    return errors;
}

function SwitchField({ id, label, hint, checked, disabled, onChange }) {
    return (
        <Form.Group className="homepage-config-switch" controlId={id}>
            <Form.Check
                type="switch"
                label={label}
                disabled={disabled}
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                aria-describedby={hint ? `${id}-hint` : undefined}
            />
            {hint && <Form.Text id={`${id}-hint`}>{hint}</Form.Text>}
        </Form.Group>
    );
}

export default function HomepageConfig() {
    const { userData } = useAuth();
    const role = userData?.role;
    const editable = PUBLISHERS.includes(role);
    const [form, setForm] = useState(EMPTY_FORM);
    const [metadata, setMetadata] = useState({ updated_by: '', updated_at: '' });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [showErrors, setShowErrors] = useState(false);
    const formRef = useRef(null);

    // 只有一份設定，沒有「切換編輯目標」的概念，resetKey 固定就好——這裡
    // 主要是要拿 generation/mounted 安全與物件網址清理，不是要在多個目標
    // 之間切換。
    const media = useMediaUpload();
    const uploading = Boolean(media.uploadingKey);
    const preview = media.previews.hero ?? '';

    // 儲存缺同步鎖只擋得住 disabled 屬性生效前的同一個 tick 內連點兩下，
    // 這裡只有一個「儲存設定」按鈕，用 useActionLock 一致地做，不用另外
    // 想理由。
    const saveLock = useActionLock();
    const saving = saveLock.isLocked;

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const item = await apiGet('/adminapi/homepage-config/');
                if (!active) return;
                setForm(formFrom(item));
                setMetadata({ updated_by: item.updated_by ?? '', updated_at: item.updated_at ?? '' });
                media.setPreview('hero', item.hero_image_url ?? '');
            } catch (err) { setError(err.message); }
            finally { if (active) setLoading(false); }
        })();
        return () => { active = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
    const errors = validate(form);
    // 欄位驗證摘要由目前的欄位狀態推導，修正完就自動消失；API 錯誤另放在 error
    const validationSummary = showErrors && Object.keys(errors).length > 0 ? '有欄位需要修正，請看標示的欄位' : '';
    const fieldError = (field) => (showErrors ? errors[field] : undefined);
    const describedBy = (id, field) => (fieldError(field) ? `${id}-error ${id}-hint` : `${id}-hint`);

    const handleFileChange = (event) => {
        const file = event.target.files[0];
        media.upload(file, 'hero', {
            localPreview: true,
            onUploaded: (secureUrl) => update('hero_image_url', secureUrl),
        });
    };

    const save = () => {
        setError(''); setSuccess('');
        if (uploading) { setError('請等待主視覺圖片上傳完成'); return undefined; }
        if (Object.keys(errors).length > 0) {
            setShowErrors(true);
            // 等錯誤標示畫出來後，把焦點帶到第一個有問題的欄位
            requestAnimationFrame(() => formRef.current?.querySelector('[aria-invalid="true"]')?.focus());
            return undefined;
        }

        const submitted = form;
        return saveLock.runLocked('save', async () => {
            try {
                const saved = await apiPatch('/adminapi/homepage-config/', {
                    ...form,
                    hero_link_url: form.hero_link_url.trim(),
                    hero_title_override: form.hero_title_override.trim(),
                    marquee_items: parseMarquee(form.marquee_items),
                    tagline: form.tagline.trim(),
                    quote_text: form.quote_text.trim(),
                    news_display_count: Number(form.news_display_count),
                });
                // 儲存期間使用者若又改了欄位，不拿回應蓋掉他的新輸入
                setForm((current) => (current === submitted ? formFrom(saved, current) : current));
                setMetadata({ updated_by: saved.updated_by ?? '', updated_at: saved.updated_at ?? '' });
                media.setPreview('hero', saved.hero_image_url ?? '');
                setShowErrors(false);
                setSuccess('首頁顯示設定已儲存');
            } catch (err) { setError(err.message); }
        });
    };

    if (loading) return <div className="homepage-config-loading"><Spinner animation="border" /><span>載入中…</span></div>;

    const marqueeCount = parseMarquee(form.marquee_items).length;

    return (
        <main className="homepage-config-page">
            <div className="homepage-config-heading">
                <div>
                    <h1>首頁顯示設定</h1>
                    <p>調整公開首頁的宣傳區、跑馬燈與標語，以及各區塊與功能卡片的顯示</p>
                </div>
            </div>
            {!editable && (
                <Alert variant="info">
                    你可以檢視目前公開中的首頁設定；只有擁有者或管理員可以變更並儲存這些設定。
                </Alert>
            )}
            {(error || media.error || validationSummary) && (
                <Alert variant="danger" role="alert">{error || media.error || validationSummary}</Alert>
            )}
            {success && <Alert variant="success" role="status">{success}</Alert>}

            <Form
                ref={formRef}
                className="homepage-config-card"
                noValidate
                onSubmit={(event) => {
                    event.preventDefault();
                    save();
                }}
            >
                <section className="homepage-config-section" aria-labelledby="homepage-config-promo">
                    <div className="homepage-config-section-heading">
                        <h2 id="homepage-config-promo">宣傳區</h2>
                        <p>首頁最上方的主打圖卡。沒有啟用宣傳影片時，宣傳區會改顯示這張圖卡。</p>
                    </div>
                    <Form.Group className="homepage-config-field" controlId="homepage-hero-image">
                        <Form.Label>主視覺圖片</Form.Label>
                        <div className="homepage-config-uploader">
                            {preview ? (
                                <img src={preview} alt="首頁主視覺預覽" />
                            ) : (
                                <div className="homepage-config-placeholder">
                                    <ImagePlus size={30} aria-hidden="true" />
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
                                    <span className="homepage-config-upload-status" role="status">
                                        <Spinner size="sm" /> 圖片上傳中…
                                    </span>
                                )}
                                <Form.Text>
                                    留白，或圖片網址無法載入時，首頁會改顯示各族語的預設圖，不會出現破圖。圖片網址必須以 https:// 開頭。
                                </Form.Text>
                            </div>
                        </div>
                    </Form.Group>
                    <div className="homepage-config-grid">
                        <Form.Group className="homepage-config-field" controlId="homepage-hero-title">
                            <Form.Label>主視覺標題覆寫</Form.Label>
                            <Form.Control
                                disabled={!editable}
                                value={form.hero_title_override}
                                onChange={(e) => update('hero_title_override', e.target.value)}
                            />
                            <Form.Text>選填；留白時使用各族語的預設標題。</Form.Text>
                        </Form.Group>
                        <Form.Group className="homepage-config-field" controlId="homepage-hero-link">
                            <Form.Label>主視覺連結</Form.Label>
                            <Form.Control
                                disabled={!editable}
                                value={form.hero_link_url}
                                onChange={(e) => update('hero_link_url', e.target.value)}
                                placeholder="/quiz/select 或 https://example.com"
                            />
                            <Form.Text>選填；可填站內路徑（以 / 開頭）或 https:// 開頭的外部網址。</Form.Text>
                        </Form.Group>
                    </div>
                </section>

                <section className="homepage-config-section" aria-labelledby="homepage-config-text">
                    <div className="homepage-config-section-heading">
                        <h2 id="homepage-config-text">跑馬燈與標語</h2>
                        <p>首頁報頭的文字。內容留白，或關掉開關，首頁就不會顯示那一項，也不會留下空位。</p>
                    </div>

                    <Form.Group className="homepage-config-field" controlId="homepage-marquee-items">
                        <Form.Label>跑馬燈內容</Form.Label>
                        <Form.Control
                            as="textarea"
                            rows={5}
                            disabled={!editable}
                            value={form.marquee_items}
                            onChange={(e) => update('marquee_items', e.target.value)}
                            isInvalid={Boolean(fieldError('marquee_items'))}
                            aria-invalid={Boolean(fieldError('marquee_items'))}
                            aria-describedby={describedBy('homepage-marquee-items', 'marquee_items')}
                        />
                        <Form.Control.Feedback type="invalid" id="homepage-marquee-items-error">{fieldError('marquee_items')}</Form.Control.Feedback>
                        <Form.Text id="homepage-marquee-items-hint">
                            一行一則，最多 {LIMITS.marqueeItems} 則，每則最多 {LIMITS.marqueeItemChars} 字（目前 {marqueeCount} 則）。
                            只會顯示純文字，不支援連結或格式。
                        </Form.Text>
                    </Form.Group>
                    <SwitchField
                        id="homepage-show-marquee"
                        label="顯示跑馬燈"
                        hint="關閉後內容仍會保留，重新開啟即再次公開。"
                        checked={form.show_marquee}
                        disabled={!editable}
                        onChange={(value) => update('show_marquee', value)}
                    />

                    <Form.Group className="homepage-config-field" controlId="homepage-tagline">
                        <Form.Label>標語</Form.Label>
                        <Form.Control
                            disabled={!editable}
                            value={form.tagline}
                            onChange={(e) => update('tagline', e.target.value)}
                            isInvalid={Boolean(fieldError('tagline'))}
                            aria-invalid={Boolean(fieldError('tagline'))}
                            aria-describedby={describedBy('homepage-tagline', 'tagline')}
                        />
                        <Form.Control.Feedback type="invalid" id="homepage-tagline-error">{fieldError('tagline')}</Form.Control.Feedback>
                        <Form.Text id="homepage-tagline-hint">
                            單行，最多 {LIMITS.tagline} 字（目前 {countChars(form.tagline.trim())} 字）。
                        </Form.Text>
                    </Form.Group>
                    <SwitchField
                        id="homepage-show-tagline"
                        label="顯示標語"
                        checked={form.show_tagline}
                        disabled={!editable}
                        onChange={(value) => update('show_tagline', value)}
                    />

                    <Form.Group className="homepage-config-field" controlId="homepage-quote">
                        <Form.Label>報頭引言</Form.Label>
                        <Form.Control
                            disabled={!editable}
                            value={form.quote_text}
                            onChange={(e) => update('quote_text', e.target.value)}
                            isInvalid={Boolean(fieldError('quote_text'))}
                            aria-invalid={Boolean(fieldError('quote_text'))}
                            aria-describedby={describedBy('homepage-quote', 'quote_text')}
                        />
                        <Form.Control.Feedback type="invalid" id="homepage-quote-error">{fieldError('quote_text')}</Form.Control.Feedback>
                        <Form.Text id="homepage-quote-hint">
                            單行，最多 {LIMITS.quote} 字（目前 {countChars(form.quote_text.trim())} 字）。顯示在首頁報頭中間。
                        </Form.Text>
                    </Form.Group>
                    <SwitchField
                        id="homepage-show-quote"
                        label="顯示報頭引言"
                        checked={form.show_quote}
                        disabled={!editable}
                        onChange={(value) => update('show_quote', value)}
                    />
                </section>

                <section className="homepage-config-section" aria-labelledby="homepage-config-switches">
                    <div className="homepage-config-section-heading">
                        <h2 id="homepage-config-switches">顯示開關</h2>
                        <p>控制首頁的內容區塊與三張功能卡片是否出現。</p>
                    </div>
                    <div className="homepage-config-switch-list">
                        <SwitchField
                            id="homepage-show-news"
                            label="顯示最新消息區塊"
                            checked={form.show_news_section}
                            disabled={!editable}
                            onChange={(value) => update('show_news_section', value)}
                        />
                        <SwitchField
                            id="homepage-show-calendar"
                            label="顯示族語認證最新公告區塊"
                            hint="首頁的族語認證公告，內容在公告管理維護。"
                            checked={form.show_calendar_section}
                            disabled={!editable}
                            onChange={(value) => update('show_calendar_section', value)}
                        />
                        <SwitchField
                            id="homepage-button-1"
                            label="功能卡片 1：影像辨識"
                            checked={form.button1_enabled}
                            disabled={!editable}
                            onChange={(value) => update('button1_enabled', value)}
                        />
                        <SwitchField
                            id="homepage-button-2"
                            label="功能卡片 2：詞彙遊戲"
                            checked={form.button2_enabled}
                            disabled={!editable}
                            onChange={(value) => update('button2_enabled', value)}
                        />
                        <SwitchField
                            id="homepage-button-3"
                            label="功能卡片 3：測驗學習"
                            checked={form.button3_enabled}
                            disabled={!editable}
                            onChange={(value) => update('button3_enabled', value)}
                        />
                    </div>
                    <Form.Group className="homepage-config-field homepage-config-count" controlId="homepage-news-count">
                        <Form.Label>最新消息顯示筆數</Form.Label>
                        <Form.Control
                            type="number"
                            min="1"
                            max="20"
                            disabled={!editable}
                            value={form.news_display_count}
                            onChange={(e) => update('news_display_count', e.target.value)}
                        />
                        <Form.Text>首頁最新消息區塊一次顯示的項目數量（1 到 20）。</Form.Text>
                    </Form.Group>
                </section>

                <div className="homepage-config-footer">
                    <span>
                        最後更新：{metadata.updated_by || '尚無紀錄'}
                        {metadata.updated_at ? `・${formatDateTime(metadata.updated_at)}` : ''}
                    </span>
                    {editable && (
                        <Button type="submit" disabled={saving || uploading}>
                            <Save size={17} aria-hidden="true" /> {saving ? '儲存中…' : '儲存設定'}
                        </Button>
                    )}
                </div>
            </Form>
        </main>
    );
}
