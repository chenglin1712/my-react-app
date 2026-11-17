import { useEffect, useId, useState } from 'react';
import { Offcanvas, Modal, Button } from 'react-bootstrap';
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import FavoriteButton from '../../../components/ui/FavoriteButton';
import AudioPlayButton from '../../../components/ui/AudioPlayButton';
import WordDetailBody from './WordDetailBody';
import { pickSummary, hasMoreDetail } from './wordDetailSummary';
import { announce } from '@utils/announce';
import useSheetSwipeDismiss from '../../hooks/useSheetSwipeDismiss';
import '../../../static/css/_search/wordSheet.css';

// 詞條詳情（Apple 化步驟 4-2、P2-1）：手機是底部 sheet（Offcanvas），桌面是畫面中央的卡片（Modal），
// 進場像通知一樣從小一點淡入彈出（F9 浮層彈出、Z2 強度 7，見 wordSheet.css）。
// 焦點圈住、Esc 關閉、點背景關閉、關閉後焦點回到原本的詞條鈕都由 react-bootstrap 處理。
// 手機另外支援標題列往下滑關閉（階段 6-3，hooks/useSheetSwipeDismiss.js）。
// 內容區：預設只顯示摘要，「看完整內容」展開其餘。用 key 綁詞條，換詞時自動收回摘要。
const SheetContent = ({ result, ...audioProps }) => {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const summary = pickSummary(result);
  const more = hasMoreDetail(result);
  return (
    <>
      <div id={panelId}>
        {expanded || (!summary && !more) ? (
          <WordDetailBody result={result} {...audioProps} />
        ) : summary ? (
          <WordDetailBody result={summary} summary {...audioProps} />
        ) : (
          <p className="word-sheet-empty">這個詞目前沒有例句。</p>
        )}
      </div>
      {more && !expanded && (
        <Button type="button" variant="link" className="word-sheet-more" aria-expanded="false" aria-controls={panelId} onClick={() => setExpanded(true)}>
          看完整內容<ChevronDown size={18} className="yy-icon" aria-hidden="true" />
        </Button>
      )}
    </>
  );
};

// 會自己用左右鍵的元件（輸入框、滑桿、分頁、單選群組、選單、清單等）：焦點在它們身上時不攔截
const ARROW_KEY_OWNERS = [
  'input', 'textarea', 'select', '[contenteditable]', '[data-hotkeys-ignore]',
  '[role="textbox"]', '[role="searchbox"]', '[role="spinbutton"]', '[role="slider"]', '[role="combobox"]',
  '[role="radio"]', '[role="radiogroup"]', '[role="tab"]', '[role="tablist"]', '[role="listbox"]', '[role="option"]',
  '[role="menu"]', '[role="menubar"]', '[role="menuitem"]', '[role="tree"]', '[role="treeitem"]', '[role="grid"]', '[role="application"]',
].join(',');
const ownsArrowKeys = (el) => Boolean(el?.closest?.(ARROW_KEY_OWNERS));

// 空白鍵本來就會「按下」的元件（按鈕、連結、輸入框、勾選與選單項目）：焦點在它們身上時空白鍵歸它們，不拿來播放
const SPACE_KEY_OWNERS = 'button,a[href],summary,input,textarea,select,video,audio,[contenteditable],[data-hotkeys-ignore],[role="button"],[role="checkbox"],[role="switch"],[role="tab"],[role="menuitem"],[role="option"],[role="radio"],[role="slider"],[role="textbox"],[role="searchbox"],[role="combobox"],[role="link"],[role="spinbutton"],[role="menuitemcheckbox"],[role="menuitemradio"]';
const isSpace = (e) => e.key === ' ' || e.code === 'Space';

const WordDetailSheet = ({
  detail, onClose, onStep, stepInfo, isMobile, animated = true,
  isFavorited, toggleFavorite,
  playAudio, playSentence, hasSentenceAudio, failedAudio,
  stopAudio, retryAudio, playingId = null, playingDuration = 0,
}) => {
  const result = detail?.result;
  // 手機底部 sheet：標題列往下滑（或快速輕彈）關閉；桌面側邊 sheet 不啟用
  const swipe = useSheetSwipeDismiss({ enabled: Boolean(isMobile), onDismiss: onClose });
  const wordFileId = result?.audioItems?.[0]?.fileId;
  const hasWordAudio = Boolean(wordFileId);
  const wordAudioFailed = Boolean(wordFileId && failedAudio?.has(wordFileId));
  const wordAudioPlaying = Boolean(wordFileId) && playingId === wordFileId;
  const canPrev = Boolean(onStep && stepInfo && stepInfo.index > 0);
  const canNext = Boolean(onStep && stepInfo && stepInfo.index < stepInfo.total - 1);

  // 詳情開啟時的鍵盤捷徑（P2-1、P2-9），每一個在畫面上都有對應的按鈕：
  // 左右鍵換詞（上一個／下一個）、空白鍵播放或停止發音（發音鈕）、Esc 關閉（關閉鈕，由 Offcanvas 處理）。
  // 都是鍵盤觸發，不加動畫。輸入中、輸入法組字中、按了修飾鍵、重複按住時不攔截。
  useEffect(() => {
    if (!detail) return undefined;
    const onKey = (e) => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      // 只處理焦點在這張 sheet 裡的按鍵（焦點圈在裡面，但 document 層的監聽不會自己限制範圍）
      if (!e.target?.closest?.('.word-sheet')) return;
      if (isSpace(e)) {
        // 空白鍵：只在焦點不在按鈕、輸入框等會自己處理空白鍵的元件上才播放；擋掉預設，免得內容跟著捲動
        if (e.repeat || !hasWordAudio || e.target.closest(SPACE_KEY_OWNERS)) return;
        e.preventDefault();
        if (wordAudioFailed) retryAudio?.(wordFileId);
        else if (wordAudioPlaying) stopAudio?.();
        else playAudio?.(wordFileId);
        return;
      }
      if (!onStep || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      if (ownsArrowKeys(e.target)) return;
      const offset = e.key === 'ArrowLeft' ? -1 : 1;
      if (offset < 0 ? !canPrev : !canNext) return;
      e.preventDefault();
      onStep(offset, true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [detail, onStep, canPrev, canNext, hasWordAudio, wordFileId, wordAudioFailed, wordAudioPlaying, playAudio, stopAudio, retryAudio]);

  // 換詞後告訴螢幕閱讀器現在在第幾個（只有換詞時才報，剛開啟時由 dialog 標題負責）
  const stepped = detail?.stepFade !== undefined;
  const stepKey = detail?.keyName;
  const stepName = result?.name;
  const stepIndex = stepInfo?.index;
  const stepTotal = stepInfo?.total;
  useEffect(() => {
    if (stepped && stepName && stepTotal) announce(`${stepName}，第 ${stepIndex + 1} 個，共 ${stepTotal} 個`);
  }, [stepped, stepKey, stepName, stepIndex, stepTotal]);

  // 手機與桌面共用同一份內容，只有外殼不同
  const Header = isMobile ? Offcanvas.Header : Modal.Header;
  const Title = isMobile ? Offcanvas.Title : Modal.Title;
  const Body = isMobile ? Offcanvas.Body : Modal.Body;

  const content = result && (
        <>
          <Header closeButton closeLabel="關閉詳情" className="word-sheet-head" {...swipe}>
            <div className="word-sheet-titles">
              <Title as="h2" id="word-sheet-title" className="word-sheet-name">{result.name || '無資料'}</Title>
              {detail.word && <p className="word-sheet-gloss">{detail.word}</p>}
            </div>
            <div className="word-sheet-actions">
              {hasWordAudio && (
                <AudioPlayButton
                  name={result.name}
                  size={22}
                  showStatus
                  playing={wordAudioPlaying}
                  duration={wordAudioPlaying ? playingDuration : 0}
                  failed={wordAudioFailed}
                  onPlay={() => playAudio(wordFileId)}
                  onStop={stopAudio}
                  onRetry={() => retryAudio?.(wordFileId)}
                />
              )}
              <FavoriteButton name={result.name} isFavorited={isFavorited} onToggle={() => toggleFavorite(result.name)} size={22} />
            </div>
          </Header>
          <Body className="word-sheet-body">
            <div key={detail.keyName} className={detail.stepFade ? 'word-sheet-swap' : undefined}>
              <SheetContent
                result={result}
                playAudio={playAudio}
                playSentence={playSentence}
                hasSentenceAudio={hasSentenceAudio}
                failedAudio={failedAudio}
              />
            </div>
          </Body>
          {onStep && stepInfo && (
            <nav className="word-sheet-nav" aria-label="切換詞條">
              <Button type="button" variant="link" aria-disabled={!canPrev} onClick={() => canPrev && onStep(-1, false)}>
                <ChevronLeft size={20} className="yy-icon" aria-hidden="true" />上一個
              </Button>
              <span className="word-sheet-pos">{stepInfo.index + 1} / {stepInfo.total}</span>
              <Button type="button" variant="link" aria-disabled={!canNext} onClick={() => canNext && onStep(1, false)}>
                下一個<ChevronRight size={20} className="yy-icon" aria-hidden="true" />
              </Button>
            </nav>
          )}
        </>
  );

  if (isMobile) {
    return (
      <Offcanvas
        show={Boolean(detail)}
        onHide={onClose}
        animation={animated}
        backdropClassName="word-sheet-backdrop"
        placement="bottom"
        className="word-sheet yy-glass word-sheet--bottom"
        aria-labelledby="word-sheet-title"
      >
        {content}
      </Offcanvas>
    );
  }
  // word-sheet 這個 class 放在 .modal（role=dialog、取得焦點的那一層）上，鍵盤處理才認得出焦點在詳情裡
  return (
    <Modal
      show={Boolean(detail)}
      onHide={onClose}
      animation={animated}
      centered
      backdropClassName="word-sheet-backdrop"
      className="word-sheet word-sheet--center"
      contentClassName="yy-glass word-sheet-card"
      aria-labelledby="word-sheet-title"
    >
      {content}
    </Modal>
  );
};

export default WordDetailSheet;
