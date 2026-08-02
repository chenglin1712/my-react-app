import { useLocation } from 'react-router-dom';
import Route from './route';
import Navbar from '../components/navigation/navbar';
import Footer from '../components/ui/Footer';

// /admin/* 是獨立的全螢幕後台介面，AdminLayout 自己就有一整套側邊欄／頂欄
// （見 frontend/src/_admin/layout/AdminLayout.jsx），疊在前台的 Navbar／
// Footer 底下只會變成兩層 header 疊在一起、後台可用高度被前台導覽列吃掉。
export default function AppShell() {
  const { pathname } = useLocation();
  const isAdmin = pathname.startsWith('/admin');

  if (isAdmin) return <Route />;

  return (
    <>
      {/* 全站沒有 skip-link 也沒有 <main> landmark，螢幕報讀器／鍵盤使用者每次
          換頁都得從頭一路跳過整個 Navbar 才能到內容。visually-hidden-focusable
          是 Bootstrap（已載入）內建的 skip-link 樣式：預設隱藏，取得鍵盤焦點時
          才顯示，不用自己另外寫 CSS。 */}
      <a href="#main-content" className="visually-hidden-focusable">跳到主要內容</a>
      <Navbar />
      <main id="main-content">
        <Route />
      </main>
      <Footer />
    </>
  );
}
