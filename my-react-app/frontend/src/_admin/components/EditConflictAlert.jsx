import { useRef, useState } from 'react';
import { Alert, Button, Form } from 'react-bootstrap';

/**
 * 「複製我的版本」：把使用者自己的內容放進剪貼簿。
 * 剪貼簿不可用或被拒絕（非 https、瀏覽器權限）時，退回顯示唯讀文字框並自動全選，讓使用者手動 Ctrl+C。
 * WP-8 追加：長篇富文字被「載入最新版本」整份換掉後就找不回來，至少要有一條帶走自己內容的路。
 */
function MyVersionCopy({ text }) {
    const [status, setStatus] = useState('idle'); // idle | copied | fallback
    const areaRef = useRef(null);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setStatus('copied');
        } catch {
            setStatus('fallback');
            // 文字框要等 render 出來才選得到
            setTimeout(() => areaRef.current?.select(), 0);
        }
    };

    return (
        <>
            <Button variant="outline-dark" size="sm" onClick={copy}>複製我的版本</Button>
            {status === 'copied' && <span role="status" className="ms-2">已複製到剪貼簿</span>}
            {status === 'fallback' && (
                <div className="w-100 mt-2">
                    <Form.Label htmlFor="my-version-fallback" className="small mb-1">
                        無法自動複製，請在下方文字框全選後手動複製：
                    </Form.Label>
                    <Form.Control
                        id="my-version-fallback"
                        as="textarea"
                        rows={6}
                        readOnly
                        value={text}
                        ref={areaRef}
                        onFocus={(event) => event.target.select()}
                    />
                </div>
            )}
        </>
    );
}

/**
 * 「有人剛更新過」的提示與出路。只顯示錯誤沒有出路，使用者除了整頁重新整理（會丟掉自己的輸入）
 * 之外別無選擇；這裡提供「載入最新版本」按鈕，由呼叫端決定載入後如何處理目前輸入。
 *
 * @param {Function} props.onReload 載入最新版本
 * @param {boolean}  [props.busy]   載入中
 * @param {string}   [props.children] 補充說明
 * @param {string}   [props.myVersionText] 選用：使用者目前編輯內容的純文字。有值時顯示「複製我的版本」，
 *   並在按「載入最新版本」時透過 onStash 交給呼叫端暫存（只放記憶體，不寫 localStorage，避免個資殘留）。
 * @param {Function} [props.onStash] (text) => void，載入最新版本前呼叫
 */
export default function EditConflictAlert({
    onReload, busy = false, children, myVersionText = '', onStash,
}) {
    const reload = () => {
        if (myVersionText) onStash?.(myVersionText);
        onReload();
    };

    return (
        <Alert variant="warning" role="alert" className="d-flex flex-wrap align-items-center gap-2">
            <span className="flex-grow-1">
                <strong>有人剛更新過這份內容。</strong>
                {' '}
                {children ?? '你的修改尚未儲存。載入最新版本會取代目前畫面上的內容，需要的話請先把自己的修改另外複製起來。'}
            </span>
            {myVersionText && <MyVersionCopy text={myVersionText} />}
            <Button variant="outline-dark" size="sm" onClick={reload} disabled={busy}>
                {busy ? '載入中…' : '載入最新版本'}
            </Button>
        </Alert>
    );
}

/**
 * 載入最新版本之後，原本的內容暫存在記憶體裡，用這個提示繼續提供「複製我的版本」。
 * 離開頁面、重新整理或按「關閉」就會消失。
 */
export function MyVersionBackupNotice({ text, onDismiss }) {
    if (!text) return null;
    return (
        <Alert variant="info" role="status" className="d-flex flex-wrap align-items-center gap-2" dismissible={false}>
            <span className="flex-grow-1">已載入最新版本。你載入前的內容暫存在這裡，離開或重新整理頁面後就會消失。</span>
            <MyVersionCopy text={text} />
            <Button variant="outline-secondary" size="sm" onClick={onDismiss}>關閉</Button>
        </Alert>
    );
}
