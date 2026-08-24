import { Link } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Form,
  Spinner,
  Table,
} from 'react-bootstrap';
import {
  Eye,
  Plus,
  Search,
  User,
} from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { useAdminListQuery } from '../hooks/useAdminListQuery';
import ReviewPagination from '../reviewWorkflow/ReviewPagination';
import '../../../static/css/_admin/users.css';
import { ACCOUNT_MANAGERS, ROLE_LABELS, STAFF_ROLES } from '../constants/roles';
import { formatDateTime } from '../adminFormat';

export default function UserList() {
  const { userData } = useAuth();
  const role = userData?.role;
  const canViewUsers = STAFF_ROLES.includes(role);
  const canCreateUser = ACCOUNT_MANAGERS.includes(role);

  const {
    items, data, loading, error, page, setPage, hasNext,
    filters, setFilters, search,
  } = useAdminListQuery({
    endpoint: '/adminapi/users/',
    initialFilters: {
      keyword: '', role: '', identity: '', disabled: '',
    },
    pageSize: 20,
    enabled: canViewUsers,
  });

  if (!canViewUsers) {
    return (
      <main className="user-admin-page">
        <Alert variant="danger">
          目前帳號沒有檢視使用者管理頁面的權限。
        </Alert>
      </main>
    );
  }

  return (
    <main className="user-admin-page">
      <div className="user-page-heading">
        <div>
          <h1>使用者管理</h1>
          <p>搜尋使用者並檢視帳號、身分與後台角色狀態</p>
        </div>

        {canCreateUser && (
          <Button as={Link} to="/admin/users/new">
            <Plus size={18} />
            新增使用者
          </Button>
        )}
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      <Form className="user-filter-panel" onSubmit={search}>
        <Form.Control
          aria-label="關鍵字搜尋"
          placeholder="搜尋 Email、姓名或 UID"
          value={filters.keyword}
          onChange={(event) => setFilters({
            ...filters,
            keyword: event.target.value,
          })}
        />

        <Form.Select
          aria-label="角色"
          value={filters.role}
          onChange={(event) => setFilters({
            ...filters,
            role: event.target.value,
          })}
        >
          <option value="">全部角色</option>
          {STAFF_ROLES.map((value) => (
            <option key={value} value={value}>
              {ROLE_LABELS[value]}
            </option>
          ))}
        </Form.Select>

        <Form.Control
          aria-label="身分"
          placeholder="身分，例如：學生"
          value={filters.identity}
          onChange={(event) => setFilters({
            ...filters,
            identity: event.target.value,
          })}
        />

        <Form.Select
          aria-label="帳號狀態"
          value={filters.disabled}
          onChange={(event) => setFilters({
            ...filters,
            disabled: event.target.value,
          })}
        >
          <option value="">全部狀態</option>
          <option value="false">正常</option>
          <option value="true">已停權</option>
        </Form.Select>

        <Button type="submit">
          <Search size={16} />
          搜尋
        </Button>
      </Form>

      <section className="user-table-card">
        {loading ? (
          <div className="user-loading">
            <Spinner animation="border" size="sm" />
            載入使用者資料中……
          </div>
        ) : (
          <>
            <div className="user-table-scroll">
              <Table responsive className="user-table">
                <thead>
                  <tr>
                    <th>使用者</th>
                    <th>Email</th>
                    <th>身分</th>
                    <th>角色</th>
                    <th>狀態</th>
                    <th>註冊日期</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="user-empty">
                        找不到符合條件的使用者
                      </td>
                    </tr>
                  ) : items.map((item) => (
                    <tr key={item.uid}>
                      <td>
                        <div className="user-identity-cell">
                          {item.avatar_url ? (
                            <img
                              className="user-avatar"
                              src={item.avatar_url}
                              alt=""
                            />
                          ) : (
                            <span className="user-avatar user-avatar-placeholder">
                              <User size={20} aria-hidden="true" />
                            </span>
                          )}

                          <div>
                            <strong>{item.name || item.uid}</strong>
                            {item.name && (
                              <small>{item.uid}</small>
                            )}
                          </div>
                        </div>
                      </td>

                      <td>
                        <span>{item.email || '—'}</span>
                        <small className="user-cell-note">
                          {item.email_verified ? 'Email 已驗證' : 'Email 未驗證'}
                        </small>
                      </td>

                      <td>{item.identity || '—'}</td>

                      <td>
                        <Badge bg={item.role ? 'primary' : 'secondary'}>
                          {item.role
                            ? ROLE_LABELS[item.role] || item.role
                            : '一般使用者'}
                        </Badge>
                      </td>

                      <td>
                        <Badge bg={item.disabled ? 'danger' : 'success'}>
                          {item.disabled ? '已停權' : '正常'}
                        </Badge>
                      </td>

                      <td>{formatDateTime(item.join_date)}</td>

                      <td>
                        <div className="user-row-actions">
                          <Button
                            as={Link}
                            to={`/admin/users/${item.uid}`}
                            size="sm"
                            variant="outline-primary"
                          >
                            <Eye size={14} />
                            詳情
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>

            <ReviewPagination
              data={data}
              page={page}
              setPage={setPage}
              loading={loading}
              hasNext={hasNext}
              className="user-pagination"
            />
          </>
        )}
      </section>
    </main>
  );
}
