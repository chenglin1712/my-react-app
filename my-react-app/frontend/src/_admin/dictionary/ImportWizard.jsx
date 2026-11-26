import {
    Link,
    useLocation,
    useParams,
} from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Form,
  Spinner,
} from 'react-bootstrap';
import AdminTable from '../components/AdminTable';
import { useAuth } from '../../userServives/authContext';
import {
    approveImportJob,
    autoCreateImportTaxonomies,
    preflightImportJob,
    rejectImportJob,
    submitImportJob,
    withdrawImportJob,
} from './dictionaryApi';
import { useImportWizard } from './useImportWizard';
import ImportPreflightReport, { ReportPagingControls } from './ImportPreflightReport';
import { useReportPaging } from './useReportPaging';
import { confirmAction } from '@components/ui/ConfirmDialog';
import AdminEmpty from '../components/AdminEmpty';
import '../../../static/css/_admin/dictionary.css';

const CONTENT_EDITORS = ['owner', 'admin', 'editor'];
const CONTENT_APPROVERS = ['owner', 'admin', 'reviewer'];

const JOB_STATUSES = {
    uploaded: { label: '已上傳', bg: 'secondary' },
    validated: { label: '已預檢', bg: 'info' },
    pending_review: { label: '審核中', bg: 'warning', text: 'dark' },
    applied: { label: '已套用', bg: 'success' },
    applied_with_errors: { label: '已套用（部分錯誤）', bg: 'warning', text: 'dark' },
    rejected: { label: '已退件', bg: 'danger' },
};

const OUTCOME_STATUSES = {
    applied: { label: '已套用', bg: 'success' },
    failed: { label: '失敗', bg: 'danger' },
    skipped: { label: '已略過', bg: 'secondary' },
};

const TAXONOMY_LABELS = {
    source: '來源', category: '分類', part_of_speech: '詞性', focus: '焦點',
};

function StatusBadge({ status }) {
    const meta = JOB_STATUSES[status] ?? { label: status || '未知', bg: 'secondary' };
    return <Badge bg={meta.bg} text={meta.text}>{meta.label}</Badge>;
}

function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('zh-TW');
}

function formatDetail(detail) {
    if (Array.isArray(detail)) return detail.join('；');
    if (detail === null || detail === undefined || detail === '') return '—';
    return String(detail);
}

const isFailedOutcome = (outcome) => outcome.outcome !== 'applied';

/** 套用結果表（稽核 FE7a-14：預設只看失敗／略過的列，每頁 100 列）。
 * 抽成元件是因為分頁狀態要用 hook，不能放在依狀態分支呼叫的 render 函式裡。 */
function ImportOutcomeTable({ outcomes }) {
    const paging = useReportPaging(outcomes, isFailedOutcome);

    return (
        <div className="dictionary-table-card">
            <ReportPagingControls paging={paging} problemLabel="失敗或略過" idPrefix="outcome" />
            <AdminTable label="套用結果" hover className="dictionary-table">
                <thead>
                    <tr>
                        <th>列號</th>
                        <th>詞形</th>
                        <th>結果</th>
                        <th>詳細資料</th>
                    </tr>
                </thead>
                <tbody>
                    {paging.rows.map(({ item: outcome, index }) => {
                        const meta = OUTCOME_STATUSES[outcome.outcome] ?? {
                            label: outcome.outcome || '未知', bg: 'secondary',
                        };

                        return (
                            <tr key={`${outcome.row ?? index}-${outcome.name ?? ''}-${index}`}>
                                <td>{outcome.row ?? index + 1}</td>
                                <td>{outcome.name || '—'}</td>
                                <td><Badge bg={meta.bg}>{meta.label}</Badge></td>
                                <td>
                                    <small className={outcome.outcome === 'applied' ? 'text-muted' : undefined}>
                                        {formatDetail(outcome.detail)}
                                    </small>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </AdminTable>
        </div>
    );
}

function formatCreatedTaxonomies(created = {}) {
    const messages = Object.entries(TAXONOMY_LABELS)
        .filter(([kind]) => created[kind]?.length > 0)
        .map(([kind, label]) => `${label}：${created[kind].join('、')}`);
    return messages.length > 0 ? `已建立${messages.join('；')}` : '沒有需要建立的缺漏主檔。';
}

export default function ImportWizard() {
    const { id } = useParams();
    const location = useLocation();
    const { userData } = useAuth();
    const role = userData?.role;

    const {
        taxonomies, tribeNames, selectedTribe, setSelectedTribe,
        jobs, job, selectedFile, parsedBundle,
        reviewComment, setReviewComment,
        loading, pendingAction, error, successMessage, setSuccessMessage,
        runJobAction, handleFileChange, upload, exportBundle,
    } = useImportWizard({ id });

    // 只在剛上傳完、從 upload() 導頁過來時才會有值，純粹是「上傳當下就偵測到
    // 的結構問題」的一次性顯示提示，不需要 setter——之後每次重新整理或
    // 直接進到這個網址都不會有 location.state，回退成沒有提示即可。
    const rowErrors = location.state?.rowErrors ?? {};

    const canEdit = CONTENT_EDITORS.includes(role);
    const canApprove = CONTENT_APPROVERS.includes(role);

    const renderSummary = () => (
        <Alert variant={job.error_count > 0 ? 'warning' : 'info'}>
            新增 {job.new_count ?? 0} 筆／更新 {job.update_count ?? 0} 筆／錯誤 {job.error_count ?? 0} 筆
        </Alert>
    );

    const renderValidated = () => (
        <section className="dictionary-editor-card">
            <h2>步驟三：預檢報告</h2>

            {renderSummary()}

            <ImportPreflightReport report={job.report} />

            {job.error_count > 0 && (
                <p className="text-muted mt-3">
                    有 {job.error_count} 筆錯誤資料在套用時將會被略過。
                </p>
            )}

            <div className="dictionary-editor-actions">
                {role === 'owner' && job.error_count > 0 && (
                    <Button
                        type="button"
                        variant="outline-primary"
                        disabled={Boolean(pendingAction)}
                        onClick={async () => {
                            // 稽核 FE7a-09：自動建立的主檔會直接寫進正式主檔表（不經送審），先確認
                            const confirmed = await confirmAction({
                                title: '自動建立缺漏主檔',
                                message: (
                                    <p className="mb-0">
                                        將依匯入檔直接在正式主檔中建立缺漏的來源、分類、詞性與焦點，
                                        不經送審；建立後若要移除需逐筆刪除或合併。確定要建立嗎？
                                    </p>
                                ),
                                confirmLabel: '建立缺漏主檔',
                            });
                            if (!confirmed) return;
                            await runJobAction('auto-create', async () => {
                                const result = await autoCreateImportTaxonomies(id);
                                setSuccessMessage(formatCreatedTaxonomies(result.created_taxonomies));
                                return result;
                            });
                        }}
                    >
                        {pendingAction === 'auto-create' && <Spinner animation="border" size="sm" />}
                        自動建立缺漏主檔
                    </Button>
                )}

                {canEdit && (
                    <>
                        <Button
                            type="button"
                            variant="outline-secondary"
                            disabled={Boolean(pendingAction)}
                            onClick={() => runJobAction('preflight', () => preflightImportJob(id), '預檢報告已更新。')}
                        >
                            {pendingAction === 'preflight' && <Spinner animation="border" size="sm" />}
                            重新預檢
                        </Button>

                        <Button
                            type="button"
                            disabled={Boolean(pendingAction)}
                            onClick={() => runJobAction('submit', () => submitImportJob(id), '匯入工作已送出審核。')}
                        >
                            {pendingAction === 'submit' && <Spinner animation="border" size="sm" />}
                            送出審核
                        </Button>
                    </>
                )}
            </div>
        </section>
    );

    const renderPendingReview = () => (
        <>
            <section className="dictionary-editor-card">
                <h2>審核中</h2>
                {renderSummary()}
                <ImportPreflightReport report={job.report} />

                {canEdit && (
                    <div className="dictionary-editor-actions">
                        <Button
                            type="button"
                            variant="outline-secondary"
                            disabled={Boolean(pendingAction)}
                            onClick={() => runJobAction('withdraw', () => withdrawImportJob(id), '匯入工作已撤回。')}
                        >
                            {pendingAction === 'withdraw' && <Spinner animation="border" size="sm" />}
                            撤回
                        </Button>
                    </div>
                )}
            </section>

            {canApprove && (
                <section className="dictionary-review-card">
                    <h2>審核匯入工作</h2>

                    <Form.Group controlId="dictionary-import-review-comment">
                        <Form.Label>審核意見</Form.Label>
                        <Form.Control
                            as="textarea"
                            rows={4}
                            value={reviewComment}
                            disabled={Boolean(pendingAction)}
                            onChange={(event) => setReviewComment(event.target.value)}
                        />
                        <Form.Text>核准時可留空；退件時必須填寫原因。</Form.Text>
                    </Form.Group>

                    <div className="dictionary-editor-actions">
                        <Button
                            type="button"
                            variant="success"
                            disabled={Boolean(pendingAction)}
                            onClick={async () => {
                                // 稽核 FE7a-09：核准會立即把整批資料寫入正式辭典且無法整批還原，確認文字帶出筆數
                                const confirmed = await confirmAction({
                                    title: '核准並套用匯入',
                                    message: (
                                        <p className="mb-0">
                                            核准後將立即寫入正式辭典：新增 {job.new_count ?? 0} 筆、
                                            更新 {job.update_count ?? 0} 筆，
                                            {job.error_count ?? 0} 筆錯誤資料會被略過。
                                            套用後無法整批還原，確定要核准嗎？
                                        </p>
                                    ),
                                    confirmLabel: '核准並套用',
                                });
                                if (!confirmed) return;
                                await runJobAction(
                                    'approve',
                                    () => approveImportJob(id, reviewComment),
                                    '匯入工作已核准並套用。',
                                );
                            }}
                        >
                            {pendingAction === 'approve' && <Spinner animation="border" size="sm" />}
                            核准
                        </Button>

                        <Button
                            type="button"
                            variant="danger"
                            disabled={Boolean(pendingAction) || !reviewComment.trim()}
                            onClick={() => runJobAction(
                                'reject',
                                () => rejectImportJob(id, reviewComment.trim()),
                                '匯入工作已退件。',
                            )}
                        >
                            {pendingAction === 'reject' && <Spinner animation="border" size="sm" />}
                            退件
                        </Button>
                    </div>
                </section>
            )}
        </>
    );

    const renderCompleted = () => {
        const outcomes = job.report?.outcomes ?? [];

        return (
            <section className="dictionary-editor-card">
                <h2>已完成</h2>

                <Alert variant={job.status === 'applied_with_errors' ? 'warning' : 'success'}>
                    成功套用 {job.applied_count ?? 0} 筆／失敗或略過 {job.failed_count ?? 0} 筆
                </Alert>

                {outcomes.length > 0 ? (
                    <ImportOutcomeTable outcomes={outcomes} />
                ) : (
                    <div className="dictionary-empty">尚未有套用結果</div>
                )}
            </section>
        );
    };

    const renderWizard = () => {
        if (!id) {
            return (
                <section className="dictionary-editor-card">
                    <h2>步驟一：上傳檔案</h2>

                    {!canEdit && (
                        <Alert variant="warning">目前角色沒有上傳匯入檔案的權限。</Alert>
                    )}

                    <Form.Group controlId="dictionary-import-file">
                        <Form.Label>JSON 匯入檔案</Form.Label>
                        <Form.Control
                            type="file"
                            accept=".json"
                            disabled={!canEdit || Boolean(pendingAction)}
                            onChange={handleFileChange}
                        />
                        <Form.Text>
                            {selectedFile ? `已選擇：${selectedFile.name}` : '請選擇一個 JSON 格式的辭典匯入檔案。'}
                        </Form.Text>
                    </Form.Group>

                    {canEdit && (
                        <div className="dictionary-editor-actions">
                            <Button
                                type="button"
                                disabled={!selectedFile || !parsedBundle || Boolean(pendingAction)}
                                onClick={upload}
                            >
                                {pendingAction === 'upload' && <Spinner animation="border" size="sm" />}
                                上傳
                            </Button>
                        </div>
                    )}
                </section>
            );
        }

        if (!job) {
            return <div className="dictionary-empty">找不到這筆匯入工作</div>;
        }

        switch (job.status) {
        case 'uploaded': {
            const rowErrorCount = Object.keys(rowErrors || {}).length;
            return (
                <section className="dictionary-editor-card">
                    <h2>步驟二：檢視解析結果</h2>

                    <p>檔案：{job.filename || '—'}</p>
                    <p>詞條數：{job.word_count ?? 0}</p>
                    {rowErrorCount > 0 && (
                        <Alert variant="warning">
                            有 {rowErrorCount} 筆詞條在上傳時就偵測到結構問題，預檢報告會列出詳細原因。
                        </Alert>
                    )}

                    {canEdit && (
                        <div className="dictionary-editor-actions">
                            <Button
                                type="button"
                                disabled={Boolean(pendingAction)}
                                onClick={() => runJobAction('preflight', () => preflightImportJob(id), '預檢已完成。')}
                            >
                                {pendingAction === 'preflight' && <Spinner animation="border" size="sm" />}
                                下一步：預檢
                            </Button>
                        </div>
                    )}
                </section>
            );
        }

        case 'validated':
            return renderValidated();

        case 'pending_review':
            return renderPendingReview();

        case 'applied':
        case 'applied_with_errors':
            return renderCompleted();

        case 'rejected':
            return (
                <section className="dictionary-danger-card">
                    <h2>已退件</h2>

                    <Alert variant="danger">
                        <strong>退件原因：</strong>
                        {' '}
                        {job.review_comment || '未提供退件原因'}
                    </Alert>

                    {renderSummary()}
                    <ImportPreflightReport report={job.report} />
                </section>
            );

        default:
            return <Alert variant="warning">未知的匯入工作狀態：{job.status}</Alert>;
        }
    };

    if (loading) {
        return (
            <main className="dictionary-admin-page">
                <div className="dictionary-loading">
                    <Spinner animation="border" />
                    <span>載入匯入工作中…</span>
                </div>
            </main>
        );
    }

    return (
        <main className="dictionary-admin-page">
            <div className="dictionary-page-heading">
                <div>
                    <h1>批次匯入／匯出</h1>
                    <p>上傳辭典資料、執行預檢並送交審核，或將指定族語的完整辭典匯出為 JSON。</p>
                </div>

                {id && (
                    <Button as={Link} to="/admin/dictionary/import">
                        + 新增匯入
                    </Button>
                )}
            </div>

            {error && <Alert variant="danger">{error}</Alert>}
            {successMessage && <Alert variant="success">{successMessage}</Alert>}

            {!id && (
                <section className="dictionary-editor-card">
                    <h2>匯出辭典</h2>

                    <div className="dictionary-form-grid">
                        <Form.Group controlId="dictionary-export-tribe">
                            <Form.Label>族語</Form.Label>
                            <Form.Select
                                value={selectedTribe}
                                disabled={Boolean(pendingAction)}
                                onChange={(event) => setSelectedTribe(event.target.value)}
                            >
                                {taxonomies.tribes.length === 0 && (
                                    <option value="">沒有可用的族語</option>
                                )}
                                {taxonomies.tribes.map((tribe) => (
                                    <option key={tribe.id} value={tribe.slug}>{tribe.name}</option>
                                ))}
                            </Form.Select>
                        </Form.Group>
                    </div>

                    <div className="dictionary-editor-actions">
                        <Button
                            type="button"
                            variant="outline-primary"
                            disabled={!selectedTribe || Boolean(pendingAction)}
                            onClick={exportBundle}
                        >
                            {pendingAction === 'export' && <Spinner animation="border" size="sm" />}
                            匯出
                        </Button>
                    </div>
                </section>
            )}

            <section className="dictionary-child-section">
                <div className="dictionary-child-heading">
                    <h2>近期匯入工作</h2>
                </div>

                {jobs.results.length > 0 ? (
                    <div className="dictionary-table-card">
                        <AdminTable label="近期匯入工作" hover className="dictionary-table">
                            <thead>
                                <tr>
                                    <th>檔名</th>
                                    <th>族語</th>
                                    <th>狀態</th>
                                    <th>上傳者</th>
                                    <th>上傳時間</th>
                                    <th>預檢摘要</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {jobs.results.map((item) => (
                                    <tr key={item.id}>
                                        <td>{item.filename || '—'}</td>
                                        <td>{tribeNames.get(String(item.tribe)) || item.tribe || '—'}</td>
                                        <td><StatusBadge status={item.status} /></td>
                                        <td>{item.uploaded_by || '—'}</td>
                                        <td>{formatDateTime(item.uploaded_at)}</td>
                                        <td>
                                            新增 {item.new_count ?? 0}／更新 {item.update_count ?? 0}／錯誤 {item.error_count ?? 0}
                                        </td>
                                        <td>
                                            <Button as={Link} variant="link" to={`/admin/dictionary/import/${item.id}`}>
                                                檢視
                                            </Button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </AdminTable>
                    </div>
                ) : (
                    <AdminEmpty title="目前沒有匯入工作" description="完成第一次匯入後，工作紀錄會顯示在這裡。" />
                )}
            </section>

            {renderWizard()}
        </main>
    );
}
