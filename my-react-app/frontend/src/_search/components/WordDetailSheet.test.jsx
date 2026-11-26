import { describe, test, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WordDetailSheet from './WordDetailSheet';

beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
  }));
});

const detail = {
  keyName: 'k1',
  word: '上面',
  result: { name: 'babaw', frequency: 3, audioItems: [{ fileId: 'f1' }], explanationItems: [{ chineseExplanation: '上面', partOfSpeech: '名詞' }] },
};

const base = { onClose: vi.fn(), isMobile: false, isFavorited: false, toggleFavorite: vi.fn(), playAudio: vi.fn(), playSentence: vi.fn(), hasSentenceAudio: true, failedAudio: new Set() };

describe('WordDetailSheet', () => {
  test('沒有 detail 時不顯示任何內容', () => {
    render(<WordDetailSheet {...base} detail={null} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('有 detail 時是 dialog，標題是詞、副標是詞義，內容含詞性', () => {
    render(<WordDetailSheet {...base} detail={detail} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('babaw');
    expect(screen.getByText('上面', { selector: '.word-sheet-gloss' })).toBeInTheDocument();
    // 漸進揭露：詞性在「看完整內容」後面
    expect(screen.queryByText('名詞')).not.toBeInTheDocument();
    const more = screen.getByRole('button', { name: /看完整內容/ });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    expect(screen.getByText('名詞')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /看完整內容/ })).not.toBeInTheDocument();
  });

  test('手機從底部、桌面從右側', () => {
    const { rerender } = render(<WordDetailSheet {...base} detail={detail} isMobile={false} />);
    expect(screen.getByRole('dialog')).toHaveClass('word-sheet--center');
    rerender(<WordDetailSheet {...base} detail={detail} isMobile />);
    expect(screen.getByRole('dialog')).toHaveClass('word-sheet--bottom');
  });

  test('按 Esc 關閉', () => {
    const onClose = vi.fn();
    render(<WordDetailSheet {...base} detail={detail} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape', keyCode: 27 });
    expect(onClose).toHaveBeenCalled();
  });

  test('關閉鈕呼叫 onClose；收藏鈕帶 aria-pressed 並以詞名呼叫 toggleFavorite；播放鈕播第一個音檔', () => {
    const onClose = vi.fn();
    const toggleFavorite = vi.fn();
    const playAudio = vi.fn();
    render(<WordDetailSheet {...base} detail={detail} onClose={onClose} toggleFavorite={toggleFavorite} playAudio={playAudio} isFavorited />);
    fireEvent.click(screen.getByRole('button', { name: '關閉詳情' }));
    expect(onClose).toHaveBeenCalled();
    const fav = screen.getByRole('button', { name: /^收藏「/ });
    expect(fav).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(fav);
    expect(toggleFavorite).toHaveBeenCalledWith('babaw');
    fireEvent.click(screen.getByRole('button', { name: '播放「babaw」的發音' }));
    expect(playAudio).toHaveBeenCalledWith('f1');
  });

  describe('摘要與漸進揭露（P2-1）', () => {
    const rich = {
      keyName: 'r1',
      word: '上面',
      result: {
        name: 'babaw', frequency: 2, sources: ['A 書'],
        explanationItems: [
          { chineseExplanation: '上面', partOfSpeech: '名詞', sentenceItems: [
            { originalSentence: 'S-one', chineseSentence: '第一句' },
            { originalSentence: 'S-two', chineseSentence: '第二句' },
          ] },
        ],
      },
    };

    test('預設只顯示第一句例句，看完整內容後才有其餘', () => {
      render(<WordDetailSheet {...base} detail={rich} />);
      expect(screen.getByText('S-one')).toBeInTheDocument();
      expect(screen.queryByText('S-two')).not.toBeInTheDocument();
      expect(screen.queryByText('收錄來源：')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /看完整內容/ }));
      expect(screen.getByText('S-two')).toBeInTheDocument();
      expect(screen.getByText('收錄來源：')).toBeInTheDocument();
    });

    test('沒有更多內容就不放「看完整內容」', () => {
      const tiny = { keyName: 't', word: '字', result: { name: 'x', explanationItems: [{ sentenceItems: [{ originalSentence: 'only', chineseSentence: '一句' }] }] } };
      render(<WordDetailSheet {...base} detail={tiny} />);
      expect(screen.getByText('only')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /看完整內容/ })).not.toBeInTheDocument();
    });

    test('背景遮罩有專用 class（變暗加模糊由 CSS token 提供）', () => {
      render(<WordDetailSheet {...base} detail={rich} />);
      expect(document.querySelector('.word-sheet-backdrop')).not.toBeNull();
    });
  });

  describe('上一個、下一個（P2-1）', () => {
    const stepProps = { onStep: vi.fn(), stepInfo: { index: 1, total: 3 } };

    test('按鈕以滑鼠換詞（viaKeyboard 為 false），顯示位置', () => {
      const onStep = vi.fn();
      render(<WordDetailSheet {...base} {...stepProps} onStep={onStep} detail={detail} />);
      expect(screen.getByText('2 / 3')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /下一個/ }));
      expect(onStep).toHaveBeenLastCalledWith(1, false);
      fireEvent.click(screen.getByRole('button', { name: /上一個/ }));
      expect(onStep).toHaveBeenLastCalledWith(-1, false);
    });

    test('左右鍵換詞（viaKeyboard 為 true）', () => {
      const onStep = vi.fn();
      render(<WordDetailSheet {...base} {...stepProps} onStep={onStep} detail={detail} />);
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' });
      expect(onStep).toHaveBeenLastCalledWith(1, true);
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowLeft' });
      expect(onStep).toHaveBeenLastCalledWith(-1, true);
    });

    test('第一個不能再往前、最後一個不能再往後，用 aria-disabled 保住焦點', () => {
      const onStep = vi.fn();
      const { rerender } = render(<WordDetailSheet {...base} onStep={onStep} stepInfo={{ index: 0, total: 3 }} detail={detail} />);
      const prev = screen.getByRole('button', { name: /上一個/ });
      expect(prev).toHaveAttribute('aria-disabled', 'true');
      expect(prev).not.toBeDisabled();
      fireEvent.click(prev);
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowLeft' });
      expect(onStep).not.toHaveBeenCalled();
      rerender(<WordDetailSheet {...base} onStep={onStep} stepInfo={{ index: 2, total: 3 }} detail={detail} />);
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' });
      expect(onStep).not.toHaveBeenCalled();
    });

    test('輸入框、輸入法組字、修飾鍵時不攔截左右鍵', () => {
      const onStep = vi.fn();
      render(<><input aria-label="x" /><WordDetailSheet {...base} {...stepProps} onStep={onStep} detail={detail} /></>);
      fireEvent.keyDown(screen.getByLabelText('x'), { key: 'ArrowRight' });
      const dialog = screen.getByRole('dialog');
      fireEvent.keyDown(dialog, { key: 'ArrowRight', isComposing: true });
      fireEvent.keyDown(dialog, { key: 'ArrowRight', altKey: true });
      fireEvent.keyDown(dialog, { key: 'ArrowRight', shiftKey: true });
      expect(onStep).not.toHaveBeenCalled();
    });

    test('焦點在 sheet 外、或在單選群組／分頁上時不攔截左右鍵', () => {
      const onStep = vi.fn();
      render(<><button type="button">外面</button><WordDetailSheet {...base} {...stepProps} onStep={onStep} detail={detail} /></>);
      fireEvent.keyDown(screen.getByText('外面'), { key: 'ArrowRight' });
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
      const radio = document.createElement('div');
      radio.setAttribute('role', 'radio');
      radio.tabIndex = 0;
      screen.getByRole('dialog').appendChild(radio);
      fireEvent.keyDown(radio, { key: 'ArrowRight' });
      expect(onStep).not.toHaveBeenCalled();
    });

    test('沒有清單（沒有 onStep）就沒有切換列', () => {
      render(<WordDetailSheet {...base} detail={detail} />);
      expect(screen.queryByRole('navigation', { name: '切換詞條' })).not.toBeInTheDocument();
    });

    test('只有滑鼠換詞才有淡入 class，鍵盤換詞沒有', () => {
      const { rerender } = render(<WordDetailSheet {...base} {...stepProps} detail={{ ...detail, stepFade: true }} />);
      expect(document.querySelector('.word-sheet-swap')).not.toBeNull();
      rerender(<WordDetailSheet {...base} {...stepProps} detail={{ ...detail, keyName: 'k2', stepFade: false }} />);
      expect(document.querySelector('.word-sheet-swap')).toBeNull();
    });

    test('換詞後展開狀態收回摘要', () => {
      const a = { keyName: 'a', word: '甲', result: { name: 'aa', frequency: 3, explanationItems: [{ sentenceItems: [{ originalSentence: 'A1', chineseSentence: '一' }] }] } };
      const b = { keyName: 'b', word: '乙', result: { name: 'bb', frequency: 3, explanationItems: [{ sentenceItems: [{ originalSentence: 'B1', chineseSentence: '二' }] }] } };
      const { rerender } = render(<WordDetailSheet {...base} {...stepProps} detail={a} />);
      fireEvent.click(screen.getByRole('button', { name: /看完整內容/ }));
      expect(screen.getByText('詞頻：')).toBeInTheDocument();
      rerender(<WordDetailSheet {...base} {...stepProps} detail={b} />);
      expect(screen.queryByText('詞頻：')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /看完整內容/ })).toBeInTheDocument();
    });
  });

  describe('標題列往下滑關閉（階段 6-3）', () => {
    const swipeDown = (header) => {
      const Pointer = window.PointerEvent || class extends MouseEvent {
        constructor(type, init = {}) { super(type, init); this.pointerId = 1; this.pointerType = 'touch'; this.isPrimary = true; }
      };
      const fire = (type, clientY) => fireEvent(header, new Pointer(type, { bubbles: true, clientY, pointerId: 1, pointerType: 'touch', isPrimary: true }));
      fire('pointerdown', 100);
      fire('pointermove', 180);
      fire('pointerup', 180);
    };

    test('手機：快速往下滑，放手就呼叫 onClose（只呼叫一次）', () => {
      vi.useFakeTimers();
      const onClose = vi.fn();
      render(<WordDetailSheet {...base} onClose={onClose} isMobile detail={detail} />);
      const header = document.querySelector('.word-sheet-head');
      swipeDown(header);
      expect(onClose).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(600);
      expect(onClose).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    test('桌面（右側 sheet）：同樣的動作不會關閉', () => {
      vi.useFakeTimers();
      const onClose = vi.fn();
      render(<WordDetailSheet {...base} onClose={onClose} isMobile={false} detail={detail} />);
      swipeDown(document.querySelector('.word-sheet-head'));
      vi.advanceTimersByTime(500);
      expect(onClose).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });
});

describe('詳情內的空白鍵播放（P2-9）', () => {
  const withAudio = { keyName: 'a', word: '上面', result: { name: 'babaw', audioItems: [{ fileId: 'f1' }], explanationItems: [{ chineseExplanation: '上面' }] } };
  const noAudio = { keyName: 'n', word: '字', result: { name: 'x', explanationItems: [{ chineseExplanation: '字' }] } };
  const props = { ...base, onStep: vi.fn(), stepInfo: { index: 1, total: 3 } };

  test('焦點在 sheet 內（不是按鈕）時，空白鍵播放發音並擋掉預設（內容不捲動）', () => {
    const playAudio = vi.fn();
    render(<WordDetailSheet {...props} playAudio={playAudio} detail={withAudio} />);
    const notPrevented = fireEvent.keyDown(screen.getByRole('dialog'), { key: ' ', code: 'Space' });
    expect(playAudio).toHaveBeenCalledWith('f1');
    expect(notPrevented).toBe(false);
  });

  test('播放中再按一次停止；失敗時按空白鍵就是重試', () => {
    const stopAudio = vi.fn();
    const retryAudio = vi.fn();
    const { rerender } = render(<WordDetailSheet {...props} stopAudio={stopAudio} playingId="f1" detail={withAudio} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: ' ', code: 'Space' });
    expect(stopAudio).toHaveBeenCalled();
    rerender(<WordDetailSheet {...props} retryAudio={retryAudio} failedAudio={new Set(['f1'])} detail={withAudio} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: ' ', code: 'Space' });
    expect(retryAudio).toHaveBeenCalledWith('f1');
  });

  test('焦點在按鈕或輸入框上不攔截；沒有音檔、按住重複、修飾鍵、輸入法組字時也不', () => {
    const playAudio = vi.fn();
    const { rerender } = render(<WordDetailSheet {...props} playAudio={playAudio} detail={withAudio} />);
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(screen.getByRole('button', { name: /^收藏「/ }), { key: ' ', code: 'Space' });
    const input = document.createElement('input');
    dialog.appendChild(input);
    fireEvent.keyDown(input, { key: ' ', code: 'Space' });
    fireEvent.keyDown(dialog, { key: ' ', code: 'Space', repeat: true });
    fireEvent.keyDown(dialog, { key: ' ', code: 'Space', ctrlKey: true });
    fireEvent.keyDown(dialog, { key: ' ', code: 'Space', isComposing: true });
    expect(playAudio).not.toHaveBeenCalled();
    rerender(<WordDetailSheet {...props} playAudio={playAudio} detail={noAudio} />);
    const notPrevented = fireEvent.keyDown(screen.getByRole('dialog'), { key: ' ', code: 'Space' });
    expect(playAudio).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);
  });

  test('焦點在 sheet 外時空白鍵不播放', () => {
    const playAudio = vi.fn();
    render(<><button type="button">外面</button><WordDetailSheet {...props} playAudio={playAudio} detail={withAudio} /></>);
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
    expect(playAudio).not.toHaveBeenCalled();
  });

  test('沒有 onStep（沒有清單）時空白鍵仍然能播放', () => {
    const playAudio = vi.fn();
    render(<WordDetailSheet {...base} playAudio={playAudio} detail={withAudio} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: ' ', code: 'Space' });
    expect(playAudio).toHaveBeenCalledWith('f1');
  });

  test('說明清單有這三個快捷鍵，而且每一個都有畫面上的按鈕', async () => {
    const { SHORTCUTS } = await import('../../../hooks/shortcuts');
    ['← →', '空白鍵', 'Esc'].forEach((k) => expect(SHORTCUTS.map((s) => s.key)).toContain(k));
    render(<WordDetailSheet {...props} detail={withAudio} />);
    expect(screen.getByRole('button', { name: /上一個/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /下一個/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '播放「babaw」的發音' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '關閉詳情' })).toBeInTheDocument();
  });
});

// 稽核 FE3-05：例句發音失敗在那一句旁邊顯示，「重播」是重新播放而不是重跑查詢
describe('WordDetailSheet 例句發音失敗', () => {
  const withSentence = {
    keyName: 'k2',
    word: '走',
    result: { name: 'musa', explanationItems: [{ chineseExplanation: '走', sentenceItems: [{ originalSentence: 'musa ku', chineseSentence: '我走' }] }] },
  };

  test('失敗的那一句旁邊顯示說明與「重播」，按了重播呼叫 playSentence', () => {
    const playSentence = vi.fn();
    render(<WordDetailSheet {...base} hasSentenceAudio={false} playSentence={playSentence} detail={withSentence} sentenceFailure={{ sentence: 'musa ku', reason: 'failed' }} />);
    expect(screen.getByText(/例句發音播放失敗/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重播' }));
    expect(playSentence).toHaveBeenCalledWith('musa ku');
  });

  test('訪客播不了（auth）時說明要登入，不給重播', () => {
    render(<WordDetailSheet {...base} hasSentenceAudio={false} detail={withSentence} sentenceFailure={{ sentence: 'musa ku', reason: 'auth' }} />);
    expect(screen.getByText('登入後才能播放例句發音。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重播' })).not.toBeInTheDocument();
  });

  test('別句的失敗不會顯示在這一句', () => {
    render(<WordDetailSheet {...base} hasSentenceAudio={false} detail={withSentence} sentenceFailure={{ sentence: 'other', reason: 'failed' }} />);
    expect(screen.queryByText(/例句發音播放失敗/)).not.toBeInTheDocument();
  });
});

// 稽核 FE3-15：有 onExited 時關掉 react-bootstrap 的 restoreFocus，關閉後交給呼叫端放焦點
test('關閉後呼叫 onExited，焦點不會被 react-bootstrap 拉回最初的按鈕', async () => {
  const onExited = vi.fn();
  const { rerender } = render(<><button type="button">origin</button><WordDetailSheet {...base} animated={false} detail={detail} onExited={onExited} /></>);
  rerender(<><button type="button">origin</button><WordDetailSheet {...base} animated={false} detail={null} onExited={onExited} /></>);
  await waitFor(() => expect(onExited).toHaveBeenCalled());
});
