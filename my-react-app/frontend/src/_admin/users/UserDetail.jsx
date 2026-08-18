import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Form,
  Spinner,
} from 'react-bootstrap';
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Download,
  Edit3,
  KeyRound,
  LogOut,
  Shield,
  Trash2,
  User,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import {
  ACCOUNT_MANAGERS,
  ROLE_ASSIGNERS,
  ROLE_LABELS,
  STAFF_ROLES,
} from '../constants/roles';
import DeleteAccountModal from './DeleteAccountModal';
import PasswordChangeModal from './PasswordChangeModal';
import ProfileEditModal from './ProfileEditModal';
import { useUserDetail } from './useUserDetail';
import '../../../static/css/_admin/users.css';

const CONTENT_COUNT_LABELS = {
  shared_notes: '分享筆記',
  pronunciations: '發音錄音',
};

const DELETE_RESULT_LABELS = {
  shared_notes: '分享筆記',
  pronunciations: '發音錄音',
  firestore_user_document: 'Firestore 使用者文件',
  firebase_auth: 'Firebase Auth 帳號',
};

const formatDateTime = (value) => (
  value
    ? new Intl.DateTimeFormat('zh-TW', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
    : '—'
);

const formatEpochTime = (value) => (
  value != null ? formatDateTime(Number(value)) : '—'
);

const formatFirestoreValue = (value) => {
  if (value == null) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return JSON.stringify(value, null, 2);
};

const deleteItemSucceeded = (key, result) => {
  if (!result || result.error) return false;

  if (key === 'shared_notes' || key === 'pronunciations') {
    // pronunciations 的 Storage 音檔清除失敗時，Firestore 文件雖然已經刪除，
    // 但留下孤兒音檔需要人工到 Storage 主控台複查——不能算乾淨成功。
    if ((result.storage_cleanup_failed ?? 0) > 0) return false;
    return typeof result.deleted === 'number';
  }

  return result.deleted === true;
};

const describeDeleteResult = (key, result) => {
  if (!result) return '未回傳處理結果';
  if (result.error) return result.error;

  if (key === 'shared_notes' || key === 'pronunciations') {
    const base = `已刪除 ${result.deleted ?? 0} 筆`;
    if ((result.storage_cleanup_failed ?? 0) > 0) {
      return `${base}（其中 ${result.storage_cleanup_failed} 筆音檔清除失敗，需人工到 Storage 複查）`;
    }
    return base;
  }

  return result.deleted ? '已刪除' : '未刪除';
};

export default function UserDetail() {
  const { uid } = useParams();
  const { userData } = useAuth();
  const role = userData?.role;

  const canViewUser = STAFF_ROLES.includes(role);
  const canAssignRole = ROLE_ASSIGNERS.includes(role);
  const canManageAccount = ACCOUNT_MANAGERS.includes(role);

  const {
    user, loading, error, setError, successMessage, setSuccessMessage,
    action, selectedRole, setSelectedRole,
    deleteResults, setDeleteResults,
    loadUser, assignRole, toggleSuspension, forceLogout, exportUser,
  } = useUserDetail({ uid, canViewUser });

  // 三個對話框各自持有自己的表單狀態（見各元件說明），這裡只留「開/關」。
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const openProfileModal = () => { setError(''); setShowProfileModal(true); };
  const openPasswordModal = () => { setError(''); setShowPasswordModal(true); };
  const openDeleteModal = () => { setError(''); setShowDeleteModal(true); };

  const handleProfileSaved = async (message) => {
    setShowProfileModal(false);
    setSuccessMessage(message);
    await loadUser();
  };

  const handlePasswordSaved = (message) => {
    setShowPasswordModal(false);
    setSuccessMessage(message);
  };

  const handleAccountDeleted = (results) => {
    setShowDeleteModal(false);
    setDeleteResults(results);
  };


  if (!canViewUser) {
    return (
      <main className="user-admin-page user-detail-page">
        <Alert variant="danger">
          目前帳號沒有檢視使用者資料的權限。
        </Alert>
        <Button as={Link} to="/admin/users" variant="outline-secondary">
          <ArrowLeft size={16} />
          返回使用者列表
        </Button>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="user-admin-page user-detail-page">
        <div className="user-loading">
          <Spinner animation="border" size="sm" />
          載入使用者資料中……
        </div>
      </main>
    );
  }

  if (deleteResults) {
    return (
      <main className="user-admin-page user-detail-page">
        <div className="user-page-heading">
          <div>
            <h1>帳號刪除結果</h1>
            <p>UID：{uid}</p>
          </div>
        </div>

        <Alert variant="warning">
          各系統的刪除作業彼此獨立，請確認以下每一項結果。
        </Alert>

        <section className="user-detail-card">
          <h2>處理結果</h2>

          <div className="user-delete-results">
            {Object.entries(DELETE_RESULT_LABELS).map(([key, label]) => {
              const result = deleteResults[key];
              const succeeded = deleteItemSucceeded(key, result);

              return (
                <div
                  className={`user-delete-result ${
                    succeeded ? 'is-success' : 'is-failure'
                  }`}
                  key={key}
                >
                  {succeeded ? (
                    <CheckCircle2 size={20} aria-hidden="true" />
                  ) : (
                    <XCircle size={20} aria-hidden="true" />
                  )}

                  <div>
                    <strong>{label}</strong>
                    <span>{describeDeleteResult(key, result)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="user-detail-footer">
            <Button as={Link} to="/admin/users">
              <ArrowLeft size={16} />
              返回使用者列表
            </Button>
          </div>
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="user-admin-page user-detail-page">
        {error && <Alert variant="danger">{error}</Alert>}
        <Button as={Link} to="/admin/users" variant="outline-secondary">
          <ArrowLeft size={16} />
          返回使用者列表
        </Button>
      </main>
    );
  }

  const canManageTarget = (
    canManageAccount
    && (user.role !== 'owner' || role === 'owner')
  );

  return (
    <main className="user-admin-page user-detail-page">
      <Link className="user-back-link" to="/admin/users">
        <ArrowLeft size={16} />
        返回使用者列表
      </Link>

      <div className="user-page-heading">
        <div className="user-detail-heading">
          {user.avatar_url ? (
            <img
              className="user-detail-avatar"
              src={user.avatar_url}
              alt=""
            />
          ) : (
            <span className="user-detail-avatar user-avatar-placeholder">
              <User size={30} aria-hidden="true" />
            </span>
          )}

          <div>
            <h1>{user.name || user.email || user.uid}</h1>
            <p>{user.uid}</p>
          </div>
        </div>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      {successMessage && (
        <Alert
          variant="success"
          dismissible
          onClose={() => setSuccessMessage('')}
        >
          {successMessage}
        </Alert>
      )}

      <section className="user-detail-card">
        <h2>基本資料</h2>

        <dl className="user-detail-grid">
          <div>
            <dt>Email</dt>
            <dd>
              {user.email || '—'}
              <Badge
                className="user-inline-badge"
                bg={user.email_verified ? 'success' : 'secondary'}
              >
                {user.email_verified ? '已驗證' : '未驗證'}
              </Badge>
            </dd>
          </div>

          <div>
            <dt>帳號狀態</dt>
            <dd>
              <Badge bg={user.disabled ? 'danger' : 'success'}>
                {user.disabled ? '已停權' : '正常'}
              </Badge>
            </dd>
          </div>

          <div>
            <dt>後台角色</dt>
            <dd>
              <Badge bg={user.role ? 'primary' : 'secondary'}>
                {user.role
                  ? ROLE_LABELS[user.role] || user.role
                  : '一般使用者'}
              </Badge>
            </dd>
          </div>

          <div>
            <dt>身分</dt>
            <dd>{user.identity || '—'}</dd>
          </div>

          <div>
            <dt>加入日期</dt>
            <dd>{formatDateTime(user.join_date)}</dd>
          </div>

          <div>
            <dt>Firebase 帳號建立時間</dt>
            <dd>{formatEpochTime(user.created_at)}</dd>
          </div>

          <div>
            <dt>最後登入時間</dt>
            <dd>{formatEpochTime(user.last_sign_in_at)}</dd>
          </div>

          <div>
            <dt>登入方式</dt>
            <dd>
              {user.provider_ids?.length
                ? user.provider_ids.join('、')
                : '—'}
            </dd>
          </div>
        </dl>
      </section>

      <section className="user-detail-card">
        <h2>產出內容</h2>

        <div className="user-count-grid">
          {Object.entries(CONTENT_COUNT_LABELS).map(([key, label]) => (
            <div className="user-count-card" key={key}>
              <strong>{user.content_counts?.[key] ?? 0}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="user-detail-card">
        <h2>Firestore 原始資料</h2>

        {user.firestore
          && Object.keys(user.firestore).length > 0 ? (
            <dl className="user-firestore-list">
              {Object.entries(user.firestore).map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>
                    <pre>{formatFirestoreValue(value)}</pre>
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="user-muted-text">沒有 Firestore 使用者文件。</p>
          )}
      </section>

      {(canAssignRole || canManageAccount) && (
        <section className="user-detail-card">
          <h2>帳號操作</h2>

          {canAssignRole && (
            <div className="user-action-section">
              <div>
                <h3>
                  <Shield size={18} />
                  角色指派
                </h3>
                <p>設定此帳號可以使用的後台角色。</p>
              </div>

              <div className="user-role-control">
                <Form.Select
                  aria-label="新角色"
                  value={selectedRole}
                  disabled={Boolean(action)}
                  onChange={(event) => setSelectedRole(event.target.value)}
                >
                  <option value="">移除角色</option>
                  {STAFF_ROLES.map((value) => (
                    <option key={value} value={value}>
                      {ROLE_LABELS[value]}
                    </option>
                  ))}
                </Form.Select>

                <Button
                  disabled={Boolean(action) || selectedRole === (user.role ?? '')}
                  onClick={assignRole}
                >
                  {action === 'role' ? (
                    <Spinner animation="border" size="sm" />
                  ) : (
                    <Shield size={16} />
                  )}
                  更新角色
                </Button>
              </div>
            </div>
          )}

          {canManageAccount && (
            <>
              {canManageTarget && (
                <>
                  <div className="user-action-section">
                    <div>
                      <h3>
                        <Edit3 size={18} />
                        編輯資料
                      </h3>
                      <p>更新姓名、身分、頭像網址或 Email。</p>
                    </div>

                    <Button
                      variant="outline-primary"
                      disabled={Boolean(action)}
                      onClick={openProfileModal}
                    >
                      <Edit3 size={16} />
                      編輯
                    </Button>
                  </div>

                  <div className="user-action-section">
                    <div>
                      <h3>
                        <KeyRound size={18} />
                        變更密碼
                      </h3>
                      <p>此操作會立即撤銷此帳號現有的登入狀態。</p>
                    </div>

                    <Button
                      variant="outline-danger"
                      disabled={Boolean(action)}
                      onClick={openPasswordModal}
                    >
                      <KeyRound size={16} />
                      變更密碼
                    </Button>
                  </div>
                </>
              )}

              <div className="user-action-section">
                <div>
                  <h3>
                    {user.disabled ? (
                      <UserCheck size={18} />
                    ) : (
                      <Ban size={18} />
                    )}
                    {user.disabled ? '解除停權' : '停權帳號'}
                  </h3>
                  <p>
                    {user.disabled
                      ? '恢復這個帳號的登入權限。'
                      : '阻止這個帳號繼續登入平台。'}
                  </p>
                </div>

                <Button
                  variant={user.disabled ? 'outline-success' : 'outline-danger'}
                  disabled={Boolean(action)}
                  onClick={toggleSuspension}
                >
                  {action === 'suspend' || action === 'unsuspend' ? (
                    <Spinner animation="border" size="sm" />
                  ) : user.disabled ? (
                    <UserCheck size={16} />
                  ) : (
                    <Ban size={16} />
                  )}
                  {user.disabled ? '解除停權' : '停權帳號'}
                </Button>
              </div>

              <div className="user-action-section">
                <div>
                  <h3>
                    <LogOut size={18} />
                    強制登出
                  </h3>
                  <p>撤銷既有登入憑證，要求使用者重新登入。</p>
                </div>

                <Button
                  variant="outline-secondary"
                  disabled={Boolean(action)}
                  onClick={forceLogout}
                >
                  {action === 'force-logout' ? (
                    <Spinner animation="border" size="sm" />
                  ) : (
                    <LogOut size={16} />
                  )}
                  強制登出
                </Button>
              </div>

              <div className="user-action-section">
                <div>
                  <h3>
                    <Download size={18} />
                    匯出個資
                  </h3>
                  <p>下載包含此使用者資料的 JSON 檔案。</p>
                </div>

                <Button
                  variant="outline-primary"
                  disabled={Boolean(action)}
                  onClick={exportUser}
                >
                  {action === 'export' ? (
                    <Spinner animation="border" size="sm" />
                  ) : (
                    <Download size={16} />
                  )}
                  匯出個資
                </Button>
              </div>

              <div className="user-action-section user-danger-zone">
                <div>
                  <h3>
                    <Trash2 size={18} />
                    刪除帳號
                  </h3>
                  <p>刪除帳號及相關資料，此操作無法復原。</p>
                </div>

                <Button
                  variant="danger"
                  disabled={Boolean(action)}
                  onClick={openDeleteModal}
                >
                  <Trash2 size={16} />
                  刪除帳號
                </Button>
              </div>
            </>
          )}
        </section>
      )}

      {showProfileModal && (
        <ProfileEditModal
          show={showProfileModal}
          user={user}
          uid={uid}
          onClose={() => setShowProfileModal(false)}
          onSaved={handleProfileSaved}
          onError={setError}
        />
      )}

      {showPasswordModal && (
        <PasswordChangeModal
          show={showPasswordModal}
          user={user}
          uid={uid}
          onClose={() => setShowPasswordModal(false)}
          onSaved={handlePasswordSaved}
          onError={setError}
        />
      )}

      {showDeleteModal && (
        <DeleteAccountModal
          show={showDeleteModal}
          user={user}
          uid={uid}
          onClose={() => setShowDeleteModal(false)}
          onDeleted={handleAccountDeleted}
          onError={setError}
        />
      )}

    </main>
  );
}
