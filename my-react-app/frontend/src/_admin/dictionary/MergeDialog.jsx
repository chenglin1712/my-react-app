import { useState } from 'react';
import {
    Alert, Button, Form, Modal, Spinner,
} from 'react-bootstrap';
import { mergeTaxonomyTerm } from './dictionaryApi';
import { useActionLock } from '../hooks/useActionLock';

/**
 * 合併不可逆——比照 UserDetail.jsx 刪除帳號的既有模式：使用者必須逐字
 * 輸入來源項目的名稱/詞綴才能解鎖確認按鈕，不是單純點一下 Modal 按鈕
 * 就能送出（見規劃文件 P4 §4「前端要求輸入來源名稱二次確認」）。
 */
export default function MergeDialog({
    kind, kindLabel, isAffix, source, options, onClose, onMerged,
}) {
    const [targetId, setTargetId] = useState('');
    const [confirmText, setConfirmText] = useState('');
    const [error, setError] = useState('');
    // 合併是不可逆操作，同一個 tick 內的重複送出（例如雙擊確認按鈕）不能
    // 只靠 state 擋——runLocked 用 ref 做同步鎖，擋得住這一種情境。
    const { isLocked: pending, runLocked } = useActionLock();

    const sourceLabel = isAffix ? source.affix : source.name;
    const canSubmit = targetId !== '' && confirmText === sourceLabel && !pending;

    const submit = (event) => {
        event.preventDefault();
        if (!canSubmit) return undefined;

        return runLocked('merge', async () => {
            setError('');
            try {
                const result = await mergeTaxonomyTerm(kind, source.id, Number(targetId));
                onMerged(result);
            } catch (err) {
                setError(err.message);
            }
        });
    };

    return (
        <Modal
            show
            onHide={pending ? undefined : onClose}
            centered
            backdrop={pending ? 'static' : true}
            keyboard={!pending}
        >
            <Form onSubmit={submit}>
                <Modal.Header closeButton={!pending}>
                    <Modal.Title>{`合併${kindLabel}`}</Modal.Title>
                </Modal.Header>

                <Modal.Body>
                    <Alert variant="danger">
                        {`此操作無法復原。「${sourceLabel}」底下全部 ${source.reference_count} 處引用會`}
                        改指向合併目標，
                        {`「${sourceLabel}」本身會被刪除。`}
                    </Alert>

                    {error && <Alert variant="danger">{error}</Alert>}

                    <Form.Group className="mb-3" controlId="taxonomy-merge-target">
                        <Form.Label>合併目標</Form.Label>
                        <Form.Select
                            value={targetId}
                            disabled={pending}
                            onChange={(event) => setTargetId(event.target.value)}
                            required
                        >
                            <option value="">{`請選擇要併入的${kindLabel}`}</option>
                            {options.map((option) => (
                                <option key={option.id} value={option.id}>
                                    {isAffix ? option.affix : option.name}
                                </option>
                            ))}
                        </Form.Select>
                        {isAffix && options.length === 0 && (
                            <Form.Text>沒有其他同族語的詞綴可以合併。</Form.Text>
                        )}
                    </Form.Group>

                    <Form.Group controlId="taxonomy-merge-confirm-name">
                        <Form.Label>{`請輸入「${sourceLabel}」以確認合併`}</Form.Label>
                        <Form.Control
                            aria-label={`輸入「${sourceLabel}」以確認合併`}
                            autoComplete="off"
                            value={confirmText}
                            disabled={pending}
                            onChange={(event) => setConfirmText(event.target.value)}
                        />
                    </Form.Group>
                </Modal.Body>

                <Modal.Footer>
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={pending}
                        onClick={onClose}
                    >
                        取消
                    </Button>

                    <Button
                        type="submit"
                        variant="danger"
                        disabled={!canSubmit}
                    >
                        {pending ? <Spinner animation="border" size="sm" /> : '確認合併'}
                    </Button>
                </Modal.Footer>
            </Form>
        </Modal>
    );
}
