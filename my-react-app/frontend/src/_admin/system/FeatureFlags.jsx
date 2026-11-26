import { useEffect, useState } from 'react';
import {
  Alert,
  Form,
  Spinner,
} from 'react-bootstrap';
import AdminTable from '../components/AdminTable';
import { useAuth } from '../../userServives/authContext';
import { confirmAction } from '@components/ui/ConfirmDialog';
import { apiGet, apiPatch } from '../../../utils/apiClient';
import { formatApiError } from '../apiErrors';
import '../../../static/css/_admin/system.css';
import { SuccessNotice } from '../components/AdminToast';

const PUBLISHERS = ['owner', 'admin'];
const STAFF_ROLES = ['owner', 'admin', 'editor', 'reviewer', 'analyst'];

export default function FeatureFlags() {
    const { userData } = useAuth();
    const role = userData?.role;
    const editable = PUBLISHERS.includes(role);
    const canView = STAFF_ROLES.includes(role);

    const [items, setItems] = useState([]);
    const [savingIds, setSavingIds] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    useEffect(() => {
        let active = true;

        (async () => {
            try {
                const { results } = await apiGet('/adminapi/feature-flags/');
                if (active) setItems(results ?? []);
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

    const toggle = async (item, enabled) => {
        // 關閉功能會立刻影響前台使用者（測驗、翻譯回傳 403），先說明再執行；開啟不需要確認（稽核 FE7a-10）
        if (!enabled) {
            const confirmed = await confirmAction({
                title: `關閉「${item.label}」`,
                message: '關閉後會立即生效，前台使用這項功能的人會馬上被擋下。確定要關閉嗎？',
                confirmLabel: '關閉',
            });
            if (!confirmed) return;
        }
        const previousEnabled = item.enabled;

        setError('');
        setSuccess('');
        setSavingIds((current) => [...current, item.id]);
        setItems((current) => current.map((row) => (
            row.id === item.id ? { ...row, enabled } : row
        )));

        try {
            const saved = await apiPatch(
                `/adminapi/feature-flags/${item.id}/`,
                { enabled },
            );
            setItems((current) => current.map((row) => (
                row.id === item.id ? saved : row
            )));
            setSuccess(`已${saved.enabled ? '啟用' : '關閉'}「${saved.label}」`);
        } catch (err) {
            setItems((current) => current.map((row) => (
                row.id === item.id
                    ? { ...row, enabled: previousEnabled }
                    : row
            )));
            setError(formatApiError(err));
        } finally {
            setSavingIds((current) => current.filter((id) => id !== item.id));
        }
    };

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
                    <h1>功能開關</h1>
                    <p>各功能模組的啟用開關，可即時生效不需部署</p>
                </div>
            </div>

            <Alert variant="info">
目前真正接上判斷的開關有兩種：族語測驗總開關（關閉後，該族語的官方等級測驗與情境題會回傳 403，不是靜默顯示空題目）與族語翻譯總開關（關閉後，翻譯請求會回傳 403，不再呼叫 LLM）。
            </Alert>
            {!canView && (
                <Alert variant="danger">你的角色沒有權限檢視功能開關。</Alert>
            )}
            {!editable && canView && (
                <Alert variant="warning">
                    你可以檢視目前的功能開關；只有擁有者或管理員可以變更。
                </Alert>
            )}
            {error && <Alert variant="danger">{error}</Alert>}
            <SuccessNotice message={success} />

            <div className="admin-table-card">
                <AdminTable label="功能開關列表" hover className="admin-table system-feature-table">
                    <thead>
                        <tr>
                            <th>key</th>
                            <th>名稱</th>
                            <th>說明</th>
                            <th>啟用</th>
                            <th>最後更新</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.length > 0 ? items.map((item) => {
                            const saving = savingIds.includes(item.id);

                            return (
                                <tr key={item.id}>
                                    <td><code>{item.key}</code></td>
                                    <td>{item.label}</td>
                                    <td>{item.description || '—'}</td>
                                    <td>
                                        <div className="system-toggle-row">
                                            <Form.Check
                                                type="switch"
                                                id={`feature-flag-${item.id}`}
                                                aria-label={`${item.label} 功能開關`}
                                                checked={item.enabled}
                                                disabled={!editable || saving}
                                                onChange={(event) => toggle(
                                                    item,
                                                    event.target.checked,
                                                )}
                                            />
                                            <span>{item.enabled ? '已啟用' : '已關閉'}</span>
                                            {saving && (
                                                <Spinner animation="border" size="sm" />
                                            )}
                                        </div>
                                    </td>
                                    <td>{item.updated_by || '—'}</td>
                                </tr>
                            );
                        }) : (
                            <tr>
                                <td colSpan="5" className="admin-empty">
                                    尚無功能開關
                                </td>
                            </tr>
                        )}
                    </tbody>
                </AdminTable>
            </div>
        </main>
    );
}
