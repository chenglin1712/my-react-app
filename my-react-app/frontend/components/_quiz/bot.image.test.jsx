import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AIAssistantOverlay from './bot';
import { apiGet, apiPost } from '../../utils/apiClient';
import { prepareChatImage, ChatImageError, DEFAULT_IMAGE_PROMPT } from './chatImage';

vi.mock('../../utils/apiClient', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiStream: vi.fn() }));
vi.mock('./bot_study_plan', () => ({ default: () => null }));
vi.mock('../../hooks/useAuthorizedAudioPlayback', () => ({
  default: () => ({ playAudio: vi.fn(), failedAudio: new Set() }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@utils/announce', () => ({ announce: vi.fn() }));
// 縮圖需要 canvas，jsdom 沒有；縮圖本身由 chatImage.test.js 驗證邏輯，這裡只關心畫面行為
vi.mock('./chatImage', async (importActual) => ({ ...(await importActual()), prepareChatImage: vi.fn() }));

const PREPARED = { media_type: 'image/jpeg', data: 'QUJD', previewUrl: 'blob:preview-1' };
const photo = () => new File(['x'], 'card.jpg', { type: 'image/jpeg' });

const openWithImages = async (enabled = true) => {
  apiGet.mockResolvedValue({ remaining: 50, resetsAt: null, features: { imageInput: enabled } });
  const view = render(<AIAssistantOverlay onClose={vi.fn()} />);
  if (enabled) await screen.findByRole('button', { name: '拍照或選擇圖片' });
  return view;
};

const chooseFile = async (user, file = photo()) => {
  await user.upload(document.querySelector('input[type="file"]'), file);
};

describe('AIAssistantOverlay 圖片提問（路線圖 #24）', () => {
  beforeEach(() => {
    apiPost.mockReset();
    apiGet.mockReset();
    prepareChatImage.mockReset();
    prepareChatImage.mockResolvedValue({ ...PREPARED });
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
  });

  test('後端沒開圖片提問（或讀不到）時不顯示拍照鈕', async () => {
    await openWithImages(false);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: '拍照或選擇圖片' })).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument();
  });

  test('選好圖片後顯示預覽與移除鈕，移除後焦點回到拍照鈕並釋放預覽', async () => {
    const user = userEvent.setup();
    await openWithImages();
    await chooseFile(user);

    expect(await screen.findByAltText('準備送出的圖片預覽')).toBeInTheDocument();
    expect(screen.getByLabelText('輸入訊息')).toHaveAttribute('placeholder', '想問這張圖的什麼？（可不填）');

    await user.click(screen.getByRole('button', { name: '移除圖片' }));

    expect(screen.queryByAltText('準備送出的圖片預覽')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '拍照或選擇圖片' })).toHaveFocus();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
  });

  test('處理失敗時用固定說明提示，不送出、不留預覽', async () => {
    prepareChatImage.mockRejectedValue(new ChatImageError('unsupported'));
    const user = userEvent.setup({ applyAccept: false });  // 讓不是圖片的檔案也進得來（手動拖放或選「所有檔案」的情況）
    await openWithImages();
    await chooseFile(user, new File(['x'], 'a.pdf', { type: 'application/pdf' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('這個檔案不是可以使用的圖片');
    expect(screen.queryByAltText('準備送出的圖片預覽')).not.toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  test('只附圖片沒打字也能送出：用預設問題，請求帶 image（不含預覽網址），泡泡顯示縮圖', async () => {
    apiPost.mockResolvedValue({ message: '這是 lokah，辨識不確定。' });
    const user = userEvent.setup();
    await openWithImages();
    await chooseFile(user);
    await screen.findByAltText('準備送出的圖片預覽');

    await user.click(screen.getByRole('button', { name: '發送' }));

    expect(await screen.findByText('這是 lokah，辨識不確定。')).toBeInTheDocument();
    const body = apiPost.mock.calls[0][1];
    expect(body.message).toBe(DEFAULT_IMAGE_PROMPT);
    expect(body.image).toEqual({ media_type: 'image/jpeg', data: 'QUJD' });
    expect(JSON.stringify(body)).not.toContain('blob:');
    expect(screen.getByAltText('你附上的圖片')).toHaveAttribute('src', 'blob:preview-1');
    expect(screen.queryByAltText('準備送出的圖片預覽')).not.toBeInTheDocument();
  });

  test('下一個問題不會再帶上一張圖（圖片只用於那一次提問）', async () => {
    apiPost.mockResolvedValue({ message: 'ok' });
    const user = userEvent.setup();
    await openWithImages();
    await chooseFile(user);
    await user.type(screen.getByLabelText('輸入訊息'), '這個字怎麼唸{Enter}');
    await screen.findByText('ok');

    await user.type(screen.getByLabelText('輸入訊息'), '謝謝{Enter}');
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));

    expect(apiPost.mock.calls[0][1]).toMatchObject({ message: '這個字怎麼唸', image: expect.any(Object) });
    expect(apiPost.mock.calls[1][1]).not.toHaveProperty('image');
  });

  test.each([
    [{ status: 403, data: { code: 'ai_image_input_disabled' } }, /圖片提問目前沒有開放/],
    [{ status: 400, data: {} }, /這張圖片無法使用/],
    [{ status: 429, data: {} }, /附圖片提問的次數太頻繁/],
  ])('圖片提問失敗時顯示專屬說明，並把圖片放回輸入區（%j）', async (failure, expected) => {
    apiPost.mockRejectedValue(Object.assign(new Error('x'), failure));
    const user = userEvent.setup();
    await openWithImages();
    await chooseFile(user);
    await user.click(screen.getByRole('button', { name: '發送' }));

    const log = await screen.findByRole('log', { name: '對話紀錄' });
    await waitFor(() => expect(within(log).getByText(expected)).toBeInTheDocument());
    if (failure.status === 403) {
      // 功能被關掉：拍照鈕消失、圖片也不放回輸入區，避免學生一直重送一張必定被拒絕的圖
      expect(screen.queryByRole('button', { name: '拍照或選擇圖片' })).not.toBeInTheDocument();
      expect(screen.queryByAltText('準備送出的圖片預覽')).not.toBeInTheDocument();
    } else {
      expect(screen.getByAltText('準備送出的圖片預覽')).toBeInTheDocument();
    }
  });

  test('功能被關閉後再按發送：不會再帶 image', async () => {
    apiPost.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 403, data: { code: 'ai_image_input_disabled' } }));
    apiPost.mockResolvedValue({ message: 'ok' });
    const user = userEvent.setup();
    await openWithImages();
    await chooseFile(user);
    await user.click(screen.getByRole('button', { name: '發送' }));
    await screen.findByText(/圖片提問目前沒有開放/);

    await user.type(screen.getByLabelText('輸入訊息'), '改用文字問{Enter}');
    await screen.findByText('ok');

    expect(apiPost.mock.calls[1][1]).not.toHaveProperty('image');
  });

  test('已送出的圖片縮圖在放回輸入區又被移除後仍然有效；關閉視窗時才釋放全部預覽網址', async () => {
    apiPost.mockRejectedValue(Object.assign(new Error('x'), { status: 400, data: {} }));
    const user = userEvent.setup();
    const { unmount } = await openWithImages();
    await chooseFile(user);
    await user.click(screen.getByRole('button', { name: '發送' }));
    await screen.findByText(/這張圖片無法使用/);

    await user.click(screen.getByRole('button', { name: '移除圖片' }));

    expect(URL.revokeObjectURL).not.toHaveBeenCalled();           // 泡泡裡的縮圖還在用
    expect(screen.getByAltText('你附上的圖片')).toHaveAttribute('src', 'blob:preview-1');
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
  });

  test('回覆等待中不能移除圖片或重複選圖', async () => {
    let finish;
    apiPost.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const user = userEvent.setup();
    await openWithImages();
    await chooseFile(user);
    await user.click(screen.getByRole('button', { name: '發送' }));

    expect(screen.getByRole('button', { name: '拍照或選擇圖片' })).toHaveAttribute('aria-disabled', 'true');
    finish({ message: 'done' });
    expect(await screen.findByText('done')).toBeInTheDocument();
  });
});
