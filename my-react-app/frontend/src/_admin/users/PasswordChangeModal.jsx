import { useState } from 'react';
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap';
import { KeyRound } from 'lucide-react';

import { apiPost } from '../../../utils/apiClient';
import { useActionLock } from '../hooks/useActionLock';

const EMPTY_PASSWORD_FORM = {
    newPassword: '',
    confirmPassword: '',
    confirmEmail: '',
};

/**
 * 管理員代使用者變更密碼的對話框（FE-6，原本 inline 寫在 UserDetail.jsx 裡）。
 *
 * 這是整個使用者管理頁最敏感的操作（等於能無聲完整接管帳號登入身分），
 * 比照刪除帳號的確認強度：要求逐字輸入目標帳號 email 才能送出。
 */
export default function PasswordChangeModal({ show, user, uid, onClose, onSaved, onError }) {
    const [form, setForm] = useState(EMPTY_PASSWORD_FORM);
    const saveLock = useActionLock();
    const saving = saveLock.isLocked;

    const updateForm = (field, value) => {
        setForm((current) => ({ ...current, [field]: value }));
    };

    const close = () => {
        if (saving) return;
        setForm(EMPTY_PASSWORD_FORM);
        onClose();
    };

    const canSubmit = (
        form.newPassword.length >= 6
        && form.confirmPassword === form.newPassword
        && form.confirmEmail === user?.email
    );

    const changePassword = (event) => {
        event.preventDefault();
        if (!canSubmit) return;

        saveLock.runLocked('change-password', async () => {
            onError('');

            try {
                const result = await apiPost(`/adminapi/users/${uid}/password/`, {
                    new_password: form.newPassword,
                    confirm_email: form.confirmEmail,
                });

                setForm(EMPTY_PASSWORD_FORM);
                // 密碼變更本身一定成功才會走到這裡；sessions_revoked 是否為 false
                // 由後端誠實回報（見 user_password() 的說明），不能一律顯示「已撤銷」
                // 誤導管理者以為舊登入狀態已經失效。
                onSaved(
                    result.sessions_revoked
                        ? '密碼已變更，並已撤銷此帳號現有的登入狀態。'
                        : '密碼已變更，但撤銷登入狀態失敗，此帳號的舊登入可能仍然有效，請稍後重新嘗試或聯繫系統管理員。',
                );
            } catch (err) {
                onError(err.message);
            }
        });
    };

    return (
        <Modal
            show={show}
            onHide={close}
            centered
            backdrop={saving ? 'static' : true}
            keyboard={!saving}
        >
            <Form onSubmit={changePassword}>
                <Modal.Header closeButton={!saving}>
                    <Modal.Title>變更密碼</Modal.Title>
                </Modal.Header>

                <Modal.Body>
                    <Alert variant="danger">
                        此操作無法復原，請輸入該帳號的 email（{user.email}）以確認變更密碼。
                    </Alert>

                    <Form.Group className="mb-3" controlId="password-new">
                        <Form.Label>新密碼</Form.Label>
                        <Form.Control
                            type="password"
                            minLength={6}
                            required
                            autoComplete="new-password"
                            disabled={saving}
                            value={form.newPassword}
                            onChange={(event) => updateForm('newPassword', event.target.value)}
                        />
                        <Form.Text>密碼至少需要 6 個字元。</Form.Text>
                    </Form.Group>

                    <Form.Group className="mb-3" controlId="password-confirm">
                        <Form.Label>確認新密碼</Form.Label>
                        <Form.Control
                            type="password"
                            minLength={6}
                            required
                            autoComplete="new-password"
                            disabled={saving}
                            value={form.confirmPassword}
                            isInvalid={
                                Boolean(form.confirmPassword)
                                && form.confirmPassword !== form.newPassword
                            }
                            onChange={(event) => updateForm('confirmPassword', event.target.value)}
                        />
                        <Form.Control.Feedback type="invalid">
                            兩次輸入的密碼不相同。
                        </Form.Control.Feedback>
                    </Form.Group>

                    <Form.Group controlId="password-confirm-email">
                        <Form.Label>帳號 Email</Form.Label>
                        <Form.Control
                            aria-label="輸入帳號 Email 以確認變更密碼"
                            autoComplete="off"
                            disabled={saving}
                            value={form.confirmEmail}
                            onChange={(event) => updateForm('confirmEmail', event.target.value)}
                        />
                    </Form.Group>
                </Modal.Body>

                <Modal.Footer>
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={saving}
                        onClick={close}
                    >
                        取消
                    </Button>

                    <Button type="submit" variant="danger" disabled={saving || !canSubmit}>
                        {saving ? <Spinner animation="border" size="sm" /> : <KeyRound size={16} />}
                        確認變更密碼
                    </Button>
                </Modal.Footer>
            </Form>
        </Modal>
    );
}
