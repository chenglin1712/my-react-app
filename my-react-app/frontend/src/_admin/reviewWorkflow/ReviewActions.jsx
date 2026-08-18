import { Button } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { Archive, Check, Edit3, Eye, Send, Trash2, Undo2, Upload, X } from 'lucide-react';

import { getReviewActions, REVIEW_ACTION_META } from './reviewActionPolicy';

/**
 * 送審工作流的操作按鈕列（FE-2）。
 *
 * 這個元件刻意做成「笨」的：它不知道任何 API 端點、不自己發請求、也不持有
 * 任何狀態。它只做兩件事——問 reviewActionPolicy 該顯示哪些按鈕，然後把
 * 使用者的點擊透過 onAction 往上回報。真正要打哪支 API、要不要先跳確認
 * 對話框，全部由 useReviewableContentCrud 決定。
 *
 * 這樣切的理由是：原本 actionsFor() 把「規則判斷」「按鈕外觀」「呼叫哪支
 * API」三件事綁在同一個 closure 裡，所以每個面板都只能整份複製一次。分開
 * 之後規則可以純函式地窮舉測試，外觀集中在這裡改一次全站生效。
 */
const ICONS = {
    edit: Edit3,
    send: Send,
    trash: Trash2,
    undo: Undo2,
    check: Check,
    x: X,
    archive: Archive,
    upload: Upload,
    eye: Eye,
};

export default function ReviewActions({
    item,
    role,
    roles,
    busy = false,
    supportsRevision = true,
    supportsUnpublishedState = false,
    viewFallback = false,
    onAction,
    // 公告的「編輯」與「檢視」是真的連到另一個路由頁面，不是打開對話框——
    // 傳一個 (actionKey, item) => url 的函式，回傳非空字串的操作就會渲染成
    // <Link>，保留可以「在新分頁開啟」的既有行為，而不是被降級成一顆
    // onClick 之後才 navigate 的按鈕。
    hrefFor,
}) {
    const actions = getReviewActions({
        status: item.status,
        role,
        hasPendingRevision: item.has_pending_revision,
        roles,
        supportsRevision,
        supportsUnpublishedState,
        viewFallback,
    });

    return actions.map((actionKey) => {
        const meta = REVIEW_ACTION_META[actionKey];
        const Icon = ICONS[meta.icon];
        const href = hrefFor?.(actionKey, item);

        if (href) {
            return (
                <Button
                    key={actionKey}
                    as={Link}
                    to={href}
                    size="sm"
                    variant={meta.variant}
                >
                    <Icon size={14} /> {meta.label}
                </Button>
            );
        }

        return (
            <Button
                key={actionKey}
                size="sm"
                variant={meta.variant}
                disabled={busy}
                onClick={() => onAction(actionKey, item)}
            >
                <Icon size={14} /> {meta.label}
            </Button>
        );
    });
}
