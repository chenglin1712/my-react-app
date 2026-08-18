import { useState } from 'react';
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap';
import { Trash2 } from 'lucide-react';

import { apiPost } from '../../../utils/apiClient';

/**
 * 刪除帳號的確認對話框（FE-6，原本 inline 寫在 UserDetail.jsx 裡）。
 *
 * 後台必須逐字輸入該帳號 email 才能刪（P3 規劃的既有決策）。刪除橫跨
 * Firestore／Storage／Firebase Auth 三個系統、沒有跨系統交易，後端會逐項
 * 回報成功與否，成功後由父層顯示結果摘要（見 UserDetail.jsx 的 deleteResults）。
 */
export default function DeleteAccountModal({ show, user, uid, onClose, onDeleted, onError }) {
    const [confirmEmail, setConfirmEmail] = useState('');
    const [deleting, setDeleting] = useState(false);

    const close = () => {
        if (deleting) return;
        setConfirmEmail('');
        onClose();
    };

    const deleteAccount = async () => {
        if (!user || confirmEmail !== user.email) return;

        setDeleting(true);
        onError('');

        try {
            const result = await apiPost(`/adminapi/users/${uid}/delete/`, {
                confirm_email: confirmEmail,
            });

            setConfirmEmail('');
            onDeleted(result.results);
        } catch (err) {
            onError(err.message);
        } finally {
            setDeleting(false);
        }
    };

    return (
        <Modal
            show={show}
            onHide={close}
            centered
            backdrop={deleting ? 'static' : true}
            keyboard={!deleting}
        >
            <Modal.Header closeButton={!deleting}>
                <Modal.Title>確認刪除帳號</Modal.Title>
            </Modal.Header>

            <Modal.Body>
                <Alert variant="danger">
                    此操作無法復原，請輸入該帳號的 email（{user.email}）以確認刪除。
                </Alert>

                <Form.Group controlId="delete-confirm-email">
                    <Form.Label>帳號 Email</Form.Label>
                    <Form.Control
                        aria-label="輸入帳號 Email 以確認刪除"
                        autoComplete="off"
                        value={confirmEmail}
                        disabled={deleting}
                        onChange={(event) => setConfirmEmail(event.target.value)}
                    />
                </Form.Group>
            </Modal.Body>

            <Modal.Footer>
                <Button variant="secondary" disabled={deleting} onClick={close}>
                    取消
                </Button>

                <Button
                    variant="danger"
                    disabled={deleting || confirmEmail !== user.email}
                    onClick={deleteAccount}
                >
                    {deleting ? <Spinner animation="border" size="sm" /> : <Trash2 size={16} />}
                    確認刪除
                </Button>
            </Modal.Footer>
        </Modal>
    );
}
