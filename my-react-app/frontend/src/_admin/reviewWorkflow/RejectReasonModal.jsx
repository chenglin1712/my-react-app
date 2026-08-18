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

    return (
        <Modal show={Boolean(target)} onHide={close} centered>
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
                <Button variant="secondary" onClick={close}>取消</Button>
                <Button
                    variant="danger"
                    disabled={!reason.trim() || actionId === target?.id}
                    onClick={submit}
                >
                    {isRevision ? '確認退件修改' : '確認退件'}
                </Button>
            </Modal.Footer>
        </Modal>
    );
}
