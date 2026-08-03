import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Form, Modal, Spinner, Table } from 'react-bootstrap';
import { Archive, Check, Edit3, Plus, Send, Trash2, Undo2, X } from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../../utils/apiClient';
import '../../../static/css/_admin/quiz-bank.css';

const CONTENT_EDITORS = ['owner', 'admin', 'editor'];
const CONTENT_APPROVERS = ['owner', 'admin', 'reviewer'];
const PUBLISHERS = ['owner', 'admin'];
const EDITABLE_STATUSES = ['draft', 'rejected'];

const TRIBES = {
  tayal: '泰雅語',
  amis: '阿美語',
  bunun: '布農語',
  kavalan: '噶瑪蘭語',
  paiwan: '排灣語',
};

const STATUSES = {
  draft: { label: '草稿', bg: 'secondary' },
  pending_review: { label: '待審核', bg: 'warning' },
  rejected: { label: '已退件', bg: 'danger' },
  published: { label: '已啟用', bg: 'success' },
};

const EMPTY_FORM = {
  tribe: 'tayal',
  question_ab: '',
  question_ch: '',
  audio_url: '',
  image_url: '',
  answer: 1,
};

export default function QuizTrueFalse() {
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
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

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
          `/adminapi/quiz-bank/true-false/?${params.toString()}`,
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
        if (!window.confirm('確定要刪除這則初級是非題嗎？')) return;
        await apiDelete(`/adminapi/quiz-bank/true-false/${item.id}/`);
      } else {
        await apiPost(
          `/adminapi/quiz-bank/true-false/${item.id}/${action}/`,
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

  const submitReject = async () => {
    if (!rejectReason.trim()) return;

    await runAction(rejectTarget, 'reject', {
      review_comment: rejectReason.trim(),
    });
    setRejectTarget(null);
    setRejectReason('');
  };

  const openNew = () => {
    setForm({ ...EMPTY_FORM });
    setEditTarget({});
    setError('');
  };

  const openEdit = (item) => {
    setForm({
      tribe: item.tribe,
      question_ab: item.question_ab ?? '',
      question_ch: item.question_ch ?? '',
      audio_url: item.audio_url ?? '',
      image_url: item.image_url ?? '',
      answer: Number(item.answer) || 1,
    });
    setEditTarget(item);
    setError('');
  };

  const uploadFile = async (file, resourceType, field, setUploading) => {
    if (!file) return;

    setError('');
    setUploading(true);

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

    const suffix =
      resourceType === 'image'
        ? 'image/upload/f_auto,q_auto'
        : 'video/upload';

    try {
      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${import.meta.env.VITE_CLOUDINARY_CLOUD_NAME}/${suffix}`,
        { method: 'POST', body: formData },
      );

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const result = await response.json();
      setForm((current) => ({
        ...current,
        [field]: result.secure_url,
      }));
    } catch (err) {
      console.error(`${resourceType === 'image' ? '圖片' : '音檔'}上傳失敗`, err);
      setError(`${resourceType === 'image' ? '圖片' : '音檔'}上傳失敗`);
    } finally {
      setUploading(false);
    }
  };

  const saveForm = async (event) => {
    event.preventDefault();

    const payload = {
      ...form,
      question_ab: form.question_ab.trim(),
      question_ch: form.question_ch.trim(),
      audio_url: form.audio_url.trim(),
      image_url: form.image_url.trim(),
      answer: Number(form.answer),
    };

    if (
      !payload.question_ab ||
      !payload.question_ch ||
      !payload.audio_url ||
      !payload.image_url
    ) {
      setError('族語句子、中文句意、音檔與圖片皆為必填');
      return;
    }

    if (uploadingAudio || uploadingImage) {
      setError('請等待檔案上傳完成');
      return;
    }

    setActionId('form');
    setError('');

    try {
      if (editTarget.id) {
        await apiPatch(
          `/adminapi/quiz-bank/true-false/${editTarget.id}/`,
          payload,
        );
      } else {
        await apiPost('/adminapi/quiz-bank/true-false/', payload);
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

    if (
      EDITABLE_STATUSES.includes(item.status) &&
      CONTENT_EDITORS.includes(role)
    ) {
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
      item.status === 'pending_review' &&
      CONTENT_EDITORS.includes(role)
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
      item.status === 'pending_review' &&
      CONTENT_APPROVERS.includes(role)
    ) {
      buttons.push(
        <Button
          key="approve"
          size="sm"
          variant="outline-success"
          disabled={busy}
          onClick={() =>
            runAction(item, 'approve', { review_comment: '' })
          }
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
          onClick={() => {
            setRejectTarget(item);
            setRejectReason('');
          }}
        >
          <X size={14} /> 退件
        </Button>,
      );
    }

    if (
      item.status === 'published' &&
      CONTENT_APPROVERS.includes(role)
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

  const canSave =
    Boolean(form.question_ab.trim()) &&
    Boolean(form.question_ch.trim()) &&
    Boolean(form.audio_url.trim()) &&
    Boolean(form.image_url.trim()) &&
    !uploadingAudio &&
    !uploadingImage;

  const hasNext = data.page * data.page_size < data.count;

  return (
    <main className="quiz-bank-admin-page">
      <div className="quiz-bank-page-heading">
        <div>
          <h1>初級是非題</h1>
          <p>管理初級族語句意判斷題、題目媒體與正確答案</p>
        </div>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      <Form className="quiz-bank-filter-panel" onSubmit={search}>
        <Form.Select
          aria-label="族語"
          value={filters.tribe}
          onChange={(event) =>
            setFilters({ ...filters, tribe: event.target.value })
          }
        >
          <option value="">全部族語</option>
          {Object.entries(TRIBES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Form.Select>

        <Form.Select
          aria-label="狀態"
          value={filters.status}
          onChange={(event) =>
            setFilters({ ...filters, status: event.target.value })
          }
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
            <Plus size={18} /> 新增初級是非題
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
                    <td>{TRIBES[item.tribe] ?? item.tribe}</td>
                    <td className="quiz-bank-truncate-cell">
                      {item.question_ab}
                    </td>
                    <td>{Number(item.answer) === 1 ? 'O 符合' : 'X 不符合'}</td>
                    <td>
                      <Badge bg={STATUSES[item.status]?.bg ?? 'secondary'}>
                        {STATUSES[item.status]?.label ?? item.status}
                      </Badge>
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
                    沒有符合條件的初級是非題
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
              {editTarget?.id ? '編輯初級是非題' : '新增初級是非題'}
            </Modal.Title>
          </Modal.Header>

          <Modal.Body>
            <Form.Group
              className="quiz-bank-field"
              controlId="quiz-true-false-tribe"
            >
              <Form.Label>族語</Form.Label>
              <Form.Select
                value={form.tribe}
                onChange={(event) =>
                  setForm({ ...form, tribe: event.target.value })
                }
              >
                {Object.entries(TRIBES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>

            <Form.Group
              className="quiz-bank-field"
              controlId="quiz-true-false-question-ab"
            >
              <Form.Label>
                族語句子 <span className="required-mark">*</span>
              </Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                required
                value={form.question_ab}
                onChange={(event) =>
                  setForm({ ...form, question_ab: event.target.value })
                }
              />
            </Form.Group>

            <Form.Group
              className="quiz-bank-field"
              controlId="quiz-true-false-question-ch"
            >
              <Form.Label>
                中文句意 <span className="required-mark">*</span>
              </Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                required
                value={form.question_ch}
                onChange={(event) =>
                  setForm({ ...form, question_ch: event.target.value })
                }
              />
            </Form.Group>

            <Form.Group
              className="quiz-bank-field"
              controlId="quiz-true-false-audio"
            >
              <Form.Label>
                音檔 <span className="required-mark">*</span>
              </Form.Label>
              <Form.Control
                type="file"
                accept="audio/mpeg,.mp3"
                disabled={uploadingAudio}
                onChange={(event) =>
                  uploadFile(
                    event.target.files?.[0],
                    'video',
                    'audio_url',
                    setUploadingAudio,
                  )
                }
              />
              {uploadingAudio && (
                <Form.Text>
                  <Spinner animation="border" size="sm" /> 音檔上傳中…
                </Form.Text>
              )}
              {form.audio_url && (
                <audio
                  controls
                  src={form.audio_url}
                  aria-label="目前音檔預覽"
                  className="mt-2 w-100"
                >
                  您的瀏覽器不支援音訊播放。
                </audio>
              )}
            </Form.Group>

            <Form.Group
              className="quiz-bank-field"
              controlId="quiz-true-false-image"
            >
              <Form.Label>
                圖片 <span className="required-mark">*</span>
              </Form.Label>
              <Form.Control
                type="file"
                accept="image/*"
                disabled={uploadingImage}
                onChange={(event) =>
                  uploadFile(
                    event.target.files?.[0],
                    'image',
                    'image_url',
                    setUploadingImage,
                  )
                }
              />
              {uploadingImage && (
                <Form.Text>
                  <Spinner animation="border" size="sm" /> 圖片上傳中…
                </Form.Text>
              )}
              {form.image_url && (
                <div className="mt-2">
                  <img
                    src={form.image_url}
                    alt="題目圖片預覽"
                    style={{
                      width: 180,
                      height: 120,
                      objectFit: 'cover',
                      borderRadius: 8,
                    }}
                  />
                </div>
              )}
            </Form.Group>

            <fieldset className="quiz-bank-field">
              <legend className="form-label">
                正解 <span className="required-mark">*</span>
              </legend>
              <Form.Check
                type="radio"
                id="quiz-true-false-answer-o"
                name="quiz-true-false-answer"
                label="O 符合"
                checked={Number(form.answer) === 1}
                onChange={() => setForm({ ...form, answer: 1 })}
              />
              <Form.Check
                type="radio"
                id="quiz-true-false-answer-x"
                name="quiz-true-false-answer"
                label="X 不符合"
                checked={Number(form.answer) === 2}
                onChange={() => setForm({ ...form, answer: 2 })}
              />
            </fieldset>
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
        onHide={() => setRejectTarget(null)}
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title>退件原因</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group controlId="quiz-true-false-reject-reason">
            <Form.Label>請說明需要修改的內容</Form.Label>
            <Form.Control
              as="textarea"
              rows={4}
              required
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              isInvalid={Boolean(rejectTarget) && !rejectReason.trim()}
            />
            <Form.Control.Feedback type="invalid">
              退件理由為必填
            </Form.Control.Feedback>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={() => setRejectTarget(null)}
          >
            取消
          </Button>
          <Button
            variant="danger"
            disabled={
              !rejectReason.trim() || actionId === rejectTarget?.id
            }
            onClick={submitReject}
          >
            確認退件
          </Button>
        </Modal.Footer>
      </Modal>
    </main>
  );
}
