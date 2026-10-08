import { fireEvent, screen, within } from '@testing-library/react';

/**
 * 測試用：表格每一列的操作現在是「一顆主要按鈕 ＋ ⋯ 更多操作選單」。
 * 這裡的函式幫測試在「外露的主要按鈕」與「選單項目」之間找同一個操作，
 * 讓測試描述的仍是使用者做的事（核准、刪除…），不用每個測試各自展開選單。
 *
 * row 是該列的 DOM（通常是 screen.getByText(標題).closest('tr')）；name 是字串或正規表示式。
 */
function findRowAction(row, name) {
    const direct = within(row).queryByRole('button', { name });
    if (direct) return { element: direct, menu: null };

    // 前一次查詢已經把選單展開了：直接在那個選單裡找，不要再按一次「⋯」把它收起來
    const openMenu = screen.queryByRole('menu');
    if (openMenu) {
        const openItem = within(openMenu).queryByRole('menuitem', { name });
        return { element: openItem, menu: openItem ? openMenu : null };
    }

    const toggle = within(row).queryByRole('button', { name: /更多操作/ });
    if (!toggle || toggle.disabled) return { element: null, menu: null };

    fireEvent.click(toggle);
    const menu = screen.queryByRole('menu');
    const item = menu ? within(menu).queryByRole('menuitem', { name }) : null;
    if (!item && menu) fireEvent.keyDown(menu, { key: 'Escape' });
    return { element: item, menu: item ? menu : null };
}

/** 這一列有沒有這個操作（不論它外露或收在選單裡）。查完會把選單收起來。 */
export function hasRowAction(row, name) {
    const { element, menu } = findRowAction(row, name);
    if (menu) fireEvent.keyDown(menu, { key: 'Escape' });
    return Boolean(element);
}

/** 點擊這一列的某個操作；找不到就丟錯，讓測試失敗並說明是哪個操作不存在。 */
export function clickRowAction(row, name) {
    const { element } = findRowAction(row, name);
    if (!element) throw new Error(`這一列找不到操作：${String(name)}`);
    fireEvent.click(element);
}

/** 取得這一列的操作元素（外露按鈕或已展開的選單項目），給需要檢查屬性（href 等）的測試用。 */
export function getRowAction(row, name) {
    const { element } = findRowAction(row, name);
    if (!element) throw new Error(`這一列找不到操作：${String(name)}`);
    return element;
}

/** 這一列的某個操作元素；沒有就回傳 null（給「看不到這個操作」的負向斷言用，查完會把選單收起來）。 */
export function queryRowAction(row, name) {
    const { element, menu } = findRowAction(row, name);
    if (menu) fireEvent.keyDown(menu, { key: 'Escape' });
    return element ? element : null;
}
