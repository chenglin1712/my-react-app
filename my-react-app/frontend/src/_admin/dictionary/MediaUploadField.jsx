import { useId, useState } from 'react';
import {
    Alert,
    Button,
    Form,
    Spinner,
} from 'react-bootstrap';
import {
    FileAudio,
    Image as ImageIcon,
    Trash2,
    Upload,
} from 'lucide-react';

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const KIND_META = {
    image: {
        noun: '圖片',
        accept: 'image/*',
        endpoint: 'image/upload/f_auto,q_auto',
    },
    audio: {
        noun: '音檔',
        accept: 'audio/*',
        endpoint: 'video/upload',
    },
};

export default function MediaUploadField({
    kind,
    value,
    onChange,
    label,
    disabled = false,
}) {
    const inputId = useId();
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');

    const meta = KIND_META[kind];

    if (!meta) {
        throw new Error(
            `MediaUploadField 不支援 kind="${kind}"，只能使用 image 或 audio`,
        );
    }

    const handleFileChange = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (file.size > MAX_FILE_SIZE) {
            setError(`${meta.noun}不得超過 5 MB，請重新選擇。`);
            event.target.value = '';
            return;
        }

        setError('');
        setUploading(true);

        const formData = new FormData();
        formData.append('file', file);
        formData.append(
            'upload_preset',
            import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET,
        );
        formData.append(
            'cloud_name',
            import.meta.env.VITE_CLOUDINARY_CLOUD_NAME,
        );

        try {
            const response = await fetch(
                `https://api.cloudinary.com/v1_1/`
                + `${import.meta.env.VITE_CLOUDINARY_CLOUD_NAME}/`
                + meta.endpoint,
                {
                    method: 'POST',
                    body: formData,
                },
            );

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();

            if (!result.secure_url) {
                throw new Error('Cloudinary 回應缺少 secure_url');
            }

            onChange(result.secure_url);
        } catch (err) {
            console.error(`${meta.noun}上傳失敗`, err);
            setError(`${meta.noun}上傳失敗`);
        } finally {
            setUploading(false);
            event.target.value = '';
        }
    };

    return (
        <div className="dictionary-media-field">
            {label && (
                <Form.Label htmlFor={inputId}>
                    {label}
                </Form.Label>
            )}

            {value && kind === 'image' && (
                <div className="dictionary-image-preview">
                    <img src={value} alt={`${label || '圖片'}預覽`} />
                </div>
            )}

            {value && kind === 'audio' && (
                <div className="dictionary-audio-preview">
                    <FileAudio size={20} aria-hidden="true" />
                    <audio controls src={value}>
                        您的瀏覽器不支援音訊播放。
                    </audio>
                </div>
            )}

            {!value && (
                <div className="dictionary-media-placeholder">
                    {kind === 'image'
                        ? <ImageIcon size={25} aria-hidden="true" />
                        : <FileAudio size={25} aria-hidden="true" />}
                    <span>尚未上傳{meta.noun}</span>
                </div>
            )}

            <div className="dictionary-media-controls">
                <Form.Control
                    id={inputId}
                    type="file"
                    accept={meta.accept}
                    disabled={disabled || uploading}
                    onChange={handleFileChange}
                />

                {value && !disabled && (
                    <Button
                        type="button"
                        variant="outline-danger"
                        size="sm"
                        disabled={uploading}
                        onClick={() => {
                            setError('');
                            onChange('');
                        }}
                    >
                        <Trash2 size={15} />
                        移除
                    </Button>
                )}
            </div>

            {uploading && (
                <div
                    className="dictionary-upload-status"
                    role="status"
                >
                    <Spinner animation="border" size="sm" />
                    <Upload size={15} aria-hidden="true" />
                    {meta.noun}上傳中…
                </div>
            )}

            {error && (
                <Alert
                    className="dictionary-upload-error"
                    variant="danger"
                >
                    {error}
                </Alert>
            )}

            <Form.Text>檔案大小上限為 5 MB。</Form.Text>
        </div>
    );
}
