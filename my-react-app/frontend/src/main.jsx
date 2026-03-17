import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom';
import Route from './route'
import Navbar from '../components/navigation/navbar';
import { AuthProvider } from "./userServives/authContext";


createRoot(document.getElementById('root')).render(
  //<StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Navbar />
        <Route />
      </AuthProvider>
    </BrowserRouter>
  //</StrictMode>
)
