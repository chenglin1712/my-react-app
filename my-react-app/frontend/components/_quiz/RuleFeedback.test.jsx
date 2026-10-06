import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RuleFeedback from './RuleFeedback';

const MA = 'v1|amis|P|ma||0';
const PA = 'v1|amis|P|pa||0';
const affixError = { diagnosis: { status: 'classified', errorType: 'wrong_affix', targetRule: MA, selectedRule: PA } };

describe('RuleFeedback', () => {
  test('沒有任何可說的診斷、也沒有摘要時什麼都不顯示', () => {
    const { container } = render(<RuleFeedback entries={[{ diagnosis: { status: 'correct' } }]} summary={{ available: false }} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('沒有傳入任何資料也不會出錯', () => {
    const { container } = render(<RuleFeedback />);
    expect(container).toBeEmptyDOMElement();
  });

  test('列出這次測驗說得出原因的錯誤，答對與無法分類的不列', () => {
    render(<RuleFeedback entries={[
      { diagnosis: { status: 'correct' } },
      affixError,
      { diagnosis: { status: 'ambiguous' } },
      { diagnosis: null },
      { diagnosis: { status: 'classified', errorType: 'wrong_root', targetRule: MA } },
    ]} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('詞綴選錯了：這個詞用的是「ma-」，你選的詞形用了「pa-」。');
    expect(items[1]).toHaveTextContent('不同詞根');
    expect(screen.getByText('這次測驗')).toBeInTheDocument();
  });

  test('顯示待加強的詞綴，熟練度四捨五入到 5% 並標明是估計', () => {
    render(<RuleFeedback summary={{
      available: true, minObservations: 5, confusions: [],
      weakest: [{ rule: MA, label: 'ma-', p: 0.3123, n: 8, c: 2 }],
    }} />);
    expect(screen.getByText('你的詞綴熟練度（估計）')).toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveTextContent('ma-：答 8 次、對 2 次，熟練度約 30%');
    expect(screen.getByText(/不是正式評量/)).toBeInTheDocument();
  });

  test('資料不夠時說明門檻，不顯示任何數字', () => {
    render(<RuleFeedback summary={{ available: true, minObservations: 5, weakest: [], confusions: [] }} />);
    expect(screen.getByText(/至少 5 次作答，才會列出熟練度估計/)).toBeInTheDocument();
    expect(screen.queryByText(/熟練度約/)).not.toBeInTheDocument();
  });

  test('常搞混的詞綴', () => {
    render(<RuleFeedback summary={{
      available: true, minObservations: 5, weakest: [],
      confusions: [{ target: MA, selected: PA, targetLabel: 'ma-', selectedLabel: 'pa-', count: 3 }],
    }} />);
    expect(screen.getByText('常搞混的詞綴')).toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveTextContent('該用 ma- 時選了 pa-（3 次）');
  });

  test('摘要沒帶標籤時由規則 ID 推出', () => {
    render(<RuleFeedback summary={{ available: true, minObservations: 5, weakest: [], confusions: [{ target: MA, selected: PA, count: 1 }] }} />);
    expect(screen.getByRole('listitem')).toHaveTextContent('該用 ma- 時選了 pa-（1 次）');
  });

  test('摘要不可用時只顯示這次測驗的診斷', () => {
    render(<RuleFeedback entries={[affixError]} summary={{ available: false }} />);
    expect(screen.queryByText('你的詞綴熟練度（估計）')).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  test.each([
    ['ruleFeedback 是物件', { a: 1 }],
    ['ruleFeedback 是字串', 'oops'],
    ['ruleFeedback 含 null 與數字', [null, 5, 'x']],
  ])('路由 state 形狀不對時（%s）不會丟錯', (_label, entries) => {
    const { container } = render(<RuleFeedback entries={entries} summary={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('API 回傳的欄位型別不對時不會丟錯，也不顯示 undefined', () => {
    render(<RuleFeedback summary={{ available: true, weakest: {}, confusions: 'x', minObservations: 'five' }} />);
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
    expect(screen.getByText(/每條詞綴要累積足夠作答/)).toBeInTheDocument();
  });

  test('available 必須是 true 才顯示摘要（字串 "false" 這種真值不算）', () => {
    const { container } = render(<RuleFeedback summary={{ available: 'false', weakest: [{ rule: MA, label: 'ma-', p: 0.2, n: 9, c: 1 }] }} />);
    expect(container).toBeEmptyDOMElement();
  });

  test.each([
    ['n 是物件', { rule: MA, label: 'ma-', p: 0.2, n: {}, c: 1 }],
    ['c 是陣列', { rule: MA, label: 'ma-', p: 0.2, n: 9, c: [1] }],
    ['p 是 NaN', { rule: MA, label: 'ma-', p: NaN, n: 9, c: 1 }],
    ['n 是負數', { rule: MA, label: 'ma-', p: 0.2, n: -3, c: 1 }],
    ['沒有規則 ID', { label: 'ma-', p: 0.2, n: 9, c: 1 }],
  ])('熟練度列的欄位型別不對（%s）時略過該列，不會丟錯', (_label, row) => {
    render(<RuleFeedback summary={{ available: true, minObservations: 5, confusions: [], weakest: [row] }} />);
    expect(screen.queryByText(/熟練度約/)).not.toBeInTheDocument();
    expect(screen.getByText(/目前沒有明顯待加強/)).toBeInTheDocument();
  });

  test('label 型別不對時改由規則 ID 推出標籤，不會丟錯', () => {
    render(<RuleFeedback summary={{ available: true, minObservations: 5, confusions: [],
      weakest: [{ rule: MA, label: {}, p: 0.2, n: 9, c: 1 }] }} />);
    expect(screen.getByRole('listitem')).toHaveTextContent('ma-：答 9 次、對 1 次，熟練度約 20%');
  });

  test.each([
    ['target 是物件', { target: {}, selected: PA, count: 2 }],
    ['count 是字串', { target: MA, selected: PA, count: '2' }],
    ['count 是 NaN', { target: MA, selected: PA, count: NaN }],
    ['selected 是陣列', { target: MA, selected: [PA], count: 2 }],
  ])('混淆列的欄位型別不對（%s）時略過該列，不會丟錯', (_label, row) => {
    render(<RuleFeedback summary={{ available: true, minObservations: 5, weakest: [], confusions: [row] }} />);
    expect(screen.queryByText('常搞混的詞綴')).not.toBeInTheDocument();
  });

  test('超長的字串會被截短，數字有上限', () => {
    render(<RuleFeedback summary={{ available: true, minObservations: 5, confusions: [],
      weakest: [{ rule: MA, label: 'x'.repeat(500), p: 0.2, n: 9e12, c: 1 }] }} />);
    const text = screen.getByRole('listitem').textContent;
    expect(text.length).toBeLessThan(200);
    expect(text).toContain('答 1000000 次');
  });

  test('列資料裡混有 null 時略過該列', () => {
    render(<RuleFeedback summary={{ available: true, minObservations: 5, confusions: [], weakest: [null, { rule: MA, label: 'ma-', p: 0.2, n: 9, c: 1 }] }} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });
});
