import { Button, Form, InputGroup } from 'react-bootstrap';
import { scrollBehavior } from '../../hooks/useReducedMotion';

const SEARCH_INPUT_MAX_LENGTH = 100;

/**
 * 捲出頁首後才出現的精簡搜尋列。
 *
 * 單詞查詢頁的頁首（標題、族語、搜尋框、篩選、分類）很高，原本整塊釘在畫面上，捲動時佔掉大半個視窗，
 * 結果列表只剩一小條可看、詞條被頁首蓋住。現在頁首照一般流程捲走，這條精簡列（約 56px）在捲出頁首後
 * 才浮出來，和頁首的搜尋框共用同一份 query 狀態；要改篩選或分類時按「↑」回到頁首。
 *
 * 外層 anchor 是高度 0 的 sticky 容器（不佔版面），所以頁首捲走時結果列表不會被推動。
 * 隱藏時用 inert，鍵盤與讀屏都碰不到。
 */
const CompactSearchBar = ({ query, setQuery, handleSearch, loading, tribeLabel, visible, offset }) => (
    <div className="search-compact-anchor" style={{ top: offset }}>
        <div className={`search-compact-bar${visible ? ' is-visible' : ''}`} role="search" inert={!visible}>
            <span className="search-compact-tribe">{tribeLabel}</span>
            <InputGroup className="search-terminal search-compact-terminal">
                <span className="search-terminal-prompt">&gt;</span>
                <Form.Control
                    className="search-terminal-input"
                    placeholder="請輸入查詢內容"
                    aria-label="快速查詢關鍵字"
                    value={query}
                    maxLength={SEARCH_INPUT_MAX_LENGTH}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            handleSearch();
                        }
                    }}
                />
                <Button type="button" aria-label="GO 搜尋" className="search-go-btn" onClick={() => handleSearch()} disabled={loading}>
                    GO ▸
                </Button>
            </InputGroup>
            <button
                type="button"
                className="yy-btn-outline search-compact-top"
                aria-label="回到頁首修改篩選與分類"
                onClick={() => window.scrollTo({ top: 0, behavior: scrollBehavior() })}
            >
                ↑ 篩選
            </button>
        </div>
    </div>
);

export default CompactSearchBar;
