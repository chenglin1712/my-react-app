import { Button, Form, Modal } from 'react-bootstrap';

/**
 * 退件理由對話框（FE-2）——「退件」與「退件修改」共用同一個對話框，差別只在
 * 標題與確認按鈕的文字。原本每個送審面板都各自 inline 寫一份完全一樣的。
 *
 * 直接吃 useReviewableContentCrud 回傳的 `reject` 群組，呼叫端不需要自己
 * 接線每一個 state 與 setter。
 */
export default function RejectReasonModal({ reject, actionId, controlId }) {
    const { target, reason, setReason, isRevision, close, submit } = reject;
    const submitting = actionId === target?.id;

    // 送出中不能被關掉——不然使用者按了確認、退件理由送出中途手滑點到背景／
    // 按 Escape，會直接關掉對話框；失敗時 hook 那層特意保留的理由文字也就
    // 沒有意義了（表單已經被收掉，使用者看不到）。
    const handleHide = () => {
        if (submitting) return;
        close();
    };

    return (
        <Modal
            show={Boolean(target)}
            onHide={handleHide}
            backdrop={submitting ? 'static' : true}
            keyboard={!submitting}
            centered
        >
            <Modal.Header closeButton>
                <Modal.Title>{isRevision ? '退件修改原因' : '退件原因'}</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                <Form.Group controlId={controlId}>
                    <Form.Label>請說明需要修改的內容</Form.Label>
                    <Form.Control
                        as="textarea"
                        rows={4}
                        required
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        isInvalid={Boolean(target) && !reason.trim()}
                    />
                    <Form.Control.Feedback type="invalid">
                        退件理由為必填
                    </Form.Control.Feedback>
                </Form.Group>
            </Modal.Body>
            <Modal.Footer>
                <Button type="button" variant="secondary" onClick={handleHide} disabled={submitting}>
                    取消
                </Button>
                <Button
                    type="button"
                    variant="danger"
                    disabled={!reason.trim() || submitting}
                    onClick={submit}
                >
                    {submitting ? '送出中…' : (isRevision ? '確認退件修改' : '確認退件')}
                </Button>
            </Modal.Footer>
        </Modal>
    );
}
