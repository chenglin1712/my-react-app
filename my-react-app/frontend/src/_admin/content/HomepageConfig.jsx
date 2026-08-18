import { useEffect, useState } from 'react';
import { Alert, Button, Form, Spinner } from 'react-bootstrap';
import { ImagePlus, Save } from 'lucide-react';
import { apiGet, apiPatch } from '../../../utils/apiClient';
import { uploadToCloudinary } from '@utils/uploadToCloudinary';
import { useAuth } from '../../userServives/authContext';
import '../../../static/css/_admin/homepage-config.css';

const PUBLISHERS = ['owner', 'admin'];
const EMPTY_FORM = {
    hero_image_url: '', hero_link_url: '', hero_title_override: '',
    show_news_section: true, show_calendar_section: true, news_display_count: 6,
    button1_enabled: true, button2_enabled: true, button3_enabled: true,
};

const formatDateTime = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? '—'
        : new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

export default function HomepageConfig() {
    const { userData } = useAuth();
    const role = userData?.role;
    const editable = PUBLISHERS.includes(role);
    const [form, setForm] = useState(EMPTY_FORM);
    const [metadata, setMetadata] = useState({ updated_by: '', updated_at: '' });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [preview, setPreview] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const item = await apiGet('/adminapi/homepage-config/');
                if (!active) return;
                setForm({
                    hero_image_url: item.hero_image_url ?? '', hero_link_url: item.hero_link_url ?? '',
                    hero_title_override: item.hero_title_override ?? '', show_news_section: Boolean(item.show_news_section),
                    show_calendar_section: Boolean(item.show_calendar_section), news_display_count: item.news_display_count ?? 6,
                    button1_enabled: Boolean(item.button1_enabled), button2_enabled: Boolean(item.button2_enabled),
                    button3_enabled: Boolean(item.button3_enabled),
                });
                setMetadata({ updated_by: item.updated_by ?? '', updated_at: item.updated_at ?? '' });
                setPreview(item.hero_image_url ?? '');
            } catch (err) { setError(err.message); }
            finally { if (active) setLoading(false); }
        })();
        return () => { active = false; };
    }, []);

    const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

    const handleFileChange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) { setError('圖片不得超過 5 MB，請重新選擇。'); return; }
        setError('');
        setPreview(URL.createObjectURL(file));
        setUploading(true);
        try {
            const secureUrl = await uploadToCloudinary(file);
            update('hero_image_url', secureUrl);
            setPreview(secureUrl);
        } catch (err) {
            console.error('圖片上傳失敗', err);
            setError('圖片上傳失敗');
        } finally { setUploading(false); }
    };

    const save = async () => {
        setError(''); setSuccess('');
        if (uploading) { setError('請等待主視覺圖片上傳完成'); return; }
        setSaving(true);
        try {
            const saved = await apiPatch('/adminapi/homepage-config/', {
                ...form,
                hero_link_url: form.hero_link_url.trim(),
                hero_title_override: form.hero_title_override.trim(),
                news_display_count: Number(form.news_display_count),
            });
            setForm((current) => ({ ...current, ...Object.fromEntries(Object.keys(EMPTY_FORM).map((key) => [key, saved[key]])) }));
            setMetadata({ updated_by: saved.updated_by ?? '', updated_at: saved.updated_at ?? '' });
            setPreview(saved.hero_image_url ?? '');
            setSuccess('首頁顯示設定已儲存');
        } catch (err) { setError(err.message); }
        finally { setSaving(false); }
    };

    if (loading) return <div className="homepage-config-loading"><Spinner animation="border" /><span>載入中…</span></div>;

    return (
        <main className="homepage-config-page">
            <div className="homepage-config-heading"><div><h1>首頁顯示設定</h1><p>調整公開首頁的主視覺、內容區塊與功能卡片</p></div></div>
            {!editable && <Alert variant="info">你可以檢視目前公開中的首頁設定；只有擁有者或管理員可以變更並儲存這些設定。</Alert>}
            {error && <Alert variant="danger">{error}</Alert>}{success && <Alert variant="success">{success}</Alert>}
            <Form className="homepage-config-card" onSubmit={(event) => { event.preventDefault(); save(); }}>
                <section className="homepage-config-section">
                    <div className="homepage-config-section-heading"><h2>主視覺卡片</h2><p>設定首頁焦點卡片的圖片、標題與點擊目的地。</p></div>
                    <Form.Group className="homepage-config-field" controlId="homepage-hero-image"><Form.Label>主視覺圖片</Form.Label><div className="homepage-config-uploader">{preview ? <img src={preview} alt="首頁主視覺預覽" /> : <div className="homepage-config-placeholder"><ImagePlus size={30} /><span>尚未選擇圖片</span></div>}<div><Form.Control type="file" accept="image/*" disabled={!editable || uploading} onChange={handleFileChange} />{uploading && <span className="homepage-config-upload-status"><Spinner size="sm" /> 圖片上傳中…</span>}<Form.Text>留白時，首頁會安全地沿用各族語原有的預設文字，不會顯示破圖。</Form.Text></div></div></Form.Group>
                    <div className="homepage-config-grid">
                        <Form.Group className="homepage-config-field" controlId="homepage-hero-title"><Form.Label>主視覺標題覆寫</Form.Label><Form.Control disabled={!editable} value={form.hero_title_override} onChange={(e) => update('hero_title_override', e.target.value)} /><Form.Text>選填；留白時使用各族語的預設標題。</Form.Text></Form.Group>
                        <Form.Group className="homepage-config-field" controlId="homepage-hero-link"><Form.Label>主視覺連結</Form.Label><Form.Control disabled={!editable} value={form.hero_link_url} onChange={(e) => update('hero_link_url', e.target.value)} placeholder="/quiz/select 或 https://example.com" /><Form.Text>選填；可填站內路徑或完整的外部網址。</Form.Text></Form.Group>
                    </div>
                </section>

                <section className="homepage-config-section">
                    <div className="homepage-config-section-heading"><h2>首頁內容區塊</h2><p>控制最新消息與考試日曆是否顯示。</p></div>
                    <div className="homepage-config-grid homepage-config-switch-grid">
                        <Form.Group className="homepage-config-field" controlId="homepage-show-news"><Form.Check id="homepage-show-news-switch" type="switch" label="顯示最新消息區塊" disabled={!editable} checked={form.show_news_section} onChange={(e) => update('show_news_section', e.target.checked)} /></Form.Group>
                        <Form.Group className="homepage-config-field" controlId="homepage-show-calendar"><Form.Check id="homepage-show-calendar-switch" type="switch" label="顯示考試日曆區塊" disabled={!editable} checked={form.show_calendar_section} onChange={(e) => update('show_calendar_section', e.target.checked)} /></Form.Group>
                    </div>
                    <Form.Group className="homepage-config-field homepage-config-count" controlId="homepage-news-count"><Form.Label>最新消息顯示筆數</Form.Label><Form.Control type="number" min="1" max="20" disabled={!editable} value={form.news_display_count} onChange={(e) => update('news_display_count', e.target.value)} /><Form.Text>首頁最新消息區塊一次顯示的項目數量。</Form.Text></Form.Group>
                </section>

                <section className="homepage-config-section">
                    <div className="homepage-config-section-heading"><h2>功能卡片</h2><p>分別控制首頁三張主要功能卡片是否顯示。</p></div>
                    <div className="homepage-config-feature-list">
                        <Form.Group controlId="homepage-button-1-group"><Form.Check id="homepage-button-1" type="switch" label="功能卡片 1：影像辨識" disabled={!editable} checked={form.button1_enabled} onChange={(e) => update('button1_enabled', e.target.checked)} /></Form.Group>
                        <Form.Group controlId="homepage-button-2-group"><Form.Check id="homepage-button-2" type="switch" label="功能卡片 2：詞彙遊戲" disabled={!editable} checked={form.button2_enabled} onChange={(e) => update('button2_enabled', e.target.checked)} /></Form.Group>
                        <Form.Group controlId="homepage-button-3-group"><Form.Check id="homepage-button-3" type="switch" label="功能卡片 3：測驗學習" disabled={!editable} checked={form.button3_enabled} onChange={(e) => update('button3_enabled', e.target.checked)} /></Form.Group>
                    </div>
                </section>

                <div className="homepage-config-footer"><span>最後更新：{metadata.updated_by || '尚無紀錄'}{metadata.updated_at ? `・${formatDateTime(metadata.updated_at)}` : ''}</span>{editable && <Button type="submit" disabled={saving || uploading}><Save size={17} /> {saving ? '儲存中…' : '儲存設定'}</Button>}</div>
            </Form>
        </main>
    );
}
