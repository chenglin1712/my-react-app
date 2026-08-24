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

const EMPTY_FORM = {
  tribe: 'tayal',
  question_ab: '',
  question_ch: '',
  audio_url: '',
  image_url: '',
  answer: 1,
};

function formFrom(item) {
  return {
    tribe: item.tribe,
    question_ab: item.question_ab ?? '',
    question_ch: item.question_ch ?? '',
    audio_url: item.audio_url ?? '',
    image_url: item.image_url ?? '',
    answer: Number(item.answer) || 1,
  };
}

export default function QuizTrueFalse() {
  const { userData } = useAuth();
  const role = userData?.role;

  const {
    items, data, loading, error, setError, hasNext, page, setPage,
    filters, setFilters, search,
    actionId, handleAction, reject, editor,
  } = useReviewableContentCrud({
    endpoint: '/adminapi/quiz-bank/true-false/',
    initialFilters: { tribe: '', status: '' },
    emptyForm: { ...EMPTY_FORM },
    formFrom,
    deleteConfirmMessage: () => '確定要刪除這則初級是非題嗎？',
  });

  const { target: editTarget, form, setForm } = editor;
  // resetKey 用 editTarget 本身：openNew／openEdit 每次都會建立新的
  // editTarget 物件，關閉 Modal 再開另一筆時，前一筆還在飛的上傳結果
  // 不會被誤寫進現在正在編輯的這一筆（見 useMediaUpload 的說明）。
  const media = useMediaUpload({ resetKey: editTarget });
  const uploadingAudio = media.isUploading('audio_url');
  const uploadingImage = media.isUploading('image_url');

  // resourceType 是 'image' 或 'video'；uploadToCloudinary 的 transform
  // 預設就跟著 resourceType 走（圖片加 f_auto,q_auto、影音不加），跟這裡
  // 原本手寫 suffix 的行為一致，不需要另外指定。
  const uploadFile = (file, resourceType, field) => media.upload(file, field, {
    resourceType,
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
      audio_url: form.audio_url.trim(),
      image_url: form.image_url.trim(),
      answer: Number(form.answer),
    };

    if (
      !payload.question_ab
      || !payload.question_ch
      || !payload.audio_url
      || !payload.image_url
    ) {
      setError('族語句子、中文句意、音檔與圖片皆為必填');
      return;
    }

    if (uploadingAudio || uploadingImage) {
      setError('請等待檔案上傳完成');
      return;
    }

    // 欄位整理與必填檢查是是非題特有的，留在這裡；送出流程共用
    // useReviewableContentCrud 的 save（FE-2）。
    await editor.save(null, payload);
  };


  const canSave = (
    Boolean(form.question_ab.trim())
    && Boolean(form.question_ch.trim())
    && Boolean(form.audio_url.trim())
    && Boolean(form.image_url.trim())
    && !uploadingAudio
    && !uploadingImage
  );
  const formSubmitting = actionId === 'form';


  return (
    <main className="quiz-bank-admin-page">
      <div className="quiz-bank-page-heading">
        <div>
          <h1>初級是非題</h1>
          <p>管理初級族語句意判斷題、題目媒體與正確答案</p>
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
              {items.length ? (
                items.map((item) => (
                  <tr key={item.id}>
                    <td>{TRIBE_FULL_NAME_BY_SLUG[item.tribe] ?? item.tribe}</td>
                    <td className="quiz-bank-truncate-cell">
                      {item.question_ab}
                    </td>
                    <td>
                      {Number(item.answer) === 1
                        ? 'O 符合'
                        : 'X 不符合'}
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
                    沒有符合條件的初級是非題
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
                ? '編輯初級是非題'
                : '新增初級是非題'}
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
                onChange={(event) => setForm({
                  ...form,
                  question_ab: event.target.value,
                })}
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
                onChange={(event) => setForm({
                  ...form,
                  question_ch: event.target.value,
                })}
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
                onChange={(event) => uploadFile(
                  event.target.files?.[0],
                  'video',
                  'audio_url',
                )}
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
                onChange={(event) => uploadFile(
                  event.target.files?.[0],
                  'image',
                  'image_url',
                )}
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
                    className="quiz-bank-single-image-preview"
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
        controlId="quiz-true-false-reject-reason"
      />
    </main>
  );
}
