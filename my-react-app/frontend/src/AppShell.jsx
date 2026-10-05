import { useState, lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import AppRoutes from './route';
import Navbar from '../components/navigation/navbar';
import Footer from '../components/ui/Footer';

import ErrorBoundary from './errorBoundary';

const OverlayAdvice = lazy(() => import('../components/_quiz/bot'));

const BOT_ERROR_STYLE = {
  position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)',
  zIndex: 1100, padding: '12px 16px', background: '#fff', border: '3px solid #221812',
  borderRadius: 10, boxShadow: '4px 4px 0 #221812',
};

// /admin/* 是獨立的全螢幕後台介面，AdminLayout 自己就有一整套側邊欄／頂欄
// （見 frontend/src/_admin/layout/AdminLayout.jsx），疊在前台的 Navbar／
// Footer 底下只會變成兩層 header 疊在一起、後台可用高度被前台導覽列吃掉。
export default function AppShell() {
  const { pathname } = useLocation();
  const isAdmin = pathname.startsWith('/admin');
  const [isBotOpen, setIsBotOpen] = useState(false);

  if (isAdmin) return <AppRoutes />;

  return (
    <>
      {/* 全站沒有 skip-link 也沒有 <main> landmark，螢幕報讀器／鍵盤使用者每次
          換頁都得從頭一路跳過整個 Navbar 才能到內容。visually-hidden-focusable
          是 Bootstrap（已載入）內建的 skip-link 樣式：預設隱藏，取得鍵盤焦點時
          才顯示，不用自己另外寫 CSS。 */}
      <a href="#main-content" className="visually-hidden-focusable">跳到主要內容</a>
      <Navbar onOpenBot={() => setIsBotOpen(true)} />
      <main id="main-content">
        <AppRoutes />
      </main>
      <Footer />
      {/* AI 助手 overlay 原本由 UserSidebar（導覽層的基礎元件）直接 lazy import
          _quiz/bot 並自己管理開關狀態——基礎共用層反過來依賴一個功能模組，
          方向是反的。所有權移到這裡：Navbar／UserSidebar 只呼叫 onOpenBot()。 */}
      {/* overlay 是 AppRoutes 的兄弟節點，route.jsx 的 ErrorBoundary 包不到它：
          lazy chunk 載入失敗或 bot 內 render 丟例外時會一路冒到 root 變白屏。
          這裡獨立包一層，出錯時只關掉助手並提示，不影響底下的頁面。 */}
      <ErrorBoundary
        resetKeys={[isBotOpen]}
        fallback={({ reset }) => (
          <div className="bot-error-toast" role="alert" style={BOT_ERROR_STYLE}>
            AI 助手暫時無法使用，請稍後再試。
            <button
              type="button"
              onClick={() => { reset(); setIsBotOpen(false); }}
              style={{ marginLeft: 12 }}
            >
              關閉
            </button>
          </div>
        )}
      >
        <Suspense fallback={null}>
          <AnimatePresence>
            {isBotOpen && <OverlayAdvice onClose={() => setIsBotOpen(false)} />}
          </AnimatePresence>
        </Suspense>
      </ErrorBoundary>
    </>
  );
}
