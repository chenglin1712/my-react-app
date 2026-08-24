import { Alert, Button, Form, Modal, Spinner, Table } from 'react-bootstrap';
import { Plus } from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { TRIBE_FULL_NAME_BY_SLUG } from '../../constants/tribes';
import RejectReasonModal from '../reviewWorkflow/RejectReasonModal';
import ReviewActions from '../reviewWorkflow/ReviewActions';
import ReviewPagination from '../reviewWorkflow/ReviewPagination';
import { useReviewableContentCrud } from '../reviewWorkflow/useReviewableContentCrud';
import { useMediaUpload } from '../hooks/useMediaUpload';
import {
  QUIZ_BANK_EDITORS as CONTENT_EDITORS,
  QUIZ_BANK_ROLES,
  QUIZ_BANK_STATUSES as STATUSES,
  QuizStatusBadge,
} from './quizBankReviewMeta';
import '../../../static/css/_admin/quiz-bank.css';

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

  const {
    items, data, loading, error, setError, hasNext, page, setPage,
    filters, setFilters, search,
    actionId, handleAction, reject, editor,
  } = useReviewableContentCrud({
    endpoint: '/adminapi/quiz-bank/choice/',
    initialFilters: { tribe: '', status: '' },
    emptyForm: { ...EMPTY_FORM },
    formFrom,
    deleteConfirmMessage: () => '確定要刪除這則中級選擇題嗎？',
  });

  const { target: editTarget, form, setForm } = editor;
  // resetKey 用 editTarget 本身：openNew／openEdit 每次都會建立新的
  // editTarget 物件，關閉 Modal 再開另一筆時，前一筆還在飛的上傳結果
  // 不會被誤寫進現在正在編輯的這一筆（見 useMediaUpload 的說明）。
  const media = useMediaUpload({ resetKey: editTarget });

  const uploadImage = (file, field) => media.upload(file, field, {
    onUploaded: (secureUrl) => setForm((current) => ({
      ...current,
      [field]: secureUrl,
    })),
  });

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

    if (media.uploadingKey) {
      setError('請等待圖片上傳完成');
      return;
    }

    // 這個內容類型在送出前要先整理欄位（trim、answer 轉數字）並做必填檢查，
    // 那是選擇題特有的規則，留在這裡；實際的「已發布就送出待審修改、否則
    // 直接 PATCH」流程共用 useReviewableContentCrud 的 save（FE-2）。
    await editor.save(null, payload);
  };


  const canSave = (
    Boolean(form.question_ab.trim())
    && Boolean(form.question_ch.trim())
    && Boolean(form.image_a_url.trim())
    && Boolean(form.image_b_url.trim())
    && Boolean(form.image_c_url.trim())
    && !media.uploadingKey
  );
  const formSubmitting = actionId === 'form';

  return (
    <main className="quiz-bank-admin-page">
      <div className="quiz-bank-page-heading">
        <div>
          <h1>中級選擇題</h1>
          <p>管理中級族語圖片選擇題、三個圖片選項與正確答案</p>
        </div>
      </div>

      {(error || media.error) && <Alert variant="danger">{error || media.error}</Alert>}

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
          <Button onClick={editor.openNew}>
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
              {items.length ? (
                items.map((item) => (
                  <tr key={item.id}>
                    <td>{TRIBE_FULL_NAME_BY_SLUG[item.tribe] ?? item.tribe}</td>
                    <td className="quiz-bank-truncate-cell">
                      {item.question_ab}
                    </td>
                    <td>
                      {OPTION_LABELS[Number(item.answer) - 1] ?? '—'}
                    </td>
                    <td>
                      <QuizStatusBadge item={item} />
                    </td>
                    <td>{item.created_by || '—'}</td>
                    <td>
                      <div className="quiz-bank-row-actions">
                        <ReviewActions
                          item={item}
                          role={role}
                          roles={QUIZ_BANK_ROLES}
                          busy={actionId === item.id}
                          disabled={Boolean(actionId) && actionId !== item.id}
                          onAction={handleAction}
                        />
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

        <ReviewPagination
          data={data}
          page={page}
          setPage={setPage}
          loading={loading}
          hasNext={hasNext}
        />
      </div>

      <Modal
        show={Boolean(editTarget)}
        onHide={formSubmitting ? undefined : editor.close}
        centered
        size="lg"
        backdrop={formSubmitting ? 'static' : true}
        keyboard={!formSubmitting}
      >
        <Form onSubmit={saveForm}>
          <Modal.Header closeButton={!formSubmitting}>
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

            <div className="quiz-bank-choice-images">
              {OPTION_LABELS.map((label, index) => {
                const field = `image_${label.toLowerCase()}_url`;
                const uploading = media.isUploading(field);

                return (
                  <div
                    key={field}
                    className="quiz-bank-field quiz-bank-choice-option-card"
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
                        disabled={Boolean(media.uploadingKey)}
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
                        className="mt-2 quiz-bank-option-image-preview"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </Modal.Body>

          <Modal.Footer>
            <Button
              type="button"
              variant="secondary"
              disabled={formSubmitting}
              onClick={editor.close}
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={!canSave || formSubmitting}
            >
              {formSubmitting && (
                <Spinner animation="border" size="sm" />
              )}{' '}
              儲存
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <RejectReasonModal
        reject={reject}
        actionId={actionId}
        controlId="quiz-choice-reject-reason"
      />
    </main>
  );
}
