import { StrictMode } from 'react'
import 'bootstrap/dist/css/bootstrap.min.css'
import '../static/css/default/html-reset.css'
import '../static/css/default/tailwind.css'
import '../static/css/default/theme-v2.css'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import StartupError from './StartupError'
import { appRoutes } from './appRoutes'
import { firebaseInitError } from '../../firebase'
import { initTheme } from './theme/themeStore'
import { registerServiceWorker } from './registerServiceWorker'

// 套用儲存的主題偏好（index.html 的小腳本通常已經設好，這裡是保險）
initTheme()
registerServiceWorker()

// data router 一建立就開始監聽瀏覽器歷史；Firebase 初始化失敗時整個 App 不會掛上去，也就不必建立
const router = firebaseInitError ? null : createBrowserRouter(appRoutes)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {firebaseInitError ? (
      <StartupError />
    ) : (
      <RouterProvider router={router} />
    )}
  </StrictMode>
)
