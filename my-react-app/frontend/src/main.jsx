import { StrictMode } from 'react'
import 'bootstrap/dist/css/bootstrap.min.css'
import '../static/css/default/html-reset.css'
import '../static/css/default/tailwind.css'
import '../static/css/default/theme-v2.css'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom';
import AppShell from './AppShell'
import StartupError from './StartupError'
import { AuthProvider } from "./userServives/authContext";
import { firebaseInitError } from '../../firebase'
import { initTheme } from './theme/themeStore'

// 套用儲存的主題偏好（index.html 的小腳本通常已經設好，這裡是保險）
initTheme()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {firebaseInitError ? (
      <StartupError />
    ) : (
      <BrowserRouter>
        <AuthProvider>
          <AppShell />
        </AuthProvider>
      </BrowserRouter>
    )}
  </StrictMode>
)
