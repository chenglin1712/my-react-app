import { useEffect, useState } from 'react';
import { Button, Form, Modal, Spinner } from 'react-bootstrap';
import { Edit3, ImagePlus } from 'lucide-react';

import { apiPatch } from '../../../utils/apiClient';
import { useActionLock } from '../hooks/useActionLock';
import { useMediaUpload } from '../hooks/useMediaUpload';

/**
 * 編輯使用者基本資料的對話框（FE-6，原本 inline 寫在 UserDetail.jsx 裡）。
 *
 * 表單值、頭像預覽、上傳中旗標都是「這個對話框開著的期間」才有意義的狀態，
 * 所以留在這裡自己管理——父層只需要知道「要不要顯示」以及「存檔成功了」。
 * 這個 Modal 本身是條件渲染出來的（見 UserDetail.jsx），關閉就會卸載、
 * 下次開啟是全新 instance，不需要父層再幫忙塞一次表單初始化。
 */
export default function ProfileEditModal({ show, user, uid, onClose, onSaved, onError }) {
    const [form, setForm] = useState({
        name: user?.name ?? '',
        identity: user?.identity ?? '',
        avatar_url: user?.avatar_url ?? '',
        email: user?.email ?? '',
    });

    const media = useMediaUpload();
    const saveLock = useActionLock();
    const saving = saveLock.isLocked;
    const avatarUploading = media.isUploading('avatar');
    const avatarPreview = media.previews.avatar ?? user?.avatar_url ?? '';
    const busy = saving || avatarUploading;

    // 這個對話框的其他錯誤（存檔失敗等）都是透過 onError 顯示在父層共用的
    // Alert，上傳錯誤也走同一個管道，畫面上才不會出現兩種不同的錯誤呈現
    // 方式。
    useEffect(() => {
        if (media.error) onError(media.error);
    }, [media.error, onError]);

    const updateForm = (field, value) => {
        setForm((current) => ({ ...current, [field]: value }));
    };

    const close = () => {
        if (busy) return;
        onClose();
    };

    const handleAvatarFileChange = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        media.upload(file, 'avatar', {
            localPreview: true,
            onUploaded: (secureUrl) => updateForm('avatar_url', secureUrl),
        });
    };

    const saveProfile = (event) => {
        event.preventDefault();

        if (avatarUploading) {
            onError('請等待頭像上傳完成');
            return;
        }

        saveLock.runLocked('save', async () => {
            onError('');

            try {
                await apiPatch(`/adminapi/users/${uid}/profile/`, {
                    name: form.name,
                    identity: form.identity,
                    avatar_url: form.avatar_url,
                    email: form.email,
                });

                onSaved('使用者資料已更新。');
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
            backdrop={busy ? 'static' : true}
            keyboard={!busy}
        >
            <Form onSubmit={saveProfile}>
                <Modal.Header closeButton={!busy}>
                    <Modal.Title>編輯使用者資料</Modal.Title>
                </Modal.Header>

                <Modal.Body>
                    <Form.Group className="mb-3" controlId="profile-name">
                        <Form.Label>姓名</Form.Label>
                        <Form.Control
                            required
                            disabled={saving}
                            value={form.name}
                            onChange={(event) => updateForm('name', event.target.value)}
                        />
                    </Form.Group>

                    <Form.Group className="mb-3" controlId="profile-identity">
                        <Form.Label>身分</Form.Label>
                        <Form.Control
                            disabled={saving}
                            value={form.identity}
                            onChange={(event) => updateForm('identity', event.target.value)}
                        />
                    </Form.Group>

                    <Form.Group className="mb-3" controlId="profile-avatar-url">
                        <Form.Label>頭像</Form.Label>
                        <div className="user-avatar-uploader">
                            {avatarPreview ? (
                                <img
                                    className="user-avatar-uploader-preview"
                                    src={avatarPreview}
                                    alt="頭像預覽"
                                />
                            ) : (
                                <div className="user-avatar-uploader-placeholder">
                                    <ImagePlus size={24} aria-hidden="true" />
                                </div>
                            )}

                            <div>
                                <Form.Control
                                    type="file"
                                    accept="image/jpeg,image/png"
                                    disabled={busy}
                                    onChange={handleAvatarFileChange}
                                />
                                <Form.Text>僅接受 JPG／PNG，檔案大小不得超過 5 MB。</Form.Text>
                                {avatarUploading && (
                                    <span className="user-upload-status">
                                        <Spinner animation="border" size="sm" />
                                        頭像上傳中……
                                    </span>
                                )}
                            </div>
                        </div>
                    </Form.Group>

                    <Form.Group controlId="profile-email">
                        <Form.Label>Email</Form.Label>
                        <Form.Control
                            type="email"
                            required
                            disabled={saving}
                            value={form.email}
                            onChange={(event) => updateForm('email', event.target.value)}
                        />
                    </Form.Group>
                </Modal.Body>

                <Modal.Footer>
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={busy}
                        onClick={close}
                    >
                        取消
                    </Button>

                    <Button type="submit" disabled={busy}>
                        {saving ? <Spinner animation="border" size="sm" /> : <Edit3 size={16} />}
                        儲存
                    </Button>
                </Modal.Footer>
            </Form>
        </Modal>
    );
}
