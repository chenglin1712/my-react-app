import { StrictMode } from 'react'
import 'bootstrap/dist/css/bootstrap.min.css'
import '../static/css/default/html-reset.css'
import '../static/css/default/tailwind.css'
import '../static/css/default/theme-v2.css'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom';
import AppShell from './AppShell'
import { AuthProvider } from "./userServives/authContext";

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
)
