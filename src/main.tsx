import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* householdMemberCount={1..6} — more people = narrower columns; 2 keeps the wide center gap. */}
    <App />
  </StrictMode>,
)
