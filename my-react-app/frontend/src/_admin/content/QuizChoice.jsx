import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Form, Modal, Spinner, Table } from 'react-bootstrap';
import { Archive, Check, Edit3, Plus, Send, Trash2, Undo2, X } from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { TRIBE_FULL_NAME_BY_SLUG } from '../../constants/tribes';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../../utils/apiClient';
import '../../../static/css/_admin/quiz-bank.css';

const CONTENT_EDITORS = ['owner', 'admin', 'editor'];
const CONTENT_APPROVERS = ['owner', 'admin', 'reviewer'];
const PUBLISHERS = ['owner', 'admin'];
const EDITABLE_STATUSES = ['draft', 'rejected'];

const STATUSES = {
  draft: { label: '草稿', bg: 'secondary' },
  pending_review: { label: '待審核', bg: 'warning' },
  rejected: { label: '已退件', bg: 'danger' },
  published: { label: '已啟用', bg: 'success' },
};

const OPTION_LABELS = ['A', 'B', 'C'];

const EMPTY_FORM = {
  tribe: 'tayal',
  question_ab: '',
  question_ch: '',
  image_a_url: '',
  image_b_url: '',
  image_c_url: '',
  answer: 1,
};

function formFrom(item) {
  return {
    tribe: item.tribe,
    question_ab: item.question_ab ?? '',
    question_ch: item.question_ch ?? '',
    image_a_url: item.image_a_url ?? '',
    image_b_url: item.image_b_url ?? '',
    image_c_url: item.image_c_url ?? '',
    answer: Number(item.answer) || 1,
  };
}

export default function QuizChoice() {
  const { userData } = useAuth();
  const role = userData?.role;

  const [filters, setFilters] = useState({ tribe: '', status: '' });
  const [query, setQuery] = useState(filters);
  const [data, setData] = useState({
    results: [],
    count: 0,
    page: 1,
    page_size: 20,
  });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState(null);
  const [error, setError] = useState('');
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectingRevision, setRejectingRevision] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [uploadingField, setUploadingField] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: '20',
      });

      Object.entries(query).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });

      setData(
        await apiGet(
          `/adminapi/quiz-bank/choice/?${params.toString()}`,
        ),
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, query]);

  useEffect(() => {
    load();
  }, [load]);

  const search = (event) => {
    event.preventDefault();
    setPage(1);
    setQuery(filters);
  };

  const runAction = async (item, action, body) => {
    setActionId(item.id);
    setError('');

    try {
      if (action === 'delete') {
        if (!window.confirm('確定要刪除這則中級選擇題嗎？')) return;
        await apiDelete(`/adminapi/quiz-bank/choice/${item.id}/`);
      } else {
        await apiPost(
          `/adminapi/quiz-bank/choice/${item.id}/${action}/`,
          body,
        );
      }

      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionId(null);
    }
  };

  const openReject = (item, revision = false) => {
    setRejectTarget(item);
    setRejectingRevision(revision);
    setRejectReason('');
  };

  const closeReject = () => {
    setRejectTarget(null);
    setRejectingRevision(false);
    setRejectReason('');
  };

  const submitReject = async () => {
    if (!rejectReason.trim() || !rejectTarget) return;

    await runAction(
      rejectTarget,
      rejectingRevision ? 'pending-revision/reject' : 'reject',
      { review_comment: rejectReason.trim() },
    );
    closeReject();
  };

  const openNew = () => {
    setForm({ ...EMPTY_FORM });
    setEditTarget({});
    setError('');
  };

  const openEdit = async (item) => {
    setActionId(item.id);
    setError('');

    try {
      let values = item;

      if (item.status === 'published') {
        try {
          const revision = await apiGet(
            `/adminapi/quiz-bank/choice/${item.id}/pending-revision/`,
          );
          values = { ...item, ...(revision.payload || {}) };
        } catch (err) {
          if (err.status !== 404) throw err;
        }
      }

      setForm(formFrom(values));
      setEditTarget(item);
    } catch (err) {
      setError(err.message);
    } finally {
      setActionId(null);
    }
  };

  const uploadImage = async (file, field) => {
    if (!file) return;

    setError('');
    setUploadingField(field);

    const formData = new FormData();
    formData.append('file', file);
    formData.append(
      'upload_preset',
      import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET,
    );
    formData.append(
      'cloud_name',
      import.meta.env.VITE_CLOUDINARY_CLOUD_NAME,
    );

    try {
      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${import.meta.env.VITE_CLOUDINARY_CLOUD_NAME}/image/upload/f_auto,q_auto`,
        { method: 'POST', body: formData },
      );

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const result = await response.json();
      setForm((current) => ({
        ...current,
        [field]: result.secure_url,
      }));
    } catch (err) {
      console.error('圖片上傳失敗', err);
      setError('圖片上傳失敗');
    } finally {
      setUploadingField('');
    }
  };

  const saveForm = async (event) => {
    event.preventDefault();

    const payload = {
      ...form,
      question_ab: form.question_ab.trim(),
      question_ch: form.question_ch.trim(),
      image_a_url: form.image_a_url.trim(),
      image_b_url: form.image_b_url.trim(),
      image_c_url: form.image_c_url.trim(),
      answer: Number(form.answer),
    };

    if (
      !payload.question_ab
      || !payload.question_ch
      || !payload.image_a_url
      || !payload.image_b_url
      || !payload.image_c_url
    ) {
      setError('族語句子、中文句意與三張選項圖片皆為必填');
      return;
    }

    if (uploadingField) {
      setError('請等待圖片上傳完成');
      return;
    }

    setActionId('form');
    setError('');

    try {
      if (editTarget.id) {
        if (editTarget.status === 'published') {
          await apiPost(
            `/adminapi/quiz-bank/choice/${editTarget.id}/pending-revision/`,
            payload,
          );
        } else {
          await apiPatch(
            `/adminapi/quiz-bank/choice/${editTarget.id}/`,
            payload,
          );
        }
      } else {
        await apiPost('/adminapi/quiz-bank/choice/', payload);
      }

      setEditTarget(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionId(null);
    }
  };

  const actionsFor = (item) => {
    const busy = actionId === item.id;
    const buttons = [];
    const editable = (
      EDITABLE_STATUSES.includes(item.status)
      || item.status === 'published'
    );

    if (editable && CONTENT_EDITORS.includes(role)) {
      buttons.push(
        <Button
          key="edit"
          size="sm"
          variant="outline-primary"
          disabled={busy}
          onClick={() => openEdit(item)}
        >
          <Edit3 size={14} /> 編輯
        </Button>,
      );
    }

    if (
      EDITABLE_STATUSES.includes(item.status)
      && CONTENT_EDITORS.includes(role)
    ) {
      buttons.push(
        <Button
          key="submit"
          size="sm"
          variant="outline-success"
          disabled={busy}
          onClick={() => runAction(item, 'submit')}
        >
          <Send size={14} /> 送審
        </Button>,
      );
    }

    if (item.status === 'draft' && PUBLISHERS.includes(role)) {
      buttons.push(
        <Button
          key="delete"
          size="sm"
          variant="outline-danger"
          disabled={busy}
          onClick={() => runAction(item, 'delete')}
        >
          <Trash2 size={14} /> 刪除
        </Button>,
      );
    }

    if (
      item.status === 'pending_review'
      && CONTENT_EDITORS.includes(role)
    ) {
      buttons.push(
        <Button
          key="withdraw"
          size="sm"
          variant="outline-secondary"
          disabled={busy}
          onClick={() => runAction(item, 'withdraw')}
        >
          <Undo2 size={14} /> 撤回
        </Button>,
      );
    }

    if (
      item.status === 'pending_review'
      && CONTENT_APPROVERS.includes(role)
    ) {
      buttons.push(
        <Button
          key="approve"
          size="sm"
          variant="outline-success"
          disabled={busy}
          onClick={() => runAction(
            item,
            'approve',
            { review_comment: '' },
          )}
        >
          <Check size={14} /> 核准
        </Button>,
      );
      buttons.push(
        <Button
          key="reject"
          size="sm"
          variant="outline-danger"
          disabled={busy}
          onClick={() => openReject(item)}
        >
          <X size={14} /> 退件
        </Button>,
      );
    }

    if (
      item.status === 'published'
      && item.has_pending_revision
      && CONTENT_APPROVERS.includes(role)
    ) {
      buttons.push(
        <Button
          key="approve-revision"
          size="sm"
          variant="outline-success"
          disabled={busy}
          onClick={() => runAction(
            item,
            'pending-revision/approve',
            { review_comment: '' },
          )}
        >
          <Check size={14} /> 核准修改
        </Button>,
      );
      buttons.push(
        <Button
          key="reject-revision"
          size="sm"
          variant="outline-danger"
          disabled={busy}
          onClick={() => openReject(item, true)}
        >
          <X size={14} /> 退件修改
        </Button>,
      );
    }

    if (
      item.status === 'published'
      && CONTENT_APPROVERS.includes(role)
    ) {
      buttons.push(
        <Button
          key="unpublish"
          size="sm"
          variant="outline-secondary"
          disabled={busy}
          onClick={() => runAction(item, 'unpublish')}
        >
          <Archive size={14} /> 下架
        </Button>,
      );
    }

    return buttons;
  };

  const canSave = (
    Boolean(form.question_ab.trim())
    && Boolean(form.question_ch.trim())
    && Boolean(form.image_a_url.trim())
    && Boolean(form.image_b_url.trim())
    && Boolean(form.image_c_url.trim())
    && !uploadingField
  );

  const hasNext = data.page * data.page_size < data.count;

  return (
    <main className="quiz-bank-admin-page">
      <div className="quiz-bank-page-heading">
        <div>
          <h1>中級選擇題</h1>
          <p>管理中級族語圖片選擇題、三個圖片選項與正確答案</p>
        </div>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      <Form className="quiz-bank-filter-panel" onSubmit={search}>
        <Form.Select
          aria-label="族語"
          value={filters.tribe}
          onChange={(event) => setFilters({
            ...filters,
            tribe: event.target.value,
          })}
        >
          <option value="">全部族語</option>
          {Object.entries(TRIBE_FULL_NAME_BY_SLUG).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Form.Select>

        <Form.Select
          aria-label="狀態"
          value={filters.status}
          onChange={(event) => setFilters({
            ...filters,
            status: event.target.value,
          })}
        >
          <option value="">全部狀態</option>
          {Object.entries(STATUSES).map(([value, meta]) => (
            <option key={value} value={value}>
              {meta.label}
            </option>
          ))}
        </Form.Select>

        <Button type="submit">搜尋</Button>
      </Form>

      {CONTENT_EDITORS.includes(role) && (
        <div className="quiz-bank-heading-actions">
          <Button onClick={openNew}>
            <Plus size={18} /> 新增中級選擇題
          </Button>
        </div>
      )}

      <div className="quiz-bank-table-card">
        {loading ? (
          <div className="quiz-bank-loading">
            <Spinner animation="border" />
            <span>載入中…</span>
          </div>
        ) : (
          <Table responsive hover className="quiz-bank-table">
            <thead>
              <tr>
                <th>族語</th>
                <th>族語句子</th>
                <th>正解</th>
                <th>狀態</th>
                <th>建立者</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {data.results.length ? (
                data.results.map((item) => (
                  <tr key={item.id}>
                    <td>{TRIBE_FULL_NAME_BY_SLUG[item.tribe] ?? item.tribe}</td>
                    <td className="quiz-bank-truncate-cell">
                      {item.question_ab}
                    </td>
                    <td>
                      {OPTION_LABELS[Number(item.answer) - 1] ?? '—'}
                    </td>
                    <td>
                      <div className="d-flex flex-wrap align-items-center gap-1">
                        <Badge
                          bg={STATUSES[item.status]?.bg ?? 'secondary'}
                        >
                          {STATUSES[item.status]?.label ?? item.status}
                        </Badge>
                        {item.status === 'published'
                          && item.has_pending_revision && (
                          <Badge bg="warning" text="dark">
                            有待審修改
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td>{item.created_by || '—'}</td>
                    <td>
                      <div className="quiz-bank-row-actions">
                        {actionsFor(item)}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6" className="quiz-bank-empty">
                    沒有符合條件的中級選擇題
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        )}

        <div className="quiz-bank-pagination">
          <span>共 {data.count} 筆</span>
          <div>
            <Button
              variant="outline-secondary"
              disabled={loading || page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              上一頁
            </Button>
            <span>第 {data.page} 頁</span>
            <Button
              variant="outline-secondary"
              disabled={loading || !hasNext}
              onClick={() => setPage((value) => value + 1)}
            >
              下一頁
            </Button>
          </div>
        </div>
      </div>

      <Modal
        show={Boolean(editTarget)}
        onHide={() => setEditTarget(null)}
        centered
        size="lg"
      >
        <Form onSubmit={saveForm}>
          <Modal.Header closeButton>
            <Modal.Title>
              {editTarget?.id
                ? '編輯中級選擇題'
                : '新增中級選擇題'}
            </Modal.Title>
          </Modal.Header>

          <Modal.Body>
            <Form.Group
              className="quiz-bank-field"
              controlId="quiz-choice-tribe"
            >
              <Form.Label>族語</Form.Label>
              <Form.Select
                value={form.tribe}
                onChange={(event) => setForm({
                  ...form,
                  tribe: event.target.value,
                })}
              >
                {Object.entries(TRIBE_FULL_NAME_BY_SLUG).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>

            <Form.Group
              className="quiz-bank-field"
              controlId="quiz-choice-question-ab"
            >
              <Form.Label>
                族語句子 <span className="required-mark">*</span>
              </Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                required
                value={form.question_ab}
                onChange={(event) => setForm({
                  ...form,
                  question_ab: event.target.value,
                })}
              />
            </Form.Group>

            <Form.Group
              className="quiz-bank-field"
              controlId="quiz-choice-question-ch"
            >
              <Form.Label>
                中文句意 <span className="required-mark">*</span>
              </Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                required
                value={form.question_ch}
                onChange={(event) => setForm({
                  ...form,
                  question_ch: event.target.value,
                })}
              />
            </Form.Group>

            <div
              className="quiz-bank-choice-images"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: '1rem',
              }}
            >
              {OPTION_LABELS.map((label, index) => {
                const field = `image_${label.toLowerCase()}_url`;
                const uploading = uploadingField === field;

                return (
                  <div
                    key={field}
                    className="quiz-bank-field"
                    style={{
                      border: '1px solid #dee2e6',
                      borderRadius: 8,
                      padding: '1rem',
                    }}
                  >
                    <Form.Check
                      type="radio"
                      id={`quiz-choice-answer-${label.toLowerCase()}`}
                      name="quiz-choice-answer"
                      label={`選項 ${label}（設為正解）`}
                      checked={Number(form.answer) === index + 1}
                      onChange={() => setForm({
                        ...form,
                        answer: index + 1,
                      })}
                    />

                    <Form.Group
                      className="mt-3"
                      controlId={`quiz-choice-image-${label.toLowerCase()}`}
                    >
                      <Form.Label>
                        圖片 {label}{' '}
                        <span className="required-mark">*</span>
                      </Form.Label>
                      <Form.Control
                        type="file"
                        accept="image/*"
                        disabled={Boolean(uploadingField)}
                        onChange={(event) => uploadImage(
                          event.target.files?.[0],
                          field,
                        )}
                      />
                    </Form.Group>

                    {uploading && (
                      <Form.Text>
                        <Spinner animation="border" size="sm" /> 圖片上傳中…
                      </Form.Text>
                    )}

                    {form[field] && (
                      <img
                        src={form[field]}
                        alt={`選項 ${label} 圖片預覽`}
                        className="mt-2"
                        style={{
                          width: '100%',
                          height: 140,
                          objectFit: 'cover',
                          borderRadius: 8,
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </Modal.Body>

          <Modal.Footer>
            <Button
              variant="secondary"
              onClick={() => setEditTarget(null)}
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={!canSave || actionId === 'form'}
            >
              {actionId === 'form' && (
                <Spinner animation="border" size="sm" />
              )}{' '}
              儲存
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal
        show={Boolean(rejectTarget)}
        onHide={closeReject}
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title>
            {rejectingRevision ? '退件修改原因' : '退件原因'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group controlId="quiz-choice-reject-reason">
            <Form.Label>請說明需要修改的內容</Form.Label>
            <Form.Control
              as="textarea"
              rows={4}
              required
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              isInvalid={
                Boolean(rejectTarget)
                && !rejectReason.trim()
              }
            />
            <Form.Control.Feedback type="invalid">
              退件理由為必填
            </Form.Control.Feedback>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={closeReject}>
            取消
          </Button>
          <Button
            variant="danger"
            disabled={
              !rejectReason.trim()
              || actionId === rejectTarget?.id
            }
            onClick={submitReject}
          >
            {rejectingRevision ? '確認退件修改' : '確認退件'}
          </Button>
        </Modal.Footer>
      </Modal>
    </main>
  );
}
