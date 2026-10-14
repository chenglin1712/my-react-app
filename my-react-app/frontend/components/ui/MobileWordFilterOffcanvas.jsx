import { useState } from "react";
import { Button, Offcanvas } from "react-bootstrap";
import WordFilterControls from "./WordFilterControls";
import { countActiveFilters } from "../../utils/wordFilterState";

/**
 * 手機版「篩選 / 排序」抽屜：排序／開頭字母／詞頻（／只顯示收藏），原本 _search、_camera、
 * _favorite 三邊各自維護一份幾乎逐行相同的實作。
 *
 * 選一項就關掉抽屜會讓人看不到目前套了什麼（審查項 P2-39）：現在在抽屜裡先調整「草稿」，
 * 按「套用」才一次生效並關閉；按右上角關閉或點背景則放棄這次調整。觸發鈕顯示目前套用的條件數，
 * 例如「篩選 / 排序（2）」；extraActiveCount 讓呼叫端把抽屜以外的條件（例如分類）也算進去。
 *
 * showFavoritesToggle/footer 是可選擴充點：_search／_camera 需要「只顯示收藏」切換，
 * _camera 額外需要一顆「返回」按鈕（放進 footer），_favorite 兩者都不需要。
 * onToggleFavorites 是「切換」而不是「設定」，所以只在草稿跟目前值不同時才呼叫。
 */
export default function MobileWordFilterOffcanvas({
  show, onOpen, onClose,
  sortOrder, onSortOrderChange,
  filterLetter, onFilterLetterChange, alphabet,
  frequencyFilter, onFrequencyFilterChange,
  showFavoritesToggle = false, showOnlyFavorites = false, onToggleFavorites,
  extraActiveCount = 0,
  footer,
}) {
  const [draft, setDraft] = useState(null);

  const activeCount = countActiveFilters({ filterLetter, frequencyFilter, showOnlyFavorites, extra: extraActiveCount });
  const current = {
    sortOrder,
    filterLetter,
    frequencyFilter: String(frequencyFilter ?? ''),
    showOnlyFavorites: Boolean(showOnlyFavorites),
  };
  // 草稿只記錄使用者在抽屜裡真的改過的欄位；沒碰過的欄位一律跟著目前值走，
  // 抽屜開著時外部狀態有更新（例如收藏被取消）也不會被舊草稿蓋回去。
  const view = { ...current, ...(draft ?? {}) };
  const patch = (changes) => setDraft({ ...(draft ?? {}), ...changes });

  const handleOpen = () => {
    setDraft({});
    onOpen();
  };

  const handleCancel = () => {
    setDraft(null);
    onClose();
  };

  const handleApply = () => {
    const changed = (key) => draft && key in draft && draft[key] !== current[key];
    if (changed('sortOrder')) onSortOrderChange(view.sortOrder);
    if (changed('filterLetter')) onFilterLetterChange(view.filterLetter);
    if (changed('frequencyFilter')) onFrequencyFilterChange(view.frequencyFilter);
    if (showFavoritesToggle && changed('showOnlyFavorites')) onToggleFavorites();
    setDraft(null);
    onClose();
  };

  const handleClear = () => patch({ filterLetter: '', frequencyFilter: '', showOnlyFavorites: false });

  return (
    <>
      <Button type="button" variant="outline-dark" className="mb-3" onClick={handleOpen}>
        {activeCount > 0 ? <>篩選 / 排序（<span className="wf-trigger-count">{activeCount}</span>）</> : '篩選 / 排序'}
      </Button>

      <Offcanvas show={show} onHide={handleCancel} placement="end">
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>篩選 / 排序選項</Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          <div className="d-flex flex-column gap-3">
            <WordFilterControls
              sortOrder={view.sortOrder}
              onSortOrderChange={(value) => patch({ sortOrder: value })}
              filterLetter={view.filterLetter}
              onFilterLetterChange={(value) => patch({ filterLetter: value })}
              alphabet={alphabet}
              frequencyFilter={view.frequencyFilter}
              onFrequencyFilterChange={(value) => patch({ frequencyFilter: String(value) })}
              showOnlyFavorites={view.showOnlyFavorites}
              onToggleFavorites={showFavoritesToggle ? () => patch({ showOnlyFavorites: !view.showOnlyFavorites }) : undefined}
            />

            <div className="wf-drawer-actions">
              <Button type="button" variant="outline-dark" onClick={handleClear}>清除條件</Button>
              <Button type="button" variant="danger" onClick={handleApply}>套用</Button>
            </div>

            {footer}
          </div>
        </Offcanvas.Body>
      </Offcanvas>
    </>
  );
}
