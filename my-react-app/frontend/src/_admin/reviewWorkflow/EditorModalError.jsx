import { Alert } from 'react-bootstrap';
import EditConflictAlert from '../components/EditConflictAlert';

/**
 * 編輯對話框內的錯誤區（稽核 FE7b-01）。
 * 儲存失敗時對話框還開著，錯誤如果只顯示在頁面上方，會被對話框的遮罩蓋住，使用者看不到。
 * 放在 Modal.Body 的最上方，role="alert" 讓螢幕報讀器立刻唸出。
 *
 * conflict：儲存時發現別人剛更新過這筆資料（稽核 FE7b-08），改顯示「載入最新版本」的出路。
 */
export default function EditorModalError({ error, conflict = false, onReload }) {
    return (
        <>
            {conflict && onReload && <EditConflictAlert onReload={onReload} />}
            {error && <Alert variant="danger" role="alert" className="py-2">{error}</Alert>}
        </>
    );
}
