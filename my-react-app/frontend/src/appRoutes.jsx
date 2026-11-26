import AppShell from './AppShell';
import ErrorBoundary from './errorBoundary';
import { AuthProvider } from './userServives/authContext';

/**
 * 整個前台／後台共用的 data router 路由表（main.jsx 用 createBrowserRouter 建立）。
 *
 * 為什麼是 data router：react-router 的 useBlocker（站內換頁、上一頁的未儲存攔截，見
 * _admin/hooks/useUnsavedChangesGuard.js）只能在 data router 底下用，BrowserRouter 不支援。
 *
 * 為什麼只有一條 path: '*'：實際的路由仍然寫在 route.jsx（<Routes>）與後台 AdminApp 的巢狀
 * <Routes> 裡，這裡只是把原本 <BrowserRouter> 內的整棵元件樹搬成 data router 的根元件，
 * 不必把上百條路由改寫成物件，風險與差異都降到最小。巢狀 <Routes> 需要父路由以 * 結尾才能
 * 繼續比對剩下的網址，所以根路由必須是 '*'。
 *
 * Provider 順序與原本 main.jsx 相同（AuthProvider 包住 AppShell）。最外層的 ErrorBoundary 是因為
 * data router 的根路由一定會有一個 error boundary：沒有指定時，AppShell 裡沒被內層 boundary
 * 接住的錯誤會顯示 react-router 內建的英文錯誤頁；改用站內既有的錯誤畫面（原本這種錯誤是整頁白屏）。
 */
export const appRoutes = [
    {
        path: '*',
        element: (
            <ErrorBoundary>
                <AuthProvider>
                    <AppShell />
                </AuthProvider>
            </ErrorBoundary>
        ),
    },
];
