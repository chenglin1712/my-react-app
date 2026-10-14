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
