import { useEffect, useState } from 'react';
import { Alert, Button, Form, Modal } from 'react-bootstrap';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { auth } from '../../../../firebase';
import { REAUTH_REQUIRED_EVENT, markAdminSession } from './adminSession';

/**
 * 後端回 401 reauth_required（距離上次用密碼驗證超過 30 分鐘）時彈出的重新驗證視窗。
 *
 * 用彈窗而不是導去登入頁：管理員常常表單填到一半才過期，導頁會讓填到一半的內容全部消失。
 * 彈窗蓋在原本的頁面上，驗證成功後原頁狀態原封不動，使用者再按一次剛才的動作即可。
 * （不自動重送剛才失敗的請求：寫入類請求自動重送可能造成重複操作，由使用者決定。）
 */
export default function AdminReauthModal() {
    const [show, setShow] = useState(false);
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState(false);

    useEffect(() => {
        const open = () => {
            setPassword('');
            setError('');
            setDone(false);
            setShow(true);
        };
        window.addEventListener(REAUTH_REQUIRED_EVENT, open);
        return () => window.removeEventListener(REAUTH_REQUIRED_EVENT, open);
    }, []);

    const email = auth.currentUser?.email ?? '';

    const submit = async (event) => {
        event.preventDefault();
        if (!auth.currentUser || !email) {
            setError('找不到目前的登入帳號，請重新整理頁面後再試。');
            return;
        }
        if (!password) {
            setError('請輸入密碼。');
            return;
        }
        setBusy(true);
        setError('');
        try {
            await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(email, password));
            // 強制換發新的 ID token：舊 token 裡的 auth_time 還是過期的那一個
            await auth.currentUser.getIdToken(true);
            markAdminSession(auth.currentUser.uid);
            setDone(true);
            setPassword('');
        } catch (err) {
            if (err?.code?.includes('auth/invalid-credential') || err?.code?.includes('auth/wrong-password')) {
                setError('密碼錯誤，請再試一次。');
            } else if (err?.code?.includes('auth/too-many-requests')) {
                setError('嘗試次數過多，請稍後再試。');
            } else {
                setError('重新驗證失敗：' + (err?.message ?? '未知錯誤'));
            }
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal show={show} onHide={() => !busy && setShow(false)} centered backdrop="static" dialogClassName="admin-reauth-dialog">
            <Form onSubmit={submit}>
                <Modal.Header closeButton={!busy}>
                    <Modal.Title>請重新驗證身分</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {done ? (
                        <Alert variant="success" className="mb-0">
                            已重新驗證。頁面上的內容都還在，請再執行一次剛才的操作。
                        </Alert>
                    ) : (
                        <>
                            <p>為了安全，後台操作需要在 30 分鐘內用密碼驗證過身分。你目前填寫的內容不會消失。</p>
                            {error && <Alert variant="danger" className="py-2">{error}</Alert>}
                            <Form.Group controlId="admin-reauth-email" className="mb-3">
                                <Form.Label>帳號</Form.Label>
                                <Form.Control type="email" value={email} readOnly plaintext />
                            </Form.Group>
                            <Form.Group controlId="admin-reauth-password">
                                <Form.Label>密碼</Form.Label>
                                <Form.Control
                                    type="password"
                                    autoComplete="current-password"
                                    autoFocus
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                            </Form.Group>
                        </>
                    )}
                </Modal.Body>
                <Modal.Footer>
                    {done ? (
                        <Button variant="primary" onClick={() => setShow(false)}>關閉</Button>
                    ) : (
                        <>
                            <Button variant="outline-secondary" onClick={() => setShow(false)} disabled={busy}>稍後再說</Button>
                            <Button type="submit" variant="primary" disabled={busy}>驗證</Button>
                        </>
                    )}
                </Modal.Footer>
            </Form>
        </Modal>
    );
}
