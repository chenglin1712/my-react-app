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
}));
vi.mock('../../src/userServives/userServive', () => ({
  updateProfile: vi.fn(),
}));
vi.mock('../../src/userServives/authContext', () => ({
  useAuth: vi.fn(),
}));

describe('EditProfile (editProfile)', () => {
  const updateUserData = vi.fn();

  beforeEach(() => {
    mockNavigate.mockReset();
    updateProfile.mockReset();
    updateUserData.mockReset();
    useAuth.mockReturnValue({ updateUserData });
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

  test('儲存成功後會同步 AuthContext 並導向首頁', async () => {
    const result = { success: true, firestoreData: fakeUserData.firestoreData, uid: 'user-1' };
    updateProfile.mockResolvedValueOnce(result);
    render(<EditProfile />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /儲存變更/ }));
    });

    expect(updateUserData).toHaveBeenCalledWith(result);
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

  test('點擊頭像會觸發隱藏的檔案輸入框', () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const { container } = render(<EditProfile />);

    fireEvent.click(container.querySelector('.avatar-uploader'));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });
});
