import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { updateProfile } from '../../src/userServives/userServive';
import { useAuth } from '../../src/userServives/authContext';
import EditProfile from './editProfile';

const mockNavigate = vi.fn();
const fakeUserData = {
  uid: 'user-1',
  firestoreData: {
    name: '小明',
    email: 'a@b.com',
    identity: '學生',
    joinDate: '2026-01-01T00:00:00.000Z',
    avatarUrl: null,
  },
};

// 稽核 FE1-07：location.state 改成可變，才能測直接開 /edit（state 為 null）的情況
const locationState = vi.hoisted(() => ({ current: null }));
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: locationState.current }),
  Link: ({ to, children }) => <a href={to}>{children}</a>,
}));
vi.mock('../../src/userServives/userServive', () => ({
  updateProfile: vi.fn(),
}));
vi.mock('../../src/userServives/authContext', () => ({
  useAuth: vi.fn(),
}));

// role 是 AuthContext.userData 裡跟這個表單完全無關的既有欄位，用來驗證
// 存檔後不會被 updateProfile() 的回傳值（沒有 role 欄位）整包覆蓋掉。
const authUserData = { uid: 'user-1', role: 'admin', firestoreData: fakeUserData.firestoreData };

describe('EditProfile (editProfile)', () => {
  const updateUserData = vi.fn();

  beforeEach(() => {
    mockNavigate.mockReset();
    updateProfile.mockReset();
    updateUserData.mockReset();
    useAuth.mockReturnValue({ userData: authUserData, updateUserData });
    locationState.current = fakeUserData;
    vi.stubGlobal('fetch', vi.fn());
  });

  test('表單以傳入的使用者資料預先填入', () => {
    render(<EditProfile />);
    expect(screen.getByLabelText('姓名')).toHaveValue('小明');
    expect(screen.getByLabelText('信箱')).toHaveValue('a@b.com');
    expect(screen.getByLabelText('信箱')).toBeDisabled();
  });

  test('修改姓名後儲存，呼叫 updateProfile 並帶上更新後的表單資料', async () => {
    updateProfile.mockResolvedValueOnce({ success: true, firestoreData: { ...fakeUserData.firestoreData, name: '小華' }, uid: 'user-1' });
    render(<EditProfile />);

    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '小華' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /儲存變更/ }));
    });

    expect(updateProfile).toHaveBeenCalledWith('user-1', expect.objectContaining({ name: '小華' }));
  });

  test('儲存成功後會同步 AuthContext 的 firestoreData，並保留 role 等既有欄位，然後導向首頁', async () => {
    // 回歸測試：updateProfile() 的回傳值是 {success, firestoreData, uid}，沒有
    // role——原本直接把這包整包丟給 updateUserData()（整包覆蓋，不是合併），
    // 存檔後 AuthContext 的 role 會被清空。現在應該只換掉 firestoreData。
    const result = { success: true, firestoreData: { ...fakeUserData.firestoreData, name: '小華' }, uid: 'user-1' };
    updateProfile.mockResolvedValueOnce(result);
    render(<EditProfile />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /儲存變更/ }));
    });

    expect(updateUserData).toHaveBeenCalledWith({
      uid: 'user-1',
      role: 'admin',
      firestoreData: result.firestoreData,
    });
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  test('後端訊息結尾已有標點時，不會變成「。，」', async () => {
    updateProfile.mockResolvedValueOnce({ success: false, message: '資料格式錯誤。' });
    render(<EditProfile />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /儲存變更/ }));
    });
    expect(screen.getByText('資料格式錯誤，請修改後再試一次。')).toBeInTheDocument();
  });

  test('updateProfile 回傳 success: false 時顯示錯誤訊息，且不會卡住無法重試', async () => {
    updateProfile.mockResolvedValueOnce({ success: false, message: '沒有更新的資料' });
    render(<EditProfile />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /儲存變更/ }));
    });

    expect(screen.getByText('沒有更新的資料，請修改後再試一次。')).toBeInTheDocument();
    expect(updateUserData).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /儲存變更/ })).not.toBeDisabled();
  });

  test('updateProfile 拋出例外時顯示通用錯誤訊息，不會卡住', async () => {
    updateProfile.mockRejectedValueOnce(new Error('network down'));
    render(<EditProfile />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /儲存變更/ }));
    });

    expect(screen.getByText('更新失敗，請檢查網路後再試一次。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /儲存變更/ })).not.toBeDisabled();
  });

  test('上傳圖片超過 5MB 時顯示錯誤，不會呼叫上傳 API', () => {
    render(<EditProfile />);
    const bigFile = new File(['x'.repeat(10)], 'big.png', { type: 'image/png' });
    Object.defineProperty(bigFile, 'size', { value: 6 * 1024 * 1024 });

    fireEvent.change(screen.getByLabelText('變更圖片'), { target: { files: [bigFile] } });

    expect(screen.getByText('圖片不得超過 5 MB，請重新選擇。')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('大頭貼區塊是關聯到隱藏檔案輸入框的 label，滑鼠與鍵盤都能觸發', () => {
    // 原本用可點選 div + ref.click() 觸發隱藏 input，鍵盤使用者完全無法操作。
    // 改用 <label htmlFor> 關聯輸入框（input 用 visually-hidden 而非
    // display:none，Tab 才到得了），瀏覽器原生就會處理點選與鍵盤觸發，
    // 這裡驗證兩者的關聯是否正確，而不是重現瀏覽器原生的委派行為。
    const { container } = render(<EditProfile />);
    const label = container.querySelector('label.avatar-uploader');
    const input = screen.getByLabelText('變更圖片');

    expect(label).toHaveAttribute('for', input.id);
  });
});

describe('EditProfile：直接開 /edit（稽核 FE1-07）', () => {
  const updateUserData = vi.fn();
  beforeEach(() => {
    locationState.current = null; // 書籤、重新輸入網址、新分頁：沒有 location.state
    vi.stubGlobal('fetch', vi.fn());
  });

  test('沒有 location.state 時改用 AuthContext 的資料，不會崩潰', () => {
    useAuth.mockReturnValue({ userData: authUserData, updateUserData, loading: false });
    render(<EditProfile />);
    expect(screen.getByLabelText('姓名')).toHaveValue('小明');
  });

  test('AuthContext 的資料比 location.state 新時以 AuthContext 為準', () => {
    locationState.current = { uid: 'user-1', firestoreData: { ...fakeUserData.firestoreData, name: '舊名字' } };
    useAuth.mockReturnValue({ userData: authUserData, updateUserData, loading: false });
    render(<EditProfile />);
    expect(screen.getByLabelText('姓名')).toHaveValue('小明');
  });

  test('登入狀態還在確認中：顯示載入狀態而不是表單', () => {
    useAuth.mockReturnValue({ userData: null, updateUserData, loading: true });
    render(<EditProfile />);
    expect(screen.getByRole('status')).toHaveTextContent('正在載入個人資料…');
    expect(screen.queryByLabelText('姓名')).not.toBeInTheDocument();
  });

  test('已登入但讀不到個人資料（firestoreData 缺漏）：顯示說明', () => {
    useAuth.mockReturnValue({ userData: { uid: 'user-1', firestoreData: null }, updateUserData, loading: false });
    render(<EditProfile />);
    expect(screen.getByText(/目前讀不到你的個人資料/)).toBeInTheDocument();
    expect(screen.queryByLabelText('姓名')).not.toBeInTheDocument();
  });
});

describe('EditProfile：降級資料不能拿來編輯（稽核 FE1-03）', () => {
  const updateUserData = vi.fn();
  const degraded = {
    uid: 'user-1',
    role: 'admin',
    firestoreData: { name: 'a', email: 'a@b.com', identity: '', avatarUrl: null, favorites: [], profileUnavailable: true },
  };
  beforeEach(() => {
    updateProfile.mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  test('AuthContext 是降級資料時不顯示表單（就算 location.state 有舊資料），背景重讀成功後才顯示', () => {
    locationState.current = { ...degraded };
    useAuth.mockReturnValue({ userData: degraded, updateUserData, loading: false });
    const view = render(<EditProfile />);
    expect(screen.getByText(/目前讀不到你的個人資料，系統會自動重試/)).toBeInTheDocument();
    expect(screen.queryByLabelText('姓名')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /儲存變更/ })).not.toBeInTheDocument();

    useAuth.mockReturnValue({ userData: authUserData, updateUserData, loading: false });
    view.rerender(<EditProfile />);
    expect(screen.getByLabelText('姓名')).toHaveValue('小明');
    expect(screen.getByLabelText('身分')).toHaveValue('學生');
  });

  test('側欄帶來的 location.state 是降級資料、AuthContext 還沒有資料：也不顯示表單', () => {
    locationState.current = degraded;
    useAuth.mockReturnValue({ userData: null, updateUserData, loading: false });
    render(<EditProfile />);
    expect(screen.queryByLabelText('姓名')).not.toBeInTheDocument();
  });
});

describe('EditProfile：儲存防呆（稽核 FE1-18）', () => {
  const updateUserData = vi.fn();
  beforeEach(() => {
    mockNavigate.mockReset();
    updateProfile.mockReset();
    useAuth.mockReturnValue({ userData: authUserData, updateUserData });
    locationState.current = fakeUserData;
    vi.stubGlobal('fetch', vi.fn());
    if (!URL.createObjectURL) URL.createObjectURL = () => 'blob:preview';
    if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {};
  });

  test('姓名只有空白時不送出，欄位顯示錯誤並取得焦點', async () => {
    render(<EditProfile />);
    const nameInput = screen.getByLabelText('姓名');
    fireEvent.change(nameInput, { target: { value: '   ' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /儲存變更/ }));
    });
    expect(updateProfile).not.toHaveBeenCalled();
    expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    expect(nameInput).toHaveAccessibleDescription('請輸入姓名');
    expect(nameInput).toHaveFocus();

    fireEvent.change(nameInput, { target: { value: '小華' } });
    expect(nameInput).not.toHaveAttribute('aria-invalid');
  });

  test('姓名前後空白會去掉再儲存', async () => {
    updateProfile.mockResolvedValueOnce({ success: true, firestoreData: fakeUserData.firestoreData, uid: 'user-1' });
    render(<EditProfile />);
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '  小華  ' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /儲存變更/ }));
    });
    expect(updateProfile).toHaveBeenCalledWith('user-1', expect.objectContaining({ name: '小華' }));
  });

  test('儲存中連按只送出一次，按鈕停用並顯示「儲存中…」', async () => {
    let resolveSave;
    updateProfile.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
    render(<EditProfile />);
    const button = screen.getByRole('button', { name: /儲存變更/ });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(updateProfile).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('儲存中…');
    await act(async () => { resolveSave({ success: false, message: '沒有更新的資料' }); });
    expect(button).not.toBeDisabled();
  });

  test('頭像上傳中不能儲存（避免存到舊頭像網址、上傳結果被丟掉）', async () => {
    fetch.mockImplementation(() => new Promise(() => {})); // 上傳一直沒回來
    render(<EditProfile />);
    const file = new File(['x'], 'ok.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('變更圖片'), { target: { files: [file] } });
    });
    const button = screen.getByRole('button', { name: /頭像上傳中/ });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(updateProfile).not.toHaveBeenCalled();
  });
});
