import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FeaturedTopics from './FeaturedTopics';
import { apiGet, apiPost, apiPatch, apiDelete } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({
  apiGet: vi.fn(), apiPost: vi.fn(), apiPatch: vi.fn(), apiDelete: vi.fn(),
}));

let mockRole = 'owner';
vi.mock('../../userServives/authContext', () => ({
  useAuth: () => ({ userData: { role: mockRole }, loading: false }),
}));

// TipTap 在 jsdom 裡不穩定，編輯器本身另有測試；這裡用替身，按鈕代替「在編輯器裡打字」
let mockDoc = null;
vi.mock('../components/RichTextEditor', () => ({
  default: ({ onChange, disabled, value }) => (
    <div data-testid="rte" data-disabled={String(Boolean(disabled))} data-value={JSON.stringify(value)}>
      <button type="button" onClick={() => onChange(mockDoc)}>模擬輸入內文</button>
    </div>
  ),
}));
const docOf = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

vi.mock('../hooks/useMediaUpload', () => ({
  useMediaUpload: () => ({
    uploadingKey: null, error: '', previews: {}, setPreview: vi.fn(), upload: vi.fn(),
  }),
}));

const topic = (over) => ({
  id: 1, title: '族語學習路徑', summary: '', image_url: '', category_label: '', sort_order: 0, content: {}, source_label: '', image_caption: '',
  status: 'draft', review_comment: '', has_pending_revision: false, updated_at: '2026-10-01T00:00:00Z', ...over,
});

let topics;
function setTopics(list) {
  topics = list;
  apiGet.mockImplementation(async (url) => {
    if (url === '/adminapi/featured-topics/') return { results: topics, count: topics.length };
    const err = new Error('沒有待審修改');
    err.status = 404;
    throw err;
  });
}

const open = async (name) => fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }));

describe('FeaturedTopics', () => {
  beforeEach(() => {
    mockRole = 'owner';
    [apiGet, apiPost, apiPatch, apiDelete].forEach((fn) => fn.mockReset());
    setTopics([topic()]);
  });

  test('列出專題、狀態與排序；說明最多同時顯示 3 則', async () => {
    setTopics([topic(), topic({ id: 2, title: '考試準備', status: 'published', sort_order: 5, has_pending_revision: true })]);
    render(<FeaturedTopics />);
    expect(await screen.findByText(/最多同時顯示 3 則/)).toBeInTheDocument();
    expect(screen.getByText('草稿')).toBeInTheDocument();
    expect(screen.getByText('已發布')).toBeInTheDocument();
    expect(screen.getByText('有待審修改')).toBeInTheDocument();
    expect(screen.getByText('排序 5')).toBeInTheDocument();
  });

  test('沒有專題時顯示空狀態；載入失敗時顯示錯誤', async () => {
    setTopics([]);
    const { unmount } = render(<FeaturedTopics />);
    expect(await screen.findByText('目前沒有專題')).toBeInTheDocument();
    unmount();
    apiGet.mockReset();
    apiGet.mockRejectedValueOnce(new Error('伺服器錯誤'));
    render(<FeaturedTopics />);
    expect(await screen.findByText('伺服器錯誤')).toBeInTheDocument();
  });

  test('新增並送審：先建立再送審，各一次呼叫', async () => {
    setTopics([]);
    apiPost.mockResolvedValueOnce(topic({ id: 9 })).mockResolvedValueOnce(topic({ id: 9, status: 'pending_review' }));
    render(<FeaturedTopics />);
    fireEvent.click((await screen.findAllByRole('button', { name: /新增專題/ }))[0]);
    fireEvent.change(await screen.findByLabelText('標題'), { target: { value: ' 新專題 ' } });
    fireEvent.click(screen.getByRole('button', { name: /儲存並送審/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
    expect(apiPost.mock.calls[0][0]).toBe('/adminapi/featured-topics/');
    expect(apiPost.mock.calls[0][1]).toEqual(expect.objectContaining({ title: '新專題', sort_order: 0 }));
    expect(apiPost.mock.calls[1][0]).toBe('/adminapi/featured-topics/9/submit/');
  });

  test('文章欄位：內文（富文字文件）、作者／來源、圖說會一起送出', async () => {
    setTopics([]);
    mockDoc = docOf('第一段');
    apiPost.mockResolvedValueOnce(topic({ id: 9 }));
    render(<FeaturedTopics />);
    fireEvent.click((await screen.findAllByRole('button', { name: /新增專題/ }))[0]);
    fireEvent.change(await screen.findByLabelText('標題'), { target: { value: '專題' } });
    fireEvent.click(screen.getByRole('button', { name: '模擬輸入內文' }));
    fireEvent.change(screen.getByLabelText('作者／來源'), { target: { value: ' 編輯部 ' } });
    fireEvent.change(screen.getByLabelText('圖說'), { target: { value: ' 織布的手 ' } });
    fireEvent.click(screen.getByRole('button', { name: /建立草稿/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const sent = apiPost.mock.calls[0][1];
    expect(sent).toEqual(expect.objectContaining({ content: mockDoc, source_label: '編輯部', image_caption: '織布的手' }));
    expect(sent).not.toHaveProperty('link_url');
    expect(sent).not.toHaveProperty('body');
  });

  test('沒寫內文（只有空段落）送出的是 {}，不是空文件', async () => {
    setTopics([]);
    mockDoc = { type: 'doc', content: [{ type: 'paragraph' }] };
    apiPost.mockResolvedValueOnce(topic({ id: 9 }));
    render(<FeaturedTopics />);
    fireEvent.click((await screen.findAllByRole('button', { name: /新增專題/ }))[0]);
    fireEvent.change(await screen.findByLabelText('標題'), { target: { value: '專題' } });
    fireEvent.click(screen.getByRole('button', { name: '模擬輸入內文' }));
    fireEvent.click(screen.getByRole('button', { name: /建立草稿/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    expect(apiPost.mock.calls[0][1].content).toEqual({});
  });

  test('既有內文會帶進編輯器；送審中唯讀', async () => {
    setTopics([topic({ content: docOf('舊內文'), status: 'pending_review' })]);
    render(<FeaturedTopics />);
    await open('族語學習路徑');
    const editor = await screen.findByTestId('rte');
    expect(JSON.parse(editor.dataset.value)).toEqual(docOf('舊內文'));
    expect(editor.dataset.disabled).toBe('true');
  });

  test('文章欄位超過字數上限時顯示錯誤並不送出', async () => {
    setTopics([]);
    mockDoc = docOf('字'.repeat(50001));
    render(<FeaturedTopics />);
    fireEvent.click((await screen.findAllByRole('button', { name: /新增專題/ }))[0]);
    fireEvent.change(await screen.findByLabelText('標題'), { target: { value: '專題' } });
    fireEvent.click(screen.getByRole('button', { name: '模擬輸入內文' }));
    fireEvent.change(screen.getByLabelText('作者／來源'), { target: { value: '字'.repeat(31) } });
    fireEvent.change(screen.getByLabelText('圖說'), { target: { value: '字'.repeat(81) } });
    fireEvent.click(screen.getByRole('button', { name: /建立草稿/ }));
    expect(await screen.findByText('內文最多 50000 字')).toBeInTheDocument();
    expect(screen.getByText('作者／來源最多 30 字')).toBeInTheDocument();
    expect(screen.getByText('圖說最多 80 字')).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  test('建立成功但送審失敗：告知已存成草稿，不會重複建立', async () => {
    setTopics([]);
    apiPost.mockResolvedValueOnce(topic({ id: 9 })).mockRejectedValueOnce(new Error('已發布的專題已達 3 筆'));
    render(<FeaturedTopics />);
    fireEvent.click((await screen.findAllByRole('button', { name: /新增專題/ }))[0]);
    fireEvent.change(await screen.findByLabelText('標題'), { target: { value: '新專題' } });
    setTopics([topic({ id: 9, title: '新專題' })]);
    fireEvent.click(screen.getByRole('button', { name: /儲存並送審/ }));
    expect(await screen.findByText('已儲存為草稿，但送審失敗')).toBeInTheDocument();
    expect(apiPost).toHaveBeenCalledTimes(2);
  });

  test('欄位驗證：標題必填、排序 0 到 99；欄位旁顯示錯誤並不送出', async () => {
    render(<FeaturedTopics />);
    await open('族語學習路徑');
    fireEvent.change(await screen.findByLabelText('標題'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('排序'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: /儲存草稿/ }));
    expect(await screen.findByText('請填寫標題')).toBeInTheDocument();
    expect(screen.getByText('排序請填 0 到 99 的整數')).toBeInTheDocument();
    expect(screen.queryByLabelText('改連到其他網址')).toBeNull();
    expect(screen.getByLabelText('標題')).toHaveAttribute('aria-invalid', 'true');
    expect(apiPatch).not.toHaveBeenCalled();
  });

  test('草稿儲存用 PATCH，內容經過整理', async () => {
    apiPatch.mockResolvedValueOnce(topic({ title: '新名稱' }));
    render(<FeaturedTopics />);
    await open('族語學習路徑');
    fireEvent.change(await screen.findByLabelText('標題'), { target: { value: ' 新名稱 ' } });
    fireEvent.click(screen.getByRole('button', { name: /儲存草稿/ }));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith(
      '/adminapi/featured-topics/1/', expect.objectContaining({ title: '新名稱', sort_order: 0 }),
    ));
  });

  test('送審中：欄位唯讀，可撤回；owner 可核准或退件，退件必須填理由', async () => {
    setTopics([topic({ status: 'pending_review' })]);
    apiPost.mockResolvedValue(topic({ status: 'draft' }));
    render(<FeaturedTopics />);
    await open('族語學習路徑');
    expect(await screen.findByLabelText('標題')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '退件' }));
    expect(await screen.findByText(/退件必須填寫理由/)).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('審核意見'), { target: { value: '圖片需換' } });
    fireEvent.click(screen.getByRole('button', { name: '退件' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/adminapi/featured-topics/1/reject/', { review_comment: '圖片需換' }));
  });

  test('editor 送審中的專題只能撤回，不能核准', async () => {
    mockRole = 'editor';
    setTopics([topic({ status: 'pending_review' })]);
    render(<FeaturedTopics />);
    await open('族語學習路徑');
    expect(await screen.findByRole('button', { name: '撤回送審' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '核准並發布' })).not.toBeInTheDocument();
  });

  test('已發布滿 3 則時，核准與重新發布停用並說明要先下架', async () => {
    setTopics([
      topic({ id: 1, title: '待審一', status: 'pending_review' }),
      topic({ id: 2, title: '甲', status: 'published' }),
      topic({ id: 3, title: '乙', status: 'published' }),
      topic({ id: 4, title: '丙', status: 'published' }),
      topic({ id: 5, title: '已下架一', status: 'unpublished' }),
    ]);
    render(<FeaturedTopics />);
    await open('待審一');
    expect(await screen.findByRole('button', { name: '核准並發布' })).toBeDisabled();
    expect(screen.getByText(/核准前要先下架其中一則/)).toBeInTheDocument();
    await open('已下架一');
    expect(await screen.findByRole('button', { name: '重新發布' })).toBeDisabled();
  });

  test('核准被後端拒絕時顯示後端的原因', async () => {
    setTopics([topic({ status: 'pending_review' })]);
    apiPost.mockRejectedValueOnce(Object.assign(new Error('已發布的專題已達 3 筆上限，請先下架其中一筆：「甲」'), { status: 409 }));
    render(<FeaturedTopics />);
    await open('族語學習路徑');
    fireEvent.click(await screen.findByRole('button', { name: '核准並發布' }));
    expect(await screen.findByText(/請先下架其中一筆/)).toBeInTheDocument();
  });

  test('已發布的專題：修改走待審修改而不是直接 PATCH，並帶入既有的待審內容', async () => {
    setTopics([topic({ status: 'published', title: '公開中' })]);
    const base = apiGet.getMockImplementation();
    apiGet.mockImplementation(async (url) => (url.endsWith('/pending-revision/')
      ? { payload: { title: '待審標題' } } : base(url)));
    apiPost.mockResolvedValueOnce({});
    render(<FeaturedTopics />);
    await open('公開中');
    const title = await screen.findByLabelText('標題');
    await waitFor(() => expect(title).toHaveValue('待審標題'));
    expect(screen.getByText(/再次送出會覆蓋它/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /提交修改（待審核）/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/adminapi/featured-topics/1/pending-revision/', expect.objectContaining({ title: '待審標題' }),
    ));
    expect(apiPatch).not.toHaveBeenCalled();
  });

  test('已發布的專題可以下架', async () => {
    setTopics([topic({ status: 'published' })]);
    apiPost.mockResolvedValueOnce(topic({ status: 'unpublished' }));
    render(<FeaturedTopics />);
    await open('族語學習路徑');
    fireEvent.click(await screen.findByRole('button', { name: '下架' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/adminapi/featured-topics/1/unpublish/', undefined));
  });

  test('退件的專題顯示退件理由', async () => {
    setTopics([topic({ status: 'rejected', review_comment: '圖片太小' })]);
    render(<FeaturedTopics />);
    await open('族語學習路徑');
    expect(await screen.findByText(/退件理由：圖片太小/)).toBeInTheDocument();
  });

  test('刪除要先在頁面內確認；送審中與已發布的沒有刪除入口', async () => {
    apiDelete.mockResolvedValueOnce({ detail: '已刪除' });
    render(<FeaturedTopics />);
    await open('族語學習路徑');
    fireEvent.click(await screen.findByRole('button', { name: /刪除這則專題/ }));
    expect(apiDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /確定刪除/ }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/adminapi/featured-topics/1/'));
  });

  test('已發布的專題沒有刪除入口', async () => {
    setTopics([topic({ status: 'published' })]);
    render(<FeaturedTopics />);
    await open('族語學習路徑');
    await screen.findByRole('button', { name: '下架' });
    expect(screen.queryByRole('button', { name: /刪除這則專題/ })).not.toBeInTheDocument();
  });

  test('reviewer 只能檢視：欄位唯讀、沒有新增與任何動作按鈕', async () => {
    mockRole = 'reviewer';
    render(<FeaturedTopics />);
    expect(screen.queryByRole('button', { name: /新增專題/ })).not.toBeInTheDocument();
    await open('族語學習路徑');
    expect(await screen.findByLabelText('標題')).toBeDisabled();
    expect(screen.getByText(/擁有者、管理員與編輯可以修改/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /儲存草稿|儲存並送審|刪除這則專題/ })).not.toBeInTheDocument();
  });

  test('全頁欄位與說明 id 不重複', async () => {
    const { container } = render(<FeaturedTopics />);
    await open('族語學習路徑');
    await screen.findByLabelText('標題');
    const ids = [...container.querySelectorAll('[id]')].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('有未儲存的變更時切換專題要先確認；沒改動就不攔', async () => {
    setTopics([topic(), topic({ id: 2, title: '考試準備' })]);
    render(<FeaturedTopics />);
    await open('族語學習路徑');
    await screen.findByLabelText('標題');
    fireEvent.click(screen.getByRole('button', { name: /考試準備/ }));
    await waitFor(() => expect(screen.getByLabelText('標題')).toHaveValue('考試準備'));
    expect(screen.queryByText(/尚未儲存的變更/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('導言'), { target: { value: '寫到一半' } });
    fireEvent.click(screen.getByRole('button', { name: /族語學習路徑/ }));
    expect(await screen.findByText(/尚未儲存的變更/)).toBeInTheDocument();
    expect(screen.getByLabelText('導言')).toHaveValue('寫到一半');
    fireEvent.click(screen.getByRole('button', { name: '放棄變更並切換' }));
    await waitFor(() => expect(screen.getByLabelText('標題')).toHaveValue('族語學習路徑'));
  });

  test('狀態衝突（409）時保留後端原因、重新載入清單並提示頁面已更新', async () => {
    setTopics([topic({ status: 'published' })]);
    apiPost.mockRejectedValueOnce(Object.assign(new Error('目前狀態「unpublished」無法執行「edit」'), { status: 409 }));
    render(<FeaturedTopics />);
    await open('族語學習路徑');
    const loadsBefore = apiGet.mock.calls.filter(([url]) => url === '/adminapi/featured-topics/').length;
    setTopics([topic({ status: 'unpublished' })]);
    fireEvent.click(await screen.findByRole('button', { name: /提交修改（待審核）/ }));
    expect(await screen.findByText(/無法執行「edit」/)).toBeInTheDocument();
    await waitFor(() => expect(apiGet.mock.calls.filter(([url]) => url === '/adminapi/featured-topics/').length).toBeGreaterThan(loadsBefore));
    expect((await screen.findAllByText('已下架')).length).toBeGreaterThan(0);
  });

  test('刪除後焦點回到頁面標題', async () => {
    apiDelete.mockResolvedValueOnce({ detail: '已刪除' });
    render(<FeaturedTopics />);
    await open('族語學習路徑');
    fireEvent.click(await screen.findByRole('button', { name: /刪除這則專題/ }));
    fireEvent.click(screen.getByRole('button', { name: /確定刪除/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: '本期專題', level: 1 })).toHaveFocus());
    expect(await screen.findByText('已刪除')).toBeInTheDocument();
  });

  test('409 但專題狀態沒變（例如已發布滿 3 則）時，不重建編輯區、保留使用者填的審核意見', async () => {
    setTopics([topic({ status: 'pending_review' })]);
    apiPost.mockRejectedValueOnce(Object.assign(new Error('已發布的專題已達 3 筆上限'), { status: 409 }));
    render(<FeaturedTopics />);
    await open('族語學習路徑');
    fireEvent.change(await screen.findByLabelText('審核意見'), { target: { value: '先寫好的意見' } });
    fireEvent.click(screen.getByRole('button', { name: '核准並發布' }));
    expect(await screen.findByText(/已達 3 筆上限/)).toBeInTheDocument();
    expect(screen.getByLabelText('審核意見')).toHaveValue('先寫好的意見');
  });

  test('刪除有未儲存變更的專題時，確認文案明講會一併遺失', async () => {
    render(<FeaturedTopics />);
    await open('族語學習路徑');
    fireEvent.change(await screen.findByLabelText('導言'), { target: { value: '寫了一半' } });
    fireEvent.click(screen.getByRole('button', { name: /刪除這則專題/ }));
    expect(screen.getByText(/未儲存的變更，刪除後會一併遺失/)).toBeInTheDocument();
  });
});
