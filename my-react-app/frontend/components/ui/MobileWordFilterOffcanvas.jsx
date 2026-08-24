import { Button, Dropdown, Offcanvas } from "react-bootstrap";

/**
 * 手機版「篩選 / 排序」抽屜：排序／開頭字母／詞頻，原本 _search、_camera、
 * _favorite 三邊各自維護一份幾乎逐行相同的實作。桌面版三邊的排版/互動差異
 * 較大（chip 列 vs Dropdown、有沒有返回/收藏切換），刻意不強行統一，各頁
 * 保留自己的桌面版 layout，只抽手機版這一份共用。
 *
 * showFavoritesToggle/footer 是可選擴充點：_search／_camera 需要「只顯示收藏」
 * 切換，_camera 額外需要一顆「返回」按鈕（放進 footer），_favorite 兩者都不需要。
 */
export default function MobileWordFilterOffcanvas({
  show, onOpen, onClose,
  sortOrder, onSortOrderChange,
  filterLetter, onFilterLetterChange, alphabet,
  frequencyFilter, onFrequencyFilterChange,
  showFavoritesToggle = false, showOnlyFavorites, onToggleFavorites,
  footer,
}) {
  return (
    <>
      <Button type="button" variant="outline-dark" className="mb-3" onClick={onOpen}>
        篩選 / 排序
      </Button>

      <Offcanvas show={show} onHide={onClose} placement="end">
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>篩選 / 排序選項</Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          <div className="d-flex flex-column gap-3">
            <Button
              type="button"
              variant="outline-dark"
              onClick={() => {
                onSortOrderChange(sortOrder === "asc" ? "desc" : "asc");
                onClose();
              }}
            >
              排序： {sortOrder === "asc" ? "A→Z" : "Z→A"}
            </Button>

            <Dropdown onSelect={(val) => { onFilterLetterChange(val); onClose(); }}>
              <Dropdown.Toggle variant="outline-dark" className="btn">
                開頭： {filterLetter || "全部"}
              </Dropdown.Toggle>
              <Dropdown.Menu style={{ maxHeight: "400px", overflowY: "auto" }}>
                <Dropdown.Item eventKey="">全部</Dropdown.Item>
                {alphabet.map((l) => (
                  <Dropdown.Item key={l} eventKey={l}>{l}</Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown>

            <Dropdown onSelect={(val) => { onFrequencyFilterChange(val); onClose(); }}>
              <Dropdown.Toggle variant="outline-dark">
                詞頻： {frequencyFilter ? `${frequencyFilter}★` : "全部"}
              </Dropdown.Toggle>
              <Dropdown.Menu>
                <Dropdown.Item eventKey="">全部</Dropdown.Item>
                {[5, 4, 3, 2, 1].map((n) => (
                  <Dropdown.Item key={n} eventKey={n}>{`${n}★`}</Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown>

            {showFavoritesToggle && (
              <Button
                type="button"
                variant={showOnlyFavorites ? "danger" : "outline-dark"}
                onClick={() => { onToggleFavorites(); onClose(); }}
              >
                {showOnlyFavorites ? "顯示全部" : "只顯示收藏"}
              </Button>
            )}

            {footer}
          </div>
        </Offcanvas.Body>
      </Offcanvas>
    </>
  );
}
