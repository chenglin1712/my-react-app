import { useState } from 'react';
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap';
import { Trash2 } from 'lucide-react';

import { apiPost } from '../../../utils/apiClient';
import { useActionLock } from '../hooks/useActionLock';

/**
 * 刪除帳號的確認對話框（FE-6，原本 inline 寫在 UserDetail.jsx 裡）。
 *
 * 後台必須逐字輸入該帳號 email 才能刪（P3 規劃的既有決策）；沒有 email 的帳號
 * （例如只用第三方或電話登入）改成輸入帳號 UID（WP-8 追加，後端 _delete_confirmation
 * 一樣以伺服器端真實值比對）。刪除橫跨 Firestore／Storage／Firebase Auth 三個系統、
 * 沒有跨系統交易，後端會逐項回報成功與否，成功後由父層顯示結果摘要（見 UserDetail.jsx 的 deleteResults）。
 */
export default function DeleteAccountModal({ show, user, uid, onClose, onDeleted, onError }) {
    const [confirmValue, setConfirmValue] = useState('');
    // 稽核 FE7b-01：錯誤顯示在對話框內，不然會出現在對話框背後的頁面上，操作者看不到。
    const [localError, setLocalError] = useState('');
    const deleteLock = useActionLock();
    const deleting = deleteLock.isLocked;

    const close = () => {
        if (deleting) return;
        setConfirmValue('');
        setLocalError('');
        onClose();
    };

    // 稽核 FE7b-15：Email 比對前先去頭尾空白並忽略大小寫（貼上常帶空白、Email 大小寫不拘）；
    // 送出時仍用帳號真實 email，後端是逐字比對。UID 有大小寫之分，只去頭尾空白。
    const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase();
    const hasEmail = Boolean(user?.email);
    const targetUid = user?.uid || uid;
    const confirmed = hasEmail
        ? normalizeEmail(confirmValue) === normalizeEmail(user.email)
        : Boolean(targetUid) && confirmValue.trim() === targetUid;

    const deleteAccount = () => {
        if (!user || !confirmed) return;

        deleteLock.runLocked('delete', async () => {
            onError('');
            setLocalError('');

            try {
                const result = await apiPost(
                    `/adminapi/users/${uid}/delete/`,
                    hasEmail ? { confirm_email: user.email } : { confirm_uid: targetUid },
                );

                setConfirmValue('');
                onDeleted(result.results);
            } catch (err) {
                setLocalError(err.message);
            }
        });
    };

    // 帳號還沒載入、或關閉後被清空時沒有可刪的對象：不輸出（react-bootstrap 的 show=false 仍會渲染子元件）
    if (!user) return null;

    return (
        <Modal
            show={show}
            onHide={close}
            centered
            backdrop={deleting ? 'static' : true}
            keyboard={!deleting}
            dialogClassName="admin-modal admin-modal--danger"
        >
            <Modal.Header closeButton={!deleting}>
                <Modal.Title>確認刪除帳號</Modal.Title>
            </Modal.Header>

            <Modal.Body>
                {localError && <Alert variant="danger" role="alert">{localError}</Alert>}

                {hasEmail ? (
                    <Alert variant="danger">
                        此操作無法復原，請輸入該帳號的 email（{user.email}）以確認刪除。
                    </Alert>
                ) : (
                    <Alert variant="danger">
                        此操作無法復原。此帳號沒有 email（例如只用第三方或電話登入），
                        無法用 email 確認，請改為輸入該帳號的 UID（{targetUid}）以確認刪除。
                    </Alert>
                )}

                <Form.Group controlId="delete-confirm-value">
                    <Form.Label>{hasEmail ? '帳號 Email' : '帳號 UID'}</Form.Label>
                    <Form.Control
                        aria-label={hasEmail ? '輸入帳號 Email 以確認刪除' : '輸入帳號 UID 以確認刪除'}
                        autoComplete="off"
                        value={confirmValue}
                        disabled={deleting}
                        onChange={(event) => setConfirmValue(event.target.value)}
                    />
                </Form.Group>
            </Modal.Body>

            <Modal.Footer>
                <Button variant="secondary" disabled={deleting} onClick={close}>
                    取消
                </Button>

                <Button
                    variant="danger"
                    disabled={deleting || !confirmed}
                    onClick={deleteAccount}
                >
                    {deleting ? <Spinner animation="border" size="sm" /> : <Trash2 size={16} />}
                    確認刪除
                </Button>
            </Modal.Footer>
        </Modal>
    );
}
