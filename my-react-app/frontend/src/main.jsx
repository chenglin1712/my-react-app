import { StrictMode } from 'react'
import 'bootstrap/dist/css/bootstrap.min.css'
import '../static/css/default/html-reset.css'
import '../static/css/default/tailwind.css'
import '../static/css/default/theme-v2.css'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom';
import Route from './route'
import Navbar from '../components/navigation/navbar';
import Footer from '../components/ui/Footer';
import { AuthProvider } from "./userServives/authContext";


createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
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
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
)
