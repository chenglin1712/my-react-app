import { useEffect, useId, useRef, useState } from 'react';
import { Button, Overlay } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';

import '../../../static/css/_admin/admin-row-menu.css';

// 選單掛在 .admin-shell 底下（不是 document.body）：後台的設計變數與樣式都定義在 .admin-shell 上，
// 掛到 body 會失去這些變數。用 fixed 定位，所以不會被表格卡片的 overflow 裁切。
const menuContainer = () => document.querySelector('.admin-shell') ?? document.body;

const ENABLED_ITEMS = '[role="menuitem"]:not([aria-disabled="true"])';

/**
 * 表格每一列的「⋯ 更多操作」選單。
 *
 * items: [{ key, label, icon: Component, href?, onSelect?, danger?, disabled? }]
 *   - 有 href 的項目渲染成真正的連結（可以在新分頁開啟）
 *   - danger 的項目排在最後，上方自動加分隔線、使用紅色文字
 *
 * 鍵盤：點擊或 Enter／Space 開啟並聚焦第一項；↑↓ 移動、Home／End 到頭尾；Escape 關閉並把焦點還給按鈕；
 * Tab 關閉並回到按鈕（讓下一次 Tab 從這一列繼續往後走）。
 */
export default function AdminRowMenu({ label, items, disabled = false }) {
    const [open, setOpen] = useState(false);
    const toggleRef = useRef(null);
    const menuRef = useRef(null);
    const menuId = useId();

    useEffect(() => {
        if (!open) return undefined;
        const frame = requestAnimationFrame(() => {
            menuRef.current?.querySelector(ENABLED_ITEMS)?.focus();
        });
        return () => cancelAnimationFrame(frame);
    }, [open]);

    // 呼叫端正在處理中（disabled）時，已經打開的選單也要收起來
    useEffect(() => {
        if (disabled) setOpen(false);
    }, [disabled]);

    const closeAndRestoreFocus = () => {
        setOpen(false);
        toggleRef.current?.focus();
    };

    const handleKeyDown = (event) => {
        const enabled = [...(menuRef.current?.querySelectorAll(ENABLED_ITEMS) ?? [])];
        const index = enabled.indexOf(document.activeElement);
        const focusAt = (next) => {
            event.preventDefault();
            enabled[(next + enabled.length) % enabled.length]?.focus();
        };
        if (event.key === 'ArrowDown') focusAt(index + 1);
        else if (event.key === 'ArrowUp') focusAt(index <= 0 ? enabled.length - 1 : index - 1);
        else if (event.key === 'Home') focusAt(0);
        else if (event.key === 'End') focusAt(enabled.length - 1);
        else if (event.key === 'Escape' || event.key === 'Tab') {
            event.preventDefault();
            closeAndRestoreFocus();
        }
    };

    const select = (item) => {
        closeAndRestoreFocus();
        item.onSelect?.();
    };

    return (
        <>
            <Button
                ref={toggleRef}
                type="button"
                size="sm"
                variant="outline-secondary"
                className="admin-row-menu-toggle"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
                aria-label={label}
                title="更多操作"
                disabled={disabled}
                onClick={() => setOpen((value) => !value)}
            >
                <MoreHorizontal size={16} aria-hidden="true" />
            </Button>
            <Overlay
                show={open}
                target={toggleRef}
                placement="bottom-end"
                container={menuContainer}
                rootClose
                transition={false}
                onHide={() => setOpen(false)}
                popperConfig={{ strategy: 'fixed' }}
            >
                {({
                    ref, style, placement: _placement, arrowProps: _arrowProps, popper: _popper,
                    show: _show, hasDoneInitialMeasure: _measured, update: _update, ...props
                }) => (
                    <div
                        {...props}
                        ref={(node) => { ref(node); menuRef.current = node; }}
                        id={menuId}
                        style={style}
                        className="admin-row-menu"
                        role="menu"
                        aria-label={label}
                        onKeyDown={handleKeyDown}
                    >
                        {items.map((item, index) => {
                            const Icon = item.icon;
                            const className = `admin-row-menu-item${item.danger ? ' is-danger' : ''}`;
                            const content = (<>{Icon && <Icon size={15} aria-hidden="true" />}<span>{item.label}</span></>);
                            const showSeparator = item.danger && index > 0 && !items[index - 1].danger;
                            return (
                                <div key={item.key} role="none">
                                    {showSeparator && <div className="admin-row-menu-separator" role="separator" />}
                                    {item.href ? (
                                        <Link role="menuitem" className={className} to={item.href} onClick={() => setOpen(false)}>
                                            {content}
                                        </Link>
                                    ) : (
                                        <button
                                            type="button"
                                            role="menuitem"
                                            className={className}
                                            aria-disabled={item.disabled || undefined}
                                            onClick={() => { if (!item.disabled) select(item); }}
                                        >
                                            {content}
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </Overlay>
        </>
    );
}
