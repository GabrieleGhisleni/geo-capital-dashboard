import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/fraunces'
import '@fontsource-variable/manrope'
import '../index.css'
import './daylight.css'
import { DaylightApp } from './DaylightApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DaylightApp />
  </StrictMode>,
)
