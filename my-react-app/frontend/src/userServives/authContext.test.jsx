import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AuthProvider, useAuth } from './authContext';

let emitAuth;
vi.mock('./userServive', () => ({
  authChanges: (callback) => {
    emitAuth = callback;
    return () => {};
  },
}));

function Probe() {
  const { userData, updateUserData } = useAuth();
  return (
    <div>
      <span data-testid="name">{userData?.firestoreData?.name ?? 'none'}</span>
      <button onClick={() => updateUserData({ uid: 'u1', firestoreData: { name: '小明' }, role: null })}>補上資料</button>
    </div>
  );
}

describe('AuthProvider 註冊後的資料保護', () => {
  beforeEach(() => { emitAuth = null; });

  test('註冊表單補上完整資料後，較晚才回來的「沒有資料」登入事件不會把它蓋回空的', () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    act(() => { emitAuth({ uid: 'u1', firestoreData: null, role: null }); });
    act(() => { screen.getByText('補上資料').click(); });
    expect(screen.getByTestId('name')).toHaveTextContent('小明');

    act(() => { emitAuth({ uid: 'u1', firestoreData: null, role: null }); });
    expect(screen.getByTestId('name')).toHaveTextContent('小明');
  });

  test('換成別的帳號、或登出時，照常以新的狀態為準', () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    act(() => { emitAuth({ uid: 'u1', firestoreData: { name: '小明' }, role: null }); });
    act(() => { emitAuth({ uid: 'u2', firestoreData: null, role: null }); });
    expect(screen.getByTestId('name')).toHaveTextContent('none');
    act(() => { emitAuth(null); });
    expect(screen.getByTestId('name')).toHaveTextContent('none');
  });
});

function StateProbe() {
  const { userData, loading } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="name">{userData?.firestoreData?.name ?? 'none'}</span>
      <span data-testid="role">{userData?.role ?? 'none'}</span>
    </div>
  );
}

describe('AuthProvider 的更新函式與降級資料（FE1-03／FE1-15）', () => {
  beforeEach(() => { emitAuth = null; });

  test('authChanges 傳來 (prev) => next 時套在目前狀態上，而且不會讓 loading 提早結束', () => {
    render(<AuthProvider><StateProbe /></AuthProvider>);
    act(() => { emitAuth((prev) => prev); });               // 登入事件之前的角色更新
    expect(screen.getByTestId('loading')).toHaveTextContent('true');

    act(() => { emitAuth({ uid: 'u1', firestoreData: { name: '小明' }, role: null }); });
    act(() => { emitAuth((prev) => ({ ...prev, role: 'admin' })); });
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(screen.getByTestId('name')).toHaveTextContent('小明');
    expect(screen.getByTestId('role')).toHaveTextContent('admin');
  });

  test('讀取失敗的降級資料不會蓋掉同一位使用者已有的完整資料，但角色照樣更新', () => {
    render(<AuthProvider><StateProbe /></AuthProvider>);
    act(() => { emitAuth({ uid: 'u1', firestoreData: { name: '小明' }, role: null }); });
    act(() => { emitAuth({ uid: 'u1', firestoreData: { name: 'tali', profileUnavailable: true }, role: 'staff' }); });
    expect(screen.getByTestId('name')).toHaveTextContent('小明');
    expect(screen.getByTestId('role')).toHaveTextContent('staff');
  });

  test('沒有既有資料時，降級資料照常進來（導覽列以此判斷已登入、顯示登出入口）', () => {
    render(<AuthProvider><StateProbe /></AuthProvider>);
    act(() => { emitAuth({ uid: 'u1', firestoreData: { name: 'tali', profileUnavailable: true }, role: null }); });
    expect(screen.getByTestId('name')).toHaveTextContent('tali');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });
});
