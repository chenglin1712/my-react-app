import { useEffect, useState } from 'react';
import { Alert, Button, Form, Spinner } from 'react-bootstrap';
import { Save } from 'lucide-react';
import { apiGet, apiPatch } from '../../../utils/apiClient';
import { useAuth } from '../../userServives/authContext';
import { useMediaUpload } from '../hooks/useMediaUpload';
import { useActionLock } from '../hooks/useActionLock';
import { formatApiError } from '../apiErrors';
import { formatDateTime } from '../adminFormat';
import RichTextEditor from '../components/RichTextEditor';
import { countDocText, hasDocContent } from '../../../components/_topic/richText';
import '../../../static/css/_admin/site-page-editor.css';

const PUBLISHERS = ['owner', 'admin'];
const MAX_CHARS = 50000;

// 空文件統一成 {}，與後端「沒有內容」的寫法一致，也避免只剩空段落的文件被當成有變動
const docOf = (content) => (hasDocContent(content) ? content : {});

/**
 * 後台維護公開說明頁（隱私與資料、聯絡我們）的正文。標題與導言固定在前台頁面，這裡只改正文。
 * 儲存後立即公開（後端不快取），所以和首頁設定一樣只開放給擁有者與管理員，其他角色唯讀。
 *
 * @param {string} props.endpoint    後台端點，例如 /adminapi/privacy-policy/
 * @param {string} props.title       頁面標題（也是後台選單名稱）
 * @param {string} props.publicPath  公開頁路徑，例如 /privacy
 * @param {string} [props.tip]       編輯提示，接在共同說明後面
 */
export default function SitePageEditor({ endpoint, title, publicPath, tip }) {
    const { userData } = useAuth();
    const editable = PUBLISHERS.includes(userData?.role);
    const [saved, setSaved] = useState(null);
    const [doc, setDoc] = useState({});
    const [metadata, setMetadata] = useState({ updated_by: '', updated_at: '' });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const media = useMediaUpload();
    const uploading = Boolean(media.uploadingKey);
    const saveLock = useActionLock();
    const saving = saveLock.isLocked;

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const item = await apiGet(endpoint);
                if (!active) return;
                const initial = docOf(item.content);
                setSaved(initial);
                setDoc(initial);
                setMetadata({ updated_by: item.updated_by ?? '', updated_at: item.updated_at ?? '' });
            } catch (err) { if (active) setError(formatApiError(err)); }
            finally { if (active) setLoading(false); }
        })();
        return () => { active = false; };
    }, [endpoint]);

    const chars = countDocText(doc);
    const tooLong = chars > MAX_CHARS;
    const dirty = saved !== null && JSON.stringify(docOf(doc)) !== JSON.stringify(saved);
    const empty = !hasDocContent(doc);

    const save = () => {
        setError(''); setSuccess('');
        if (uploading) { setError('請等待圖片上傳完成'); return undefined; }
        if (tooLong) { setError(`內文最多 ${MAX_CHARS} 字，目前 ${chars} 字`); return undefined; }
        const submitted = docOf(doc);
        return saveLock.runLocked('save', async () => {
            try {
                const result = await apiPatch(endpoint, { content: submitted, base_updated_at: metadata.updated_at });
                setSaved(docOf(result.content));
                setMetadata({ updated_by: result.updated_by ?? '', updated_at: result.updated_at ?? '' });
                setSuccess(`${title}已儲存，公開頁面立即生效`);
            } catch (err) { setError(formatApiError(err)); }
        });
    };

    if (loading) return <div className="site-page-loading"><Spinner animation="border" /><span>載入中…</span></div>;

    return (
        <main className="site-page-page">
            <div className="site-page-heading">
                <h1>{title}</h1>
                <p>編輯公開頁 {publicPath} 的正文。頁面標題與導言固定，儲存後立即對所有訪客生效。</p>
            </div>
            {!editable && (
                <Alert variant="info">你可以檢視目前公開中的內容；只有擁有者或管理員可以修改並儲存。</Alert>
            )}
            {(error || media.error) && <Alert variant="danger" role="alert">{error || media.error}</Alert>}
            {success && <Alert variant="success" role="status">{success}</Alert>}

            <Form
                className="site-page-card"
                noValidate
                onSubmit={(event) => { event.preventDefault(); save(); }}
            >
                <Form.Group controlId="site-page-content">
                    <Form.Label id="site-page-label">正文</Form.Label>
                    {saved !== null && (
                        <RichTextEditor
                            value={saved}
                            disabled={!editable || saving}
                            media={media}
                            labelledBy="site-page-label"
                            describedBy="site-page-hint"
                            onChange={setDoc}
                        />
                    )}
                    <Form.Text id="site-page-hint" className={tooLong ? 'site-page-over' : undefined}>
                        用「大標題」分段，條列用項目清單。{tip} 目前 {chars} 字（最多 {MAX_CHARS} 字）。
                        {empty && ' 內文是空的，公開頁會顯示「內容籌備中」。'}
                    </Form.Text>
                </Form.Group>

                <div className="site-page-footer">
                    <span>
                        最後更新：{metadata.updated_by || '尚無紀錄'}
                        {metadata.updated_at ? `・${formatDateTime(metadata.updated_at)}` : ''}
                    </span>
                    {editable && (
                        <Button type="submit" disabled={saving || uploading || !dirty || tooLong}>
                            <Save size={17} aria-hidden="true" /> {saving ? '儲存中…' : '儲存'}
                        </Button>
                    )}
                </div>
            </Form>
        </main>
    );
}
