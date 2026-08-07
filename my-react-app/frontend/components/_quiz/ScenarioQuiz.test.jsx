import {
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ScenarioQuiz from './ScenarioQuiz';
import { apiGet, trackEvent } from '../../utils/apiClient';

vi.mock('../../utils/apiClient', () => ({
  apiGet: vi.fn(),
  trackEvent: vi.fn(),
}));

const responseData = {
  chapter_name: '泰雅語',
  parts: [
    {
      type: 'situation',
      title: '情境對話練習',
      intro: '請選出最適合回應的一個。',
      questions: [
        {
          scenario_ch: '長輩遞給你食物，你要怎麼回應？',
          options: [
            {
              foreign: 'Mhway su balay.',
              chinese: '非常謝謝你。',
            },
            {
              foreign: 'Lokah su?',
              chinese: '你好嗎？',
            },
            {
              foreign: 'Musa su inu?',
              chinese: '你要去哪裡？',
            },
            {
              foreign: 'Baq su balay.',
              chinese: '你很棒。',
            },
          ],
          answer: 1,
          item_id: 42,
        },
        {
          scenario_ch: '朋友問你要去哪裡，你怎麼回答？',
          options: [
            {
              foreign: 'Musa saku qutux.',
              chinese: '我要去外面。',
            },
            {
              foreign: 'Mhway su.',
              chinese: '謝謝你。',
            },
            {
              foreign: 'Lokah.',
              chinese: '很好。',
            },
            {
              foreign: 'Ini ku balay.',
              chinese: '我不知道。',
            },
          ],
          answer: 1,
          item_id: 77,
        },
      ],
    },
  ],
};

function renderQuiz(props = {}) {
  return render(
    <MemoryRouter>
      <ScenarioQuiz tribe="tayal" {...props} />
    </MemoryRouter>,
  );
}

describe('ScenarioQuiz', () => {
  beforeEach(() => {
    apiGet.mockReset();
    trackEvent.mockReset();
    apiGet.mockResolvedValue(responseData);
  });

  test('載入並一次顯示一題情境題', async () => {
    renderQuiz();

    expect(
      await screen.findByText('長輩遞給你食物，你要怎麼回應？'),
    ).toBeInTheDocument();

    expect(screen.getByText('Mhway su balay.')).toBeInTheDocument();
    expect(screen.getByText('Lokah su?')).toBeInTheDocument();

    expect(
      screen.queryByText('朋友問你要去哪裡，你怎麼回答？'),
    ).not.toBeInTheDocument();

    expect(apiGet).toHaveBeenCalledWith(
      '/crawler/situation-quiz/?tribe=tayal',
    );
  });

  test('選擇正確答案後顯示即時回饋並送出正確追蹤資料', async () => {
    renderQuiz();

    const answer = await screen.findByRole('button', {
      name: /Mhway su balay/,
    });

    fireEvent.click(answer);

    expect(screen.getByText('答對了！')).toBeInTheDocument();
    expect(screen.getByText('非常謝謝你。')).toBeInTheDocument();

    expect(trackEvent).toHaveBeenCalledWith('quiz_answer', {
      tribe: 'tayal',
      payload: {
        item_kind: 'situation',
        item_id: 42,
        correct: true,
      },
    });

    fireEvent.click(answer);
    expect(trackEvent).toHaveBeenCalledTimes(1);
  });

  test('選擇錯誤答案會追蹤 correct false 並標示正確答案', async () => {
    renderQuiz();

    fireEvent.click(
      await screen.findByRole('button', {
        name: /Lokah su/,
      }),
    );

    expect(
      screen.getByText('再留意一下這個情境。'),
    ).toBeInTheDocument();

    expect(
      screen.getByLabelText('正確答案'),
    ).toBeInTheDocument();

    expect(trackEvent).toHaveBeenCalledWith('quiz_answer', {
      tribe: 'tayal',
      payload: {
        item_kind: 'situation',
        item_id: 42,
        correct: false,
      },
    });
  });

  test('答完全部題目後顯示總結', async () => {
    renderQuiz();

    fireEvent.click(
      await screen.findByRole('button', {
        name: /Mhway su balay/,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '下一題' }));

    expect(
      screen.getByText('朋友問你要去哪裡，你怎麼回答？'),
    ).toBeInTheDocument();

    // 第二題的正解（answer: 1）是「Musa saku qutux.」（選項索引 0），
    // 不是「Mhway su.」——這裡刻意點正確答案，驗證「答對率 100%」的總結。
    fireEvent.click(
      screen.getByRole('button', {
        name: /Musa saku qutux/,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '查看結果' }));

    expect(
      screen.getByRole('heading', {
        name: '2 題中答對 2 題',
      }),
    ).toBeInTheDocument();

    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(trackEvent).toHaveBeenCalledTimes(2);
  });

  test('重新練習會重新呼叫題目 API', async () => {
    renderQuiz();

    fireEvent.click(
      await screen.findByRole('button', {
        name: /Mhway su balay/,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '下一題' }));
    fireEvent.click(
      screen.getByRole('button', {
        name: /Mhway su/,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '查看結果' }));
    fireEvent.click(screen.getByRole('button', { name: '重新練習' }));

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledTimes(2);
    });
  });

  test('API 失敗時顯示錯誤且可重新載入', async () => {
    apiGet.mockRejectedValueOnce(
      new Error('情境題載入失敗，請稍後再試'),
    );
    apiGet.mockResolvedValueOnce(responseData);

    renderQuiz();

    expect(
      await screen.findByText('情境題載入失敗，請稍後再試'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重新載入' }));

    expect(
      await screen.findByText('長輩遞給你食物，你要怎麼回應？'),
    ).toBeInTheDocument();

    expect(apiGet).toHaveBeenCalledTimes(2);
  });
});
