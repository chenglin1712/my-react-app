import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReviewQuestionDetail from './ReviewQuestionDetail';

describe('ReviewQuestionDetail（回歸測試：原本只認得是非題/圖片選擇題兩種格式）', () => {
  test('沒有選擇題目時顯示提示文字', () => {
    render(<ReviewQuestionDetail questionType="true_false" question={null} onClose={vi.fn()} />);
    expect(screen.getByText('尚未選擇題目')).toBeInTheDocument();
  });

  test('配合題（matching）用配合題專屬的呈現方式，不會被當成是非題顯示 O/X', () => {
    const question = {
      idx: 0,
      item: { pairs: [{ cn: '你好', word: { word: 'lokah' } }] },
      userAnswerNum: 1,
      correctAnswerNum: undefined,
      isCorrect: true,
    };
    render(<ReviewQuestionDetail questionType="matching" question={question} onClose={vi.fn()} />);

    expect(screen.getByText('配合題')).toBeInTheDocument();
    expect(screen.getByText('你好→lokah')).toBeInTheDocument();
    expect(screen.getAllByText('全對').length).toBe(2); // 你的答案／正確答案都顯示「全對」
    expect(screen.queryByText('O（符合）')).not.toBeInTheDocument();
  });

  test('閱讀填空（cloze）依 options 顯示使用者選項跟正確選項文字，不是 O/X', () => {
    const question = {
      idx: 1,
      item: { passage_ab: 'balay ___', passage_ch: '句子', options: ['好', '壞', '普通'] },
      userAnswerNum: 2,
      correctAnswerNum: 1,
      isCorrect: false,
    };
    render(<ReviewQuestionDetail questionType="cloze" question={question} onClose={vi.fn()} />);

    expect(screen.getByText('壞')).toBeInTheDocument();
    expect(screen.getByText('好')).toBeInTheDocument();
  });

  test('未知/不支援的題型顯示保底訊息，不會硬套用其他題型的格式', () => {
    const question = { idx: 0, item: {}, userAnswerNum: 1, correctAnswerNum: 1, isCorrect: true };
    render(<ReviewQuestionDetail questionType="not-a-real-type" question={question} onClose={vi.fn()} />);
    expect(screen.getByText('此題型的複習畫面暫不支援，請返回測驗紀錄重新選擇。')).toBeInTheDocument();
  });

  test('isCorrect 是 undefined（未作答）時不顯示答對或答錯圖示（回歸測試：原本用真值判斷會誤判成答錯）', () => {
    const question = { idx: 0, item: { question_ab: 'q' }, userAnswerNum: undefined, correctAnswerNum: 1, isCorrect: undefined };
    const { container } = render(<ReviewQuestionDetail questionType="true_false" question={question} onClose={vi.fn()} />);
    expect(container.querySelector('.icon-correct')).not.toBeInTheDocument();
    expect(container.querySelector('.icon-wrong')).not.toBeInTheDocument();
  });
});
