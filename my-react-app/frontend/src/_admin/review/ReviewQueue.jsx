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
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { useAdminListQuery } from '../hooks/useAdminListQuery';
import '../../../static/css/_admin/review-queue.css';

const STAFF_ROLES = ['owner', 'admin', 'editor', 'reviewer', 'analyst'];

const TYPE_LABELS = {
  submission: {
    label: '新內容送審',
    bg: 'primary',
  },
  revision: {
    label: '已發布內容修改',
    bg: 'warning',
  },
  report: {
    label: '檢舉',
    bg: 'danger',
  },
};

const CONTENT_TYPE_LABELS = {
  announcement: '公告',
  quiz_vocab_item: '配合題詞彙',
  quiz_cloze_passage: '克漏字短文',
  quiz_situation_item: '情境題',
  quiz_true_false_item: '初級是非題',
  quiz_choice_item: '中級選擇題',
  note: '分享筆記',
  recording: '發音錄音',
};

const PAGE_SIZE = 20;

const formatDateTime = (value) => {
  if (!value) return '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('zh-TW', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

const formatWaitingTime = (value) => {
  if (!value) return '—';

  const submittedAt = new Date(value);
  if (Number.isNaN(submittedAt.getTime())) return '—';

  const elapsedMilliseconds = Math.max(0, Date.now() - submittedAt.getTime());
  const elapsedHours = Math.floor(elapsedMilliseconds / (1000 * 60 * 60));

  if (elapsedHours < 1) return '不到 1 小時';
  if (elapsedHours < 24) return `${elapsedHours} 小時`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  const remainingHours = elapsedHours % 24;

  if (remainingHours === 0) return `${elapsedDays} 天`;
  return `${elapsedDays} 天 ${remainingHours} 小時`;
};

export default function ReviewQueue() {
  const { userData, loading: authLoading } = useAuth();
  const role = userData?.role;
  const canView = STAFF_ROLES.includes(role);

  const {
    data, loading, error, page, setPage, hasNext,
    filters, applyFilters, reload: loadQueue,
  } = useAdminListQuery({
    endpoint: '/adminapi/review-queue/',
    initialFilters: { type: '' },
    pageSize: PAGE_SIZE,
    enabled: canView,
  });

  const typeFilter = filters.type;

  // 這一頁沒有「搜尋」按鈕，改下拉選單就立刻重新查詢。
  const changeTypeFilter = (event) => {
    applyFilters({ type: event.target.value });
  };

  const hasPrevious = data.page > 1;
  const firstItem = data.count === 0
    ? 0
    : (data.page - 1) * data.page_size + 1;
  const lastItem = Math.min(data.page * data.page_size, data.count);

  if (authLoading) {
    return (
      <main className="review-queue-page">
        <div className="review-queue-loading">
          <Spinner animation="border" size="sm" />
          <span>確認權限中…</span>
        </div>
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="review-queue-page">
        <Alert variant="danger">
          您沒有權限檢視送審佇列。
        </Alert>
      </main>
    );
  }

  return (
    <main className="review-queue-page">
      <div className="review-queue-heading">
        <div>
          <h1>送審佇列</h1>
          <p>集中查看目前等待審核或處理的內容</p>
        </div>

        <Button
          type="button"
          variant="outline-primary"
          disabled={loading}
          onClick={loadQueue}
        >
          {loading
            ? <Spinner animation="border" size="sm" />
            : <RefreshCw size={17} />}
          重新整理
        </Button>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      <Form className="review-queue-filter-panel">
        <Form.Group controlId="review-queue-type">
          <Form.Label>佇列類型</Form.Label>
          <Form.Select
            aria-label="佇列類型"
            value={typeFilter}
            onChange={changeTypeFilter}
          >
            <option value="">全部</option>
            <option value="submission">新內容送審</option>
            <option value="revision">已發布內容修改</option>
            <option value="report">檢舉</option>
          </Form.Select>
        </Form.Group>

        <p>
          共 <strong>{data.count}</strong> 筆待處理項目
        </p>
      </Form>

      <div className="review-queue-table-card">
        {loading ? (
          <div className="review-queue-loading">
            <Spinner animation="border" size="sm" />
            <span>載入送審佇列中…</span>
          </div>
        ) : (
          <Table responsive hover className="review-queue-table">
            <thead>
              <tr>
                <th>類型</th>
                <th>內容種類</th>
                <th>標題／摘要</th>
                <th>送出者</th>
                <th>送出時間</th>
                <th>等待時間</th>
                <th aria-label="操作">操作</th>
              </tr>
            </thead>

            <tbody>
              {data.results.length === 0 ? (
                <tr>
                  <td colSpan={7} className="review-queue-empty">
                    目前沒有符合條件的待處理項目。
                  </td>
                </tr>
              ) : (
                data.results.map((item) => {
                  const typeMeta = TYPE_LABELS[item.type] ?? {
                    label: item.type,
                    bg: 'secondary',
                  };

                  return (
                    <tr key={`${item.type}-${item.content_type}-${item.id}`}>
                      <td>
                        <Badge bg={typeMeta.bg}>
                          {typeMeta.label}
                        </Badge>
                      </td>
                      <td>
                        {CONTENT_TYPE_LABELS[item.content_type]
                          ?? item.content_type
                          ?? '—'}
                      </td>
                      <td className="review-queue-title-cell">
                        {item.title || '—'}
                      </td>
                      <td className="review-queue-submitter-cell">
                        {item.submitted_by || '—'}
                      </td>
                      <td className="review-queue-date-cell">
                        {formatDateTime(item.submitted_at)}
                      </td>
                      <td className="review-queue-wait-cell">
                        {formatWaitingTime(item.submitted_at)}
                      </td>
                      <td>
                        <Button
                          as={Link}
                          to={item.link}
                          size="sm"
                          variant="outline-primary"
                          className="review-queue-action"
                        >
                          <ExternalLink size={14} />
                          前往處理
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </Table>
        )}

        {!loading && data.count > 0 && (
          <div className="review-queue-pagination">
            <span>
              顯示第 {firstItem}–{lastItem} 筆，共 {data.count} 筆
            </span>

            <div>
              <Button
                type="button"
                size="sm"
                variant="outline-secondary"
                disabled={!hasPrevious}
                onClick={() => setPage((current) => current - 1)}
              >
                <ChevronLeft size={15} />
                上一頁
              </Button>

              <span>第 {data.page} 頁</span>

              <Button
                type="button"
                size="sm"
                variant="outline-secondary"
                disabled={!hasNext}
                onClick={() => setPage((current) => current + 1)}
              >
                下一頁
                <ChevronRight size={15} />
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
