import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Spinner,
} from 'react-bootstrap';
import AdminTable from '../components/AdminTable';
import { Database, RefreshCw, Trash2 } from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { confirmAction } from '@components/ui/ConfirmDialog';
import { apiGet, apiPost } from '../../../utils/apiClient';
import { formatApiError } from '../apiErrors';
import { useActionLock } from '../hooks/useActionLock';
import '../../../static/css/_admin/system.css';

const PUBLISHERS = ['owner', 'admin'];
const STAFF_ROLES = ['owner', 'admin', 'editor', 'reviewer', 'analyst'];

const INVALIDATED_LABELS = {
    words: '辭典搜尋',
    grammar: '文法',
    grammar_affixes: '文法詞綴',
    grammar_quiz: '文法測驗',
};

export default function CacheManagement() {
    const { userData } = useAuth();
    const role = userData?.role;
    const editable = PUBLISHERS.includes(role);
    const canView = STAFF_ROLES.includes(role);

    const [djangoCaches, setDjangoCaches] = useState([]);
    const [loading, setLoading] = useState(true);
    // 兩顆清除按鈕互斥：同一個 tick 內連點或兩顆同時按，只有第一個會執行（稽核 FE7a-10）
    const clearLock = useActionLock();
    const clearing = clearLock.pendingKey ?? '';
    // WP-8 追加：確認步驟也在鎖裡（為了讓兩顆按鈕互斥），但確認視窗開著時還沒真的在清除，
    // 按鈕不該顯示轉圈圈；另記「正在確認」的是哪一顆，只有確認後才算清除中。
    const [confirmingKey, setConfirmingKey] = useState('');
    const isClearing = (key) => clearing === key && confirmingKey !== key;
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [details, setDetails] = useState([]);

    useEffect(() => {
        let active = true;

        (async () => {
            try {
                const response = await apiGet('/adminapi/system/cache/');
                if (active) setDjangoCaches(response.django_caches ?? []);
            } catch (err) {
                if (active) setError(formatApiError(err));
            } finally {
                if (active) setLoading(false);
            }
        })();

        return () => {
            active = false;
        };
    }, []);

    const clearDjango = () => clearLock.runLocked('django', async () => {
        // 清掉之後前台下一次請求會全部回源，說明影響範圍再讓使用者確認（稽核 FE7a-10）
        setConfirmingKey('django');
        const confirmed = await confirmAction({
            title: '清除全部 Django 快取',
            message: '清除後，辭典搜尋、文法等具名快取會立即失效，前台下一次請求會重新向資料庫查詢，短時間內回應可能變慢。確定要清除嗎？',
            confirmLabel: '清除快取',
        });
        setConfirmingKey('');
        if (!confirmed) return;

        setError('');
        setSuccess('');
        setDetails([]);

        try {
            const response = await apiPost(
                '/adminapi/system/cache/clear-django/',
                {},
            );
            setSuccess('已清除全部 Django 快取');
            setDetails(response.cleared_keys ?? []);
        } catch (err) {
            setError(formatApiError(err));
        }
    });

    const clearFastApi = () => clearLock.runLocked('fastapi', async () => {
        setConfirmingKey('fastapi');
        const confirmed = await confirmAction({
            title: '清除全部 FastAPI 快取',
            message: '清除後，辭典搜尋、文法與各遊戲的詞彙快取會立即失效並在背景重新預熱，預熱完成前相關功能的回應可能變慢。確定要清除嗎？',
            confirmLabel: '清除快取',
        });
        setConfirmingKey('');
        if (!confirmed) return;

        setError('');
        setSuccess('');
        setDetails([]);

        try {
            const response = await apiPost(
                '/adminapi/system/cache/clear-fastapi/',
                {},
            );
            const invalidated = response.result?.invalidated ?? {};
            setSuccess('已清除 FastAPI 快取（重新預熱：進行中）');
            setDetails(Object.entries(invalidated).map(([scope, count]) => (
                `${INVALIDATED_LABELS[scope] ?? scope}：${count}`
            )));
        } catch (err) {
            setError(formatApiError(err));
        }
    });

    if (loading) {
        return (
            <div className="admin-loading">
                <Spinner animation="border" />
                <span>載入中…</span>
            </div>
        );
    }

    return (
        <main className="admin-page system-page">
            <div className="admin-page-heading">
                <div>
                    <h1>快取管理</h1>
                    <p>清除具名快取，用於內容更新後立即生效</p>
                </div>
            </div>

            {!canView && (
                <Alert variant="danger">你的角色沒有權限檢視快取管理。</Alert>
            )}
            {!editable && canView && (
                <Alert variant="warning">
                    你可以檢視目前的快取項目；只有擁有者或管理員可以執行清除。
                </Alert>
            )}
            {error && <Alert variant="danger">{error}</Alert>}
            {success && (
                <Alert variant="success">
                    <div>{success}</div>
                    {details.length > 0 && (
                        <ul className="system-result-list">
                            {details.map((detail) => <li key={detail}>{detail}</li>)}
                        </ul>
                    )}
                </Alert>
            )}

            <div className="system-cache-grid">
                <section className="system-action-card">
                    <div className="system-action-card-heading">
                        <Database size={22} aria-hidden="true" />
                        <div>
                            <h2>Django 具名快取</h2>
                            <p>後台已知且可安全清除的 Django 快取項目。</p>
                        </div>
                    </div>

                    <AdminTable label="快取列表" hover className="admin-table">
                        <thead>
                            <tr>
                                <th>key</th>
                                <th>說明</th>
                            </tr>
                        </thead>
                        <tbody>
                            {djangoCaches.length > 0 ? djangoCaches.map((item) => (
                                <tr key={item.key}>
                                    <td><code>{item.key}</code></td>
                                    <td>{item.description}</td>
                                </tr>
                            )) : (
                                <tr>
                                    <td colSpan="2" className="admin-empty">
                                        尚無具名快取
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </AdminTable>

                    {editable && (
                        <div className="system-action-card-footer">
                            <Button
                                variant="danger"
                                disabled={Boolean(clearing)}
                                onClick={clearDjango}
                            >
                                {isClearing('django')
                                    ? <Spinner animation="border" size="sm" />
                                    : <Trash2 size={16} />}
                                清除全部 Django 快取
                            </Button>
                        </div>
                    )}
                </section>

                <section className="system-action-card">
                    <div className="system-action-card-heading">
                        <RefreshCw size={22} aria-hidden="true" />
                        <div>
                            <h2>FastAPI 快取</h2>
                            <p>
                                包含辭典搜尋、文法、聽力、句型、發音四個遊戲的詞彙快取；清除後會在背景自動重新預熱，不需要手動處理。
                            </p>
                        </div>
                    </div>

                    <div className="system-fastapi-note">
                        清除操作會通知 FastAPI 使目前快取失效，並排程背景預熱。
                    </div>

                    {editable && (
                        <div className="system-action-card-footer">
                            <Button
                                variant="warning"
                                disabled={Boolean(clearing)}
                                onClick={clearFastApi}
                            >
                                {isClearing('fastapi')
                                    ? <Spinner animation="border" size="sm" />
                                    : <Trash2 size={16} />}
                                清除全部 FastAPI 快取
                            </Button>
                        </div>
                    )}
                </section>
            </div>
        </main>
    );
}
