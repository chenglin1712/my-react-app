import { useState } from 'react';
import { Button, Form, Modal } from 'react-bootstrap';
import { createRoot } from 'react-dom/client';

/**
 * 後台危險操作（刪除）的確認對話框。
 *
 * 原本各頁用瀏覽器內建的 window.confirm：樣式與整個後台不一致、只能放一行純文字
 * （沒辦法寫「刪除後會怎樣」「爬蟲來源不會被重新建立」這類說明）、也沒辦法要求輸入文字確認。
 *
 * 用法（跟 window.confirm 一樣，回傳 Promise<boolean>）：
 *   if (!(await confirmAction({ title: '刪除公告', message: <p>…</p>, confirmLabel: '刪除', requireText: '刪除' }))) return;
 *
 * requireText：要求使用者輸入這段文字才能按下確認（風險較高的刪除才用）。
 */
export function ConfirmActionModal({ title, message, confirmLabel = '確認', cancelLabel = '取消', danger = true, requireText = '', onResult }) {
    const [typed, setTyped] = useState('');
    const confirmed = !requireText || typed.trim() === requireText;

    return (
        <Modal show onHide={() => onResult(false)} centered animation={false} backdrop="static" aria-labelledby="confirm-action-title">
            <Modal.Header closeButton>
                <Modal.Title id="confirm-action-title" as="h2" className="h5">{title}</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                <div>{message}</div>
                {requireText && (
                    <Form.Group className="mt-3" controlId="confirm-action-text">
                        <Form.Label>請輸入「{requireText}」以確認</Form.Label>
                        <Form.Control
                            value={typed}
                            autoComplete="off"
                            onChange={(event) => setTyped(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' && confirmed && !event.nativeEvent.isComposing) onResult(true);
                            }}
                        />
                    </Form.Group>
                )}
            </Modal.Body>
            <Modal.Footer>
                <Button type="button" variant="outline-secondary" onClick={() => onResult(false)}>{cancelLabel}</Button>
                <Button type="button" variant={danger ? 'danger' : 'primary'} disabled={!confirmed} onClick={() => onResult(true)}>
                    {confirmLabel}
                </Button>
            </Modal.Footer>
        </Modal>
    );
}

export function confirmAction(options) {
    return new Promise((resolve) => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        let settled = false;
        const onResult = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
            // 先把 Modal 渲染成空（讓它自己做焦點還原與 body 的清理），下一個 tick 再卸載整個容器
            root.render(null);
            setTimeout(() => {
                root.unmount();
                container.remove();
            }, 0);
        };
        root.render(<ConfirmActionModal {...options} onResult={onResult} />);
    });
}
