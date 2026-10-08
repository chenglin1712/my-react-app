import { Button } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { Archive, Check, Edit3, Eye, Send, Trash2, Undo2, Upload, X } from 'lucide-react';

import AdminRowMenu from '../components/AdminRowMenu';
import { getReviewActionLayout, REVIEW_ACTION_META } from './reviewActionPolicy';

/**
 * 送審工作流的操作列（FE-2）。
 *
 * 每一列只外露一顆「主要動作」，其餘操作收進「⋯ 更多操作」選單（刪除在最底部、紅色、上方有分隔線）。
 * 原本是把所有可用操作都攤成按鈕：多一個操作（例如刪除）整列就更擠、更容易換行。
 *
 * 這個元件刻意做成「笨」的：它不知道任何 API 端點、不自己發請求、也不持有
 * 任何狀態。它只做兩件事——問 reviewActionPolicy 該顯示哪些操作與怎麼分組，然後把
 * 使用者的選擇透過 onAction 往上回報。真正要打哪支 API、要不要先跳確認
 * 對話框，全部由呼叫端決定。
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
    // busy 是「這一列」在忙；disabled 是「別列（或整頁）有其他操作正在
    // 進行中」。呼叫端的忙碌鎖大多是全域的（同一時間只能有一個操作在跑），
    // 但 busy 只比對 actionId === item.id——沒有這個 prop 的話，其他列的
    // 按鈕看起來還能點，點下去卻被鎖靜默擋掉，使用者看不出任何回饋。
    disabled = false,
    supportsRevision = true,
    supportsUnpublishedState = false,
    viewFallback = false,
    deletableStatuses,
    onAction,
    // 公告的「編輯」與「檢視」是真的連到另一個路由頁面，不是打開對話框——
    // 傳一個 (actionKey, item) => url 的函式，回傳非空字串的操作就會渲染成
    // <Link>，保留可以「在新分頁開啟」的既有行為，而不是被降級成一顆
    // onClick 之後才 navigate 的按鈕。
    hrefFor,
    // 選單按鈕的無障礙名稱要說明是「哪一筆」的操作（螢幕報讀器掃過一整排「更多操作」時才分得出來）
    itemLabel = '',
}) {
    const { primary, menu } = getReviewActionLayout({
        status: item.status,
        role,
        hasPendingRevision: item.has_pending_revision,
        roles,
        supportsRevision,
        supportsUnpublishedState,
        viewFallback,
        deletableStatuses,
    });

    const renderPrimary = () => {
        if (!primary) return null;
        const meta = REVIEW_ACTION_META[primary];
        const Icon = ICONS[meta.icon];
        const href = hrefFor?.(primary, item);

        if (href) {
            return (
                <Button as={Link} to={href} size="sm" variant={meta.variant}>
                    <Icon size={14} /> {meta.label}
                </Button>
            );
        }
        return (
            <Button
                type="button"
                size="sm"
                variant={meta.variant}
                disabled={busy || disabled}
                onClick={() => onAction(primary, item)}
            >
                <Icon size={14} /> {meta.label}
            </Button>
        );
    };

    const menuItems = menu.map((actionKey) => {
        const meta = REVIEW_ACTION_META[actionKey];
        return {
            key: actionKey,
            label: actionKey === 'delete' ? '刪除' : meta.label,
            icon: ICONS[meta.icon],
            href: hrefFor?.(actionKey, item) || undefined,
            danger: actionKey === 'delete',
            onSelect: () => onAction(actionKey, item),
        };
    });

    return (
        <>
            {renderPrimary()}
            {menuItems.length > 0 && (
                <AdminRowMenu
                    label={itemLabel ? `「${String(itemLabel).slice(0, 24)}」的更多操作` : '更多操作'}
                    items={menuItems}
                    disabled={busy || disabled}
                />
            )}
        </>
    );
}
