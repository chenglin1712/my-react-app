import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WordCard from './WordCard';

// _search、_camera 兩頁原本各自維護一份幾乎相同的 WordCard，已分岔（_search 版本有
// 發音播放/音檔可用性判斷，_camera 版本有鍵盤可操作性），這裡改成共用同一份，
// 測試涵蓋合併後兩邊都需要用到的行為，避免日後其中一頁的用法又悄悄壞掉。
describe('WordCard', () => {
  const baseResult = { name: 'balay', frequency: 100, tribe: '泰雅語' };

  test('展開區塊預設收合，點擊標題會呼叫 toggleExpand(keyName)', () => {
    const toggleExpand = vi.fn();
    render(
      <WordCard
        word="真的"
        result={baseResult}
        keyName="k1"
        isExpanded={false}
        toggleExpand={toggleExpand}
        toggleFavorite={vi.fn()}
        wordName="balay"
        playAudio={vi.fn()}
        isFavorited={false}
      />
    );
    expect(screen.queryByText('詞頻：')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('balay'));
    expect(toggleExpand).toHaveBeenCalledWith('k1');
  });

  test('標題是一顆 disclosure 按鈕：帶 aria-expanded、可用鍵盤 Enter／Space 展開（P2-40）', async () => {
    const user = userEvent.setup();
    const toggleExpand = vi.fn();
    render(
      <WordCard
        word="真的"
        result={baseResult}
        keyName="k1"
        isExpanded={false}
        toggleExpand={toggleExpand}
        toggleFavorite={vi.fn()}
        wordName="balay"
        playAudio={vi.fn()}
        isFavorited={false}
      />
    );
    const toggle = screen.getByRole('button', { name: /balay/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('heading', { level: 3 })).toContainElement(toggle);
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggleExpand).toHaveBeenCalledWith('k1');
    await user.keyboard(' ');
    expect(toggleExpand).toHaveBeenCalledTimes(2);
  });

  test('收藏按鈕呼叫 toggleFavorite(wordName)，不是整個 keyName', () => {
    const toggleFavorite = vi.fn();
    render(
      <WordCard
        word="真的"
        result={baseResult}
        keyName="k1-idx0-balay"
        isExpanded={false}
        toggleExpand={vi.fn()}
        toggleFavorite={toggleFavorite}
        wordName="balay"
        playAudio={vi.fn()}
        isFavorited={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '加入收藏' }));
    expect(toggleFavorite).toHaveBeenCalledWith('balay');
  });

  test('有原生音檔時就顯示播放鈕，不再需要另外傳入任何開關 prop', () => {
    const resultWithAudio = { ...baseResult, audioItems: [{ fileId: 'f1' }] };
    render(
      <WordCard
        word="真的"
        result={resultWithAudio}
        keyName="k1"
        isExpanded={false}
        toggleExpand={vi.fn()}
        toggleFavorite={vi.fn()}
        wordName="balay"
        playAudio={vi.fn()}
        isFavorited={false}
      />
    );
    // 播放鈕在標題旁邊，不再巢狀放在標題裡（P2-40），名稱帶出是哪個詞
    const play = screen.getByRole('button', { name: '播放「balay」的發音' });
    expect(screen.getByRole('heading', { level: 3 })).not.toContainElement(play);
  });

  test('沒有傳入 playSentence 時，例句不會顯示 TTS 備用播放鈕（避免呼叫 undefined 函式）', () => {
    const resultWithSentence = {
      ...baseResult,
      tribe: '布農語',
      explanationItems: [
        { chineseExplanation: '義項', sentenceItems: [{ originalSentence: '例句', chineseSentence: '中文例句' }] },
      ],
    };
    render(
      <WordCard
        word="真的"
        result={resultWithSentence}
        keyName="k1"
        isExpanded
        toggleExpand={vi.fn()}
        toggleFavorite={vi.fn()}
        wordName="balay"
        playAudio={vi.fn()}
        isFavorited={false}
      />
    );
    expect(screen.queryByLabelText('播放例句發音')).not.toBeInTheDocument();
  });

  describe('句子 TTS 備用播放鈕（回歸測試：原本寫死「布農語／排灣語」才顯示，改成問後端翻譯能力 API 的 hasSentenceAudio）', () => {
    const resultWithSentence = {
      ...baseResult,
      explanationItems: [
        { chineseExplanation: '義項', sentenceItems: [{ originalSentence: '例句', chineseSentence: '中文例句' }] },
      ],
    };

    test('hasSentenceAudio 為 false（這個族語沒有整句真人原音）時才顯示 TTS 備用播放鈕', () => {
      render(
        <WordCard
          word="真的"
          result={resultWithSentence}
          keyName="k1"
          isExpanded
          toggleExpand={vi.fn()}
          toggleFavorite={vi.fn()}
          wordName="balay"
          playAudio={vi.fn()}
          playSentence={vi.fn()}
          hasSentenceAudio={false}
          isFavorited={false}
        />
      );
      expect(screen.getByLabelText('播放例句發音')).toBeInTheDocument();
    });

    test('hasSentenceAudio 為 true 時不顯示 TTS 備用播放鈕（這個族語已經有整句真人原音）', () => {
      render(
        <WordCard
          word="真的"
          result={resultWithSentence}
          keyName="k1"
          isExpanded
          toggleExpand={vi.fn()}
          toggleFavorite={vi.fn()}
          wordName="balay"
          playAudio={vi.fn()}
          playSentence={vi.fn()}
          hasSentenceAudio
          isFavorited={false}
        />
      );
      expect(screen.queryByLabelText('播放例句發音')).not.toBeInTheDocument();
    });
  });
});
