import './firebaseApi.js' // <--- השורה הזו מחברת את כל האפליקציה ישירות ל-Firestore!
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)