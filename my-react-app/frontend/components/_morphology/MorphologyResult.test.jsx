import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import MorphologyResult from './MorphologyResult';
import { ANNOUNCE_EVENT } from '../../utils/announce';

const base = (over = {}) => ({
  tribe: '阿美語', tribeSlug: 'amis', input: 'cimaopohayay', normalized: 'cimaopohayay',
  token: { status: 'unknown', wordIds: [] },
  candidates: [], rulesAvailable: true, admittedRuleCount: 2, notes: [],
  ...over,
});

const ruleCandidate = (over = {}) => ({
  source: 'rule', confidence: 'high', root: 'maopohay', rootWordIds: ['w1'],
  gloss: '迅速又勤快地工作的', audioFileId: 'audio-root',
  segments: [{ text: 'ci', kind: 'affix' }, { text: 'maopohay', kind: 'root' }, { text: 'ay', kind: 'affix' }],
  rule: { marker: 'ci-…-ay', kind: 'C', function: '工具焦點 / 實然式標記' },
  examples: [{ original: 'cimaopohayay ko', chinese: '例句中文', audioFileId: 'audio-ex', isTokenSource: false }],
  ...over,
});

describe('MorphologyResult', () => {
  test('沒有結果時什麼都不顯示', () => {
    const { container } = render(<MorphologyResult result={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('顯示輸入的詞形與它在辭典裡的狀態，永遠附上「不代表存在」的聲明', () => {
    render(<MorphologyResult result={base()} />);
    expect(screen.getByText('cimaopohayay')).toBeInTheDocument();
    expect(screen.getByText('辭典查無此詞形')).toBeInTheDocument();
    expect(screen.getByText(/不代表它在族語裡真的存在/)).toBeInTheDocument();
  });

  test.each([
    ['headword', '辭典詞條'],
    ['attested', '辭典例句中出現過'],
    ['unknown', '辭典查無此詞形'],
  ])('詞形狀態 %s 顯示成「%s」', (status, label) => {
    render(<MorphologyResult result={base({ token: { status, wordIds: [] } })} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  test('辭典詞條會顯示它自己的釋義', () => {
    render(<MorphologyResult result={base({ token: { status: 'headword', gloss: '勝任', wordIds: ['w'] } })} />);
    expect(screen.getByText('＝ 勝任')).toBeInTheDocument();
  });

  test('出現在例句裡的詞形會顯示出處例句', () => {
    const attestedSentence = { original: '含這個詞的句子', chinese: '出處中文', isTokenSource: true };
    render(<MorphologyResult result={base({ token: { status: 'attested', wordIds: [], attestedSentence } })} />);
    expect(screen.getByText('出現在這個辭典例句：')).toBeInTheDocument();
    expect(screen.getByText('含這個詞的句子')).toBeInTheDocument();
  });

  test('規則結果：顯示詞根、釋義、規則標記與功能，以及依序的切分片段', () => {
    render(<MorphologyResult result={base({ candidates: [ruleCandidate()] })} />);
    expect(screen.getByText('把握程度高')).toBeInTheDocument();
    expect(screen.getByText('maopohay', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText(/迅速又勤快地工作的/)).toBeInTheDocument();
    expect(screen.getByText('ci-…-ay')).toBeInTheDocument();
    expect(screen.getByText(/工具焦點 \/ 實然式標記/)).toBeInTheDocument();

    const segs = screen.getAllByTitle(/^(詞根|詞綴|重疊)$/);
    expect(segs.map((s) => s.textContent)).toEqual(['ci', 'maopohay', 'ay']);
    expect(segs.map((s) => s.getAttribute('title'))).toEqual(['詞綴', '詞根', '詞綴']);
    // 不只靠顏色：切分區塊有完整的文字描述給螢幕閱讀器
    expect(screen.getByLabelText('詞綴ci，詞根maopohay，詞綴ay')).toBeInTheDocument();
  });

  test('重疊片段用「重疊」標題', () => {
    const c = ruleCandidate({ segments: [{ text: 'si', kind: 'redup' }, { text: 'siwa', kind: 'root' }] });
    render(<MorphologyResult result={base({ candidates: [c] })} />);
    expect(screen.getByTitle('重疊')).toHaveTextContent('si');
  });

  test('沒有功能說明時明說沒有，不編造', () => {
    const c = ruleCandidate({ rule: { marker: '-em-', kind: 'I', function: null } });
    render(<MorphologyResult result={base({ candidates: [c] })} />);
    expect(screen.getByText('-em-')).toBeInTheDocument();
    expect(screen.getByText(/辭典沒有這條詞綴的功能說明/)).toBeInTheDocument();
  });

  test.each([
    ['dictionary', '辭典標註'],
    ['high', '把握程度高'],
    ['medium', '把握程度中・僅供參考'],
    ['low', '拼寫相近・把握程度低'],
  ])('把握程度 %s 的標籤是「%s」，並有說明文字', (confidence, label) => {
    const c = ruleCandidate({ confidence, source: confidence === 'dictionary' ? 'dictionary' : 'rule' });
    render(<MorphologyResult result={base({ candidates: [c] })} />);
    const badge = screen.getByText(label);
    expect(badge).toHaveAttribute('title');
    expect(badge.getAttribute('title').length).toBeGreaterThan(5);
  });

  test('拼寫相近的結果顯示「你是不是想找」與相差字母數，而且不顯示詞綴切分或規則', () => {
    const c = { source: 'similar', confidence: 'low', root: 'filo', rootWordIds: ['w'], gloss: '勝任', distance: 1, examples: [] };
    render(<MorphologyResult result={base({ candidates: [c] })} />);
    expect(screen.getByText(/你是不是想找/)).toBeInTheDocument();
    expect(screen.getByText('filo')).toBeInTheDocument();
    expect(screen.getByText('（相差 1 個字母）')).toBeInTheDocument();
    expect(screen.queryByTitle('詞綴')).not.toBeInTheDocument();
    expect(screen.queryByText(/^詞綴：/)).not.toBeInTheDocument();
    expect(screen.queryByText(/詞根 /)).not.toBeInTheDocument();
  });

  test('就算後端意外給了切分與規則，拼寫相近的結果也絕不顯示（它不是形態分析）', () => {
    const c = {
      source: 'similar', confidence: 'low', root: 'filo', rootWordIds: [], distance: 1, examples: [],
      segments: [{ text: 'ma', kind: 'affix' }, { text: 'filo', kind: 'root' }],
      rule: { marker: 'ma-', kind: 'P', function: '不該出現' },
    };
    render(<MorphologyResult result={base({ candidates: [c] })} />);
    expect(screen.queryByTitle('詞綴')).not.toBeInTheDocument();
    expect(screen.queryByText('不該出現')).not.toBeInTheDocument();
    expect(screen.getByText(/你是不是想找/)).toBeInTheDocument();
  });

  test('音檔按鈕會用音檔 id 呼叫 onPlayAudio（詞根與例句各一個）', () => {
    const onPlayAudio = vi.fn();
    render(<MorphologyResult result={base({ candidates: [ruleCandidate()] })} onPlayAudio={onPlayAudio} />);
    fireEvent.click(screen.getByRole('button', { name: '播放 maopohay 的發音' }));
    fireEvent.click(screen.getByRole('button', { name: '播放例句發音' }));
    expect(onPlayAudio.mock.calls).toEqual([['audio-root'], ['audio-ex']]);
  });

  test('沒有音檔 id 或沒有播放函式時不顯示音檔按鈕', () => {
    const { rerender } = render(<MorphologyResult result={base({ candidates: [ruleCandidate({ audioFileId: null, examples: [] })] })} onPlayAudio={vi.fn()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(<MorphologyResult result={base({ candidates: [ruleCandidate()] })} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('沒有任何候選時顯示後端給的說明', () => {
    render(<MorphologyResult result={base({ notes: ['辭典裡沒有這個詞形，也找不到可信的分析結果。', '另一則說明'] })} />);
    expect(screen.getByText('辭典裡沒有這個詞形，也找不到可信的分析結果。')).toBeInTheDocument();
    expect(screen.getByText('另一則說明')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  test('候選依後端給的順序顯示', () => {
    const cands = [
      ruleCandidate({ source: 'dictionary', confidence: 'dictionary', root: 'first' }),
      ruleCandidate({ root: 'second' }),
    ];
    render(<MorphologyResult result={base({ candidates: cands })} />);
    const items = screen.getAllByRole('listitem').filter((li) => li.className.includes('yy-morph-candidate'));
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('first')).toBeInTheDocument();
    expect(within(items[1]).getByText('second')).toBeInTheDocument();
  });

  test('緊湊模式加上對應的樣式類別；結果區本身不再掛 aria-live（FE3-17 改由常駐公告區唸）', () => {
    const { container } = render(<MorphologyResult result={base()} compact />);
    expect(container.firstChild).toHaveClass('yy-morph-compact');
    expect(container.firstChild).not.toHaveAttribute('aria-live');
  });

  // FE3-17：live region 先存在、再更新內容才會被唸；這裡改走全站的 announce()
  describe('結果公告（FE3-17）', () => {
    const heard = [];
    const listener = (e) => heard.push(e.detail.message);
    beforeEach(() => { heard.length = 0; window.addEventListener(ANNOUNCE_EVENT, listener); });
    afterEach(() => window.removeEventListener(ANNOUNCE_EVENT, listener));

    test('結果出現時公告可能詞根的數量，同一筆結果重新渲染不重複公告', () => {
      const result = base({ candidates: [ruleCandidate()] });
      const { rerender } = render(<MorphologyResult result={result} />);
      expect(heard).toHaveLength(1);
      expect(heard[0]).toBe('詞形分析完成，找到 1 個可能的詞根');
      rerender(<MorphologyResult result={result} compact />);
      expect(heard).toHaveLength(1);
    });

    test('沒有候選詞根時公告「沒有找到可能的詞根」；result 為 null 不公告', () => {
      const { rerender } = render(<MorphologyResult result={null} />);
      expect(heard).toHaveLength(0);
      rerender(<MorphologyResult result={base({ candidates: [] })} />);
      expect(heard).toEqual(['詞形分析完成，沒有找到可能的詞根']);
    });
  });
});
