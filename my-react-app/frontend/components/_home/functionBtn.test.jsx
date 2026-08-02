import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FunctionBtn from './functionBtn';

function renderBtn(props) {
  return render(
    <MemoryRouter>
      <FunctionBtn {...props} />
    </MemoryRouter>,
  );
}

describe('FunctionBtn', () => {
  test('沒有帶 enabled prop 時三張卡片預設全部顯示', () => {
    renderBtn();
    expect(screen.getByText('影像辨識')).toBeInTheDocument();
    expect(screen.getByText('詞彙遊戲')).toBeInTheDocument();
    expect(screen.getByText('測驗學習')).toBeInTheDocument();
  });

  test('依 enabled 旗標隱藏被關閉的卡片，只保留內容/導向不能被後台亂改的其餘卡片', () => {
    renderBtn({ enabled: { button1: false, button2: true, button3: false } });
    expect(screen.queryByText('影像辨識')).not.toBeInTheDocument();
    expect(screen.getByText('詞彙遊戲')).toBeInTheDocument();
    expect(screen.queryByText('測驗學習')).not.toBeInTheDocument();
  });
});
