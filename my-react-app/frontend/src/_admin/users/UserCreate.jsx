import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  Form,
  Spinner,
} from 'react-bootstrap';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  ImagePlus,
  Save,
} from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { apiPost } from '../../../utils/apiClient';
import { useActionLock } from '../hooks/useActionLock';
import { useMediaUpload } from '../hooks/useMediaUpload';
import '../../../static/css/_admin/users.css';
import { ACCOUNT_MANAGERS, ROLE_LABELS, STAFF_ROLES } from '../constants/roles';


const INITIAL_FORM = {
  email: '',
  password: '',
  name: '',
  identity: '學生',
  avatar_url: '',
  role: '',
};

export default function UserCreate() {
  const navigate = useNavigate();
  const { userData } = useAuth();
  const role = userData?.role;
  const canCreateUser = ACCOUNT_MANAGERS.includes(role);
  const canAssignRole = role === 'owner';

  const [form, setForm] = useState(INITIAL_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const media = useMediaUpload();
  const saveLock = useActionLock();
  const saving = saveLock.isLocked;
  const avatarUploading = media.isUploading('avatar');
  const avatarPreview = media.previews.avatar ?? '';

  const update = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleAvatarFileChange = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    media.upload(file, 'avatar', {
      localPreview: true,
      onUploaded: (secureUrl) => update('avatar_url', secureUrl),
    });
  };

  const createUser = (event) => {
    event.preventDefault();

    if (avatarUploading) {
      setError('請等待頭像上傳完成');
      return;
    }

    saveLock.runLocked('create-user', async () => {
      setError('');

      try {
        const result = await apiPost('/adminapi/users/', {
          email: form.email.trim(),
          password: form.password,
          name: form.name.trim(),
          identity: form.identity.trim(),
          avatar_url: form.avatar_url.trim(),
          role: canAssignRole && form.role ? form.role : null,
        });

        navigate(`/admin/users/${result.uid}`);
      } catch (err) {
        setError(err.message);
      }
    });
  };

  if (!canCreateUser) {
    return (
      <main className="user-admin-page user-detail-page">
        <Alert variant="danger">
          目前帳號沒有新增使用者的權限。
        </Alert>

        <Button as={Link} to="/admin/users" variant="outline-secondary">
          <ArrowLeft size={16} />
          返回使用者列表
        </Button>
      </main>
    );
  }

  return (
    <main className="user-admin-page user-detail-page">
      <Link className="user-back-link" to="/admin/users">
        <ArrowLeft size={16} />
        返回使用者列表
      </Link>

      <div className="user-page-heading">
        <div>
          <h1>新增使用者</h1>
          <p>建立新的平台帳號與基本資料。</p>
        </div>
      </div>

      {(error || media.error) && <Alert variant="danger">{error || media.error}</Alert>}

      <Form className="user-detail-card" onSubmit={createUser}>
        <Form.Group className="mb-3" controlId="user-create-email">
          <Form.Label>
            Email <span className="required-mark">*</span>
          </Form.Label>
          <Form.Control
            type="email"
            required
            autoComplete="off"
            disabled={saving}
            value={form.email}
            onChange={(event) => update('email', event.target.value)}
          />
        </Form.Group>

        <Form.Group className="mb-3" controlId="user-create-password">
          <Form.Label>
            密碼 <span className="required-mark">*</span>
          </Form.Label>

          <div className="d-flex gap-2">
            <Form.Control
              type={showPassword ? 'text' : 'password'}
              required
              minLength={6}
              autoComplete="new-password"
              disabled={saving}
              value={form.password}
              onChange={(event) => update('password', event.target.value)}
            />

            <Button
              type="button"
              variant="outline-secondary"
              aria-label={showPassword ? '隱藏密碼' : '顯示密碼'}
              aria-pressed={showPassword}
              disabled={saving}
              onClick={() => setShowPassword((current) => !current)}
            >
              {showPassword ? (
                <EyeOff size={18} aria-hidden="true" />
              ) : (
                <Eye size={18} aria-hidden="true" />
              )}
            </Button>
          </div>

          <Form.Text>密碼至少需要 6 個字元。</Form.Text>
        </Form.Group>

        <Form.Group className="mb-3" controlId="user-create-name">
          <Form.Label>
            姓名 <span className="required-mark">*</span>
          </Form.Label>
          <Form.Control
            required
            disabled={saving}
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
          />
        </Form.Group>

        <Form.Group className="mb-3" controlId="user-create-identity">
          <Form.Label>身分</Form.Label>
          <Form.Control
            disabled={saving}
            value={form.identity}
            onChange={(event) => update('identity', event.target.value)}
            placeholder="例如：學生"
          />
        </Form.Group>

        <Form.Group className="mb-3" controlId="user-create-avatar-url">
          <Form.Label>頭像</Form.Label>
          <div className="user-avatar-uploader">
            {avatarPreview ? (
              <img
                className="user-avatar-uploader-preview"
                src={avatarPreview}
                alt="頭像預覽"
              />
            ) : (
              <div className="user-avatar-uploader-placeholder">
                <ImagePlus size={24} aria-hidden="true" />
              </div>
            )}

            <div>
              <Form.Control
                type="file"
                accept="image/jpeg,image/png"
                disabled={saving || avatarUploading}
                onChange={handleAvatarFileChange}
              />
              <Form.Text>僅接受 JPG／PNG，檔案大小不得超過 5 MB。</Form.Text>
              {avatarUploading && (
                <span className="user-upload-status">
                  <Spinner animation="border" size="sm" />
                  頭像上傳中……
                </span>
              )}
            </div>
          </div>
        </Form.Group>

        {canAssignRole && (
          <Form.Group className="mb-3" controlId="user-create-role">
            <Form.Label>後台角色</Form.Label>
            <Form.Select
              disabled={saving}
              value={form.role}
              onChange={(event) => update('role', event.target.value)}
            >
              <option value="">不指派</option>
              {STAFF_ROLES.map((value) => (
                <option key={value} value={value}>
                  {ROLE_LABELS[value]}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
        )}

        <div className="user-detail-footer">
          <Button
            as={Link}
            to="/admin/users"
            variant="outline-secondary"
            disabled={saving}
          >
            取消
          </Button>

          <Button type="submit" disabled={saving || avatarUploading}>
            {saving ? (
              <Spinner animation="border" size="sm" />
            ) : (
              <Save size={16} />
            )}
            建立使用者
          </Button>
        </div>
      </Form>
    </main>
  );
}
