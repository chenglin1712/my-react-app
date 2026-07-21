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
        <Navbar />
        <Route />
        <Footer />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
)
