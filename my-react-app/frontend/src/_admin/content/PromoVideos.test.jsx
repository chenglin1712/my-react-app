import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import PromoVideos from './PromoVideos';
import { apiGet, apiPost, apiPatch, apiDelete } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({
  apiGet: vi.fn(), apiPost: vi.fn(), apiPatch: vi.fn(), apiDelete: vi.fn(),
}));

let mockRole = 'owner';
vi.mock('../../userServives/authContext', () => ({
  useAuth: () => ({ userData: { role: mockRole }, loading: false }),
}));

const empty = {
  id: 1, title: '介紹影片', description: '', transcript: '', video_path: '', cover_path: '', caption_path: '',
  duration_seconds: null, size_bytes: null, is_active: false, video_url: null, cover_url: null, caption_url: null,
};
const full = {
  ...empty, id: 2, title: '完整影片', video_path: 'homepage/video/a.mp4', cover_path: 'homepage/cover/a.jpg',
  caption_path: 'homepage/caption/a.vtt', duration_seconds: 125, size_bytes: 19300000,
  video_url: '/media/homepage/video/a.mp4', cover_url: '/media/homepage/cover/a.jpg', caption_url: '/media/homepage/caption/a.vtt',
};

function listOf(results, active = null) {
  return { results, count: results.length, active_promo_video: active };
}

async function openVideo(name) {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }));
}

describe('PromoVideos', () => {
  beforeEach(() => {
    mockRole = 'owner';
    [apiGet, apiPost, apiPatch, apiDelete].forEach((fn) => fn.mockReset());
    apiGet.mockResolvedValue(listOf([empty, full]));
  });

  test('列出影片並標示狀態：尚未上傳影片、首頁使用中', async () => {
    apiGet.mockResolvedValue(listOf([empty, full], 2));
    render(<PromoVideos />);
    const nav = await screen.findByRole('navigation', { name: '宣傳影片清單' });
    expect(within(nav).getByText('尚未上傳影片')).toBeInTheDocument();
    expect(within(nav).getByText('首頁使用中')).toBeInTheDocument();
  });

  test('沒有任何影片時顯示空狀態與新增入口', async () => {
    apiGet.mockResolvedValue(listOf([]));
    render(<PromoVideos />);
    expect(await screen.findByText('目前沒有宣傳影片')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /新增影片/ }).length).toBeGreaterThan(0);
  });

  test('載入失敗時顯示錯誤', async () => {
    apiGet.mockReset();
    apiGet.mockRejectedValueOnce(new Error('伺服器錯誤'));
    render(<PromoVideos />);
    expect(await screen.findByText('伺服器錯誤')).toBeInTheDocument();
  });

  test('新增：標題必填，建立後出現上傳欄位', async () => {
    apiGet.mockResolvedValueOnce(listOf([])).mockResolvedValueOnce(listOf([empty]));
    apiPost.mockResolvedValueOnce(empty);
    render(<PromoVideos />);
    fireEvent.click((await screen.findAllByRole('button', { name: /新增影片/ }))[0]);
    fireEvent.click(await screen.findByRole('button', { name: /建立並繼續上傳檔案/ }));
    expect(await screen.findByText('請填寫標題')).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('標題'), { target: { value: '介紹影片' } });
    fireEvent.click(screen.getByRole('button', { name: /建立並繼續上傳檔案/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/adminapi/promo-videos/', expect.objectContaining({ title: '介紹影片' })));
    expect(await screen.findByLabelText('影片檔')).toBeInTheDocument();
  });

  test('影片有預覽：不自動播放、帶封面與字幕軌，並顯示長度與大小', async () => {
    render(<PromoVideos />);
    await openVideo('完整影片');
    const video = await screen.findByLabelText('影片檔', { selector: 'input' }).then(() => document.querySelector('video'));
    expect(video).toHaveAttribute('controls');
    expect(video).not.toHaveAttribute('autoplay');
    expect(video).toHaveAttribute('poster', '/media/homepage/cover/a.jpg');
    expect(video.querySelector('track')).toHaveAttribute('src', '/media/homepage/caption/a.vtt');
    expect(screen.getByText(/2 分 05 秒，18\.4 MB/)).toBeInTheDocument();
  });

  test('上傳影片：用 FormData 的 file 欄位送出，成功後顯示訊息', async () => {
    apiPost.mockResolvedValueOnce(full);
    render(<PromoVideos />);
    await openVideo('介紹影片');
    const input = await screen.findByLabelText('影片檔', { selector: 'input' });
    const file = new File(['x'], 'v.mp4', { type: 'video/mp4' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    const [url, body, options] = apiPost.mock.calls[0];
    expect(url).toBe('/adminapi/promo-videos/1/video/');
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('file')).toBe(file);
    expect(options.timeout).toBeGreaterThan(60000);
    expect(await screen.findByText('影片檔已上傳')).toBeInTheDocument();
  });

  test('過大的檔案在送出前就被擋下，欄位旁說明上限', async () => {
    render(<PromoVideos />);
    await openVideo('介紹影片');
    const input = await screen.findByLabelText('封面圖', { selector: 'input' });
    const big = new File(['x'], 'c.jpg', { type: 'image/jpeg' });
    Object.defineProperty(big, 'size', { value: 3 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });
    expect(await screen.findByText(/封面圖不可超過 2 MB/)).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  test('後端拒絕上傳時，具體原因顯示在該欄位旁', async () => {
    const err = Object.assign(new Error('x'), { status: 400, message: '播放前要先下載整段的影片，請轉檔：ffmpeg -movflags +faststart' });
    apiPost.mockRejectedValueOnce(err);
    render(<PromoVideos />);
    await openVideo('介紹影片');
    const input = await screen.findByLabelText('影片檔', { selector: 'input' });
    fireEvent.change(input, { target: { files: [new File(['x'], 'v.mp4')] } });
    expect(await screen.findByText(/movflags \+faststart/)).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  test('檔案遺失時顯示警示與清單徽章', async () => {
    const lost = { ...full, id: 3, title: '遺失影片', video_url: null };
    apiGet.mockResolvedValue(listOf([lost]));
    render(<PromoVideos />);
    expect(await screen.findByText('影片檔遺失')).toBeInTheDocument();
    await openVideo('遺失影片');
    expect(await screen.findByText(/伺服器上找不到檔案/)).toBeInTheDocument();
  });

  test('移除封面呼叫 clear-cover', async () => {
    apiDelete.mockResolvedValueOnce({ ...full, cover_path: '', cover_url: null });
    render(<PromoVideos />);
    await openVideo('完整影片');
    fireEvent.click(await screen.findByRole('button', { name: '移除封面圖' }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/adminapi/promo-videos/2/clear-cover/'));
  });

  test('設為首頁宣傳影片：沒有影片檔時不能啟用；有影片檔時送出啟用', async () => {
    apiPatch.mockResolvedValueOnce({});
    render(<PromoVideos />);
    await openVideo('介紹影片');
    expect(await screen.findByRole('button', { name: '設為首頁宣傳影片' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /完整影片/ }));
    const button = await screen.findByRole('button', { name: '設為首頁宣傳影片' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(apiPatch).not.toHaveBeenCalled(); // 立即公開的動作要先確認
    expect(screen.getByText(/儲存後會立即公開/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '確定設為首頁使用' }));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/adminapi/homepage-config/', { active_promo_video: 2 }));
    expect(await screen.findByText(/已設為首頁宣傳影片/)).toBeInTheDocument();
  });

  test('啟用中的影片可以停用，而且不能刪除', async () => {
    apiGet.mockResolvedValue(listOf([full], 2));
    apiPatch.mockResolvedValueOnce({});
    render(<PromoVideos />);
    await openVideo('完整影片');
    expect(await screen.findByText(/要先停用才能刪除/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /刪除這支影片/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /停用，首頁改顯示備援/ }));
    expect(apiPatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '確定停用' }));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/adminapi/homepage-config/', { active_promo_video: null }));
  });

  test('啟用被後端拒絕時顯示具體原因', async () => {
    apiPatch.mockRejectedValueOnce(Object.assign(new Error('請求參數錯誤'), {
      status: 400, data: { errors: { active_promo_video: ['這支影片還沒有上傳影片檔，無法啟用'] } },
    }));
    render(<PromoVideos />);
    await openVideo('完整影片');
    fireEvent.click(await screen.findByRole('button', { name: '設為首頁宣傳影片' }));
    fireEvent.click(await screen.findByRole('button', { name: '確定設為首頁使用' }));
    expect(await screen.findByText('這支影片還沒有上傳影片檔，無法啟用')).toBeInTheDocument();
  });

  test('刪除要先在頁面內確認，確認後才呼叫 API', async () => {
    apiDelete.mockResolvedValueOnce({ detail: '已刪除' });
    render(<PromoVideos />);
    await openVideo('介紹影片');
    fireEvent.click(await screen.findByRole('button', { name: /刪除這支影片/ }));
    expect(apiDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /確定刪除/ }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/adminapi/promo-videos/1/'));
  });

  test('editor 看得到影片但沒有任何編輯、上傳、啟用或刪除控制', async () => {
    mockRole = 'editor';
    render(<PromoVideos />);
    expect(await screen.findByText(/只有擁有者或管理員可以新增/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /新增影片/ })).not.toBeInTheDocument();
    await openVideo('完整影片');
    expect(await screen.findByLabelText('標題')).toBeDisabled();
    expect(screen.queryByLabelText('影片檔', { selector: 'input' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '設為首頁宣傳影片' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /刪除這支影片/ })).not.toBeInTheDocument();
  });

  test('全頁欄位與說明 id 不重複', async () => {
    const { container } = render(<PromoVideos />);
    await openVideo('完整影片');
    await screen.findByLabelText('影片檔', { selector: 'input' });
    const ids = [...container.querySelectorAll('[id]')].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('上傳中顯示進度，送出完畢後顯示伺服器檢查中', async () => {
    let finish;
    apiPost.mockImplementationOnce((url, body, options) => new Promise((resolve) => {
      options.onUploadProgress({ loaded: 50, total: 100 });
      finish = (value) => {
        options.onUploadProgress({ loaded: 100, total: 100 });
        resolve(value);
      };
    }));
    render(<PromoVideos />);
    await openVideo('介紹影片');
    fireEvent.change(await screen.findByLabelText('影片檔', { selector: 'input' }), { target: { files: [new File(['x'], 'v.mp4')] } });
    expect(await screen.findByText(/上傳中 50%/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '上傳進度' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消上傳' })).toBeInTheDocument();
    finish(full);
    await waitFor(() => expect(screen.queryByText(/上傳中/)).not.toBeInTheDocument());
  });

  test('取消上傳會中止請求並說明結果以重新載入為準', async () => {
    apiPost.mockImplementationOnce((url, body, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' })));
    }));
    render(<PromoVideos />);
    await openVideo('介紹影片');
    fireEvent.change(await screen.findByLabelText('影片檔', { selector: 'input' }), { target: { files: [new File(['x'], 'v.mp4')] } });
    fireEvent.click(await screen.findByRole('button', { name: '取消上傳' }));
    expect(await screen.findByText(/已取消上傳/)).toBeInTheDocument();
  });

  test('沒有收到回應時不宣告失敗：重新讀取實際狀態並提醒先確認再重傳', async () => {
    apiPost.mockRejectedValueOnce(Object.assign(new Error('逾時'), { name: 'ApiError', timedOut: true }));
    apiGet.mockImplementation(async (url) => (url === '/adminapi/promo-videos/1/' ? { ...empty, video_path: 'homepage/video/z.mp4', video_url: '/media/homepage/video/z.mp4' } : listOf([empty, full])));
    render(<PromoVideos />);
    await openVideo('介紹影片');
    fireEvent.change(await screen.findByLabelText('影片檔', { selector: 'input' }), { target: { files: [new File(['x'], 'v.mp4')] } });
    expect(await screen.findByText(/無法確認上傳結果/)).toBeInTheDocument();
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/adminapi/promo-videos/1/'));
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull());
  });

  test('有未儲存的文字變更時切換影片要先確認，可以留下或放棄', async () => {
    render(<PromoVideos />);
    await openVideo('介紹影片');
    fireEvent.change(await screen.findByLabelText('標題'), { target: { value: '改到一半' } });
    fireEvent.click(screen.getByRole('button', { name: /完整影片/ }));
    expect(await screen.findByText(/尚未儲存的文字變更/)).toBeInTheDocument();
    expect(screen.getByLabelText('標題')).toHaveValue('改到一半');
    fireEvent.click(screen.getByRole('button', { name: '留在這裡' }));
    expect(screen.getByLabelText('標題')).toHaveValue('改到一半');
    fireEvent.click(screen.getByRole('button', { name: /完整影片/ }));
    fireEvent.click(await screen.findByRole('button', { name: '放棄變更並切換' }));
    await waitFor(() => expect(screen.getByLabelText('標題')).toHaveValue('完整影片'));
  });

  test('沒有改動就切換不會被攔；有改動時關閉分頁會觸發離開確認', async () => {
    render(<PromoVideos />);
    await openVideo('介紹影片');
    await screen.findByLabelText('標題');
    fireEvent.click(screen.getByRole('button', { name: /完整影片/ }));
    await waitFor(() => expect(screen.getByLabelText('標題')).toHaveValue('完整影片'));
    expect(screen.queryByText(/尚未儲存的文字變更/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('標題'), { target: { value: '改了' } });
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  test('刪除後焦點回到頁面標題，不會掉到 body', async () => {
    apiDelete.mockResolvedValueOnce({ detail: '已刪除' });
    render(<PromoVideos />);
    await openVideo('介紹影片');
    fireEvent.click(await screen.findByRole('button', { name: /刪除這支影片/ }));
    fireEvent.click(screen.getByRole('button', { name: /確定刪除/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: '宣傳影片', level: 1 })).toHaveFocus());
  });

  test('上傳途中離開頁面會中止請求', async () => {
    let aborted = false;
    apiPost.mockImplementationOnce((url, body, options) => new Promise(() => {
      options.signal.addEventListener('abort', () => { aborted = true; });
    }));
    const { unmount } = render(<PromoVideos />);
    await openVideo('介紹影片');
    fireEvent.change(await screen.findByLabelText('影片檔', { selector: 'input' }), { target: { files: [new File(['x'], 'v.mp4')] } });
    await screen.findByRole('button', { name: '取消上傳' });
    unmount();
    expect(aborted).toBe(true);
  });
});
