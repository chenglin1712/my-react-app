import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SentenceFill from './sentenceFill';
import { createAuthorizedAudio } from '../../utils/authAudio';

vi.mock('../../utils/authAudio', () => ({ createAuthorizedAudio: vi.fn() }));
vi.mock('lottie-web', () => ({ default: { loadAnimation: () => ({ addEventListener: vi.fn(), destroy: vi.fn() }) } }));
vi.mock('../../utils/correctSound', () => ({ playCorrectSound: vi.fn() }));

const QUESTION = {
  tayal: { sentence: 'balay ___ qwas', audio: 'sentence-audio' },
  options: [{ word: '好' }, { word: '壞' }],
  answer: '好',
};

describe('SentenceFill', () => {
  beforeEach(() => {
    createAuthorizedAudio.mockReset();
  });

  test('點選項目會回報給父層，再點一次同一個選項會取消選擇', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<SentenceFill question={QUESTION} selected={null} checked={false} onSelect={onSelect} onConfirm={vi.fn()} />);

    await user.click(screen.getByText('好'));
    expect(onSelect).toHaveBeenLastCalledWith('好');
  });

  test('確認答對時顯示正確、答錯時顯示錯誤，並回報完整的作答結果物件', async () => {
    const onSelect = vi.fn();
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<SentenceFill question={QUESTION} selected="好" checked={false} onSelect={onSelect} onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: '確認' }));

    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({
      result: true,
      userAnswer: '好',
      correctAnswer: '好',
    }));
    expect(onConfirm).toHaveBeenCalled();
  });

  test('句子旁邊的播放按鈕是真正的 button，鍵盤/滑鼠都能觸發播放語音', async () => {
    const audio = { pause: vi.fn(), play: vi.fn().mockResolvedValue(undefined), revokeObjectUrl: vi.fn() };
    createAuthorizedAudio.mockResolvedValueOnce(audio);
    const user = userEvent.setup();
    render(<SentenceFill question={QUESTION} selected={null} checked={false} onSelect={vi.fn()} onConfirm={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '播放句子語音' }));
    expect(createAuthorizedAudio).toHaveBeenCalledTimes(1);
  });

  describe('詞形干擾項的說明', () => {
    const WITH_NOTES = {
      ...QUESTION,
      options: [{ word: 'mafilo' }, { word: 'pafilo' }, { word: 'kafilo' }],
      answer: 'mafilo',
      distractorNotes: {
        pafilo: '詞根「filo」換成別的詞綴「pa-」（正確是「ma-」）',
        kafilo: '詞根「filo」換成別的詞綴「ka-」（正確是「ma-」）',
        notAnOption: '這個詞不在選項裡',
      },
    };

    test('作答後列出每個錯誤選項是怎麼造出來的，並聲明它們只是候選、不保證不存在', () => {
      render(<SentenceFill question={WITH_NOTES} selected="pafilo" checked onSelect={vi.fn()} onConfirm={vi.fn()} />);
      expect(screen.getByText('錯誤選項是怎麼造出來的')).toBeInTheDocument();
      expect(screen.getByText(/換成別的詞綴「pa-」/)).toBeInTheDocument();
      expect(screen.getByText(/換成別的詞綴「ka-」/)).toBeInTheDocument();
      expect(screen.getByText(/不代表它在族語裡一定不存在/)).toBeInTheDocument();
    });

    test('作答之前不顯示（說明會洩漏哪些是錯的）', () => {
      render(<SentenceFill question={WITH_NOTES} selected={null} checked={false} onSelect={vi.fn()} onConfirm={vi.fn()} />);
      expect(screen.queryByText('錯誤選項是怎麼造出來的')).not.toBeInTheDocument();
      expect(screen.queryByText(/換成別的詞綴/)).not.toBeInTheDocument();
    });

    test('不在選項裡的說明不顯示', () => {
      render(<SentenceFill question={WITH_NOTES} selected="mafilo" checked onSelect={vi.fn()} onConfirm={vi.fn()} />);
      expect(screen.queryByText(/這個詞不在選項裡/)).not.toBeInTheDocument();
    });

    test('沒有 distractorNotes（原本的隨機干擾項）就什麼都不多顯示', () => {
      render(<SentenceFill question={QUESTION} selected="好" checked onSelect={vi.fn()} onConfirm={vi.fn()} />);
      expect(screen.getByText(/正確答案/)).toBeInTheDocument();
      expect(screen.queryByText('錯誤選項是怎麼造出來的')).not.toBeInTheDocument();
    });
  });
});
