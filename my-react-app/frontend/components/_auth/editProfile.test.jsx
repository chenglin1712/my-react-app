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

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: fakeUserData }),
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

  test('updateProfile 回傳 success: false 時顯示錯誤訊息，且不會卡住無法重試', async () => {
    updateProfile.mockResolvedValueOnce({ success: false, message: '沒有更新的資料' });
    render(<EditProfile />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /儲存變更/ }));
    });

    expect(screen.getByText('失敗: 沒有更新的資料')).toBeInTheDocument();
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

    expect(screen.getByText('更新失敗')).toBeInTheDocument();
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
    // 原本用可點擊 div + ref.click() 觸發隱藏 input，鍵盤使用者完全無法操作。
    // 改用 <label htmlFor> 關聯輸入框（input 用 visually-hidden 而非
    // display:none，Tab 才到得了），瀏覽器原生就會處理點擊與鍵盤觸發，
    // 這裡驗證兩者的關聯是否正確，而不是重現瀏覽器原生的委派行為。
    const { container } = render(<EditProfile />);
    const label = container.querySelector('label.avatar-uploader');
    const input = screen.getByLabelText('變更圖片');

    expect(label).toHaveAttribute('for', input.id);
  });
});
