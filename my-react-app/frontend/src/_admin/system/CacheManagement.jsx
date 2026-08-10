import { useEffect, useState } from 'react';
import {
    Alert, Button, Spinner, Table,
} from 'react-bootstrap';
import { Database, RefreshCw, Trash2 } from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { apiGet, apiPost } from '../../../utils/apiClient';
import '../../../static/css/_admin/quiz-bank.css';
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
    const [clearing, setClearing] = useState('');
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
                if (active) setError(err.message);
            } finally {
                if (active) setLoading(false);
            }
        })();

        return () => {
            active = false;
        };
    }, []);

    const clearDjango = async () => {
        setError('');
        setSuccess('');
        setDetails([]);
        setClearing('django');

        try {
            const response = await apiPost(
                '/adminapi/system/cache/clear-django/',
                {},
            );
            setSuccess('已清除全部 Django 快取');
            setDetails(response.cleared_keys ?? []);
        } catch (err) {
            setError(err.message);
        } finally {
            setClearing('');
        }
    };

    const clearFastApi = async () => {
        setError('');
        setSuccess('');
        setDetails([]);
        setClearing('fastapi');

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
            setError(err.message);
        } finally {
            setClearing('');
        }
    };

    if (loading) {
        return (
            <div className="quiz-bank-loading">
                <Spinner animation="border" />
                <span>載入中…</span>
            </div>
        );
    }

    return (
        <main className="quiz-bank-admin-page">
            <div className="quiz-bank-page-heading">
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

                    <Table responsive hover className="quiz-bank-table">
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
                                    <td colSpan="2" className="quiz-bank-empty">
                                        尚無具名快取
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </Table>

                    {editable && (
                        <div className="system-action-card-footer">
                            <Button
                                variant="danger"
                                disabled={Boolean(clearing)}
                                onClick={clearDjango}
                            >
                                {clearing === 'django'
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
                                {clearing === 'fastapi'
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
