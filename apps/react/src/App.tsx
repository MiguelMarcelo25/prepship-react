import { StoresProvider } from './contexts/StoresContext'
import { MarkupsProvider } from './contexts/MarkupsContext'
import { ToastProvider } from './contexts/ToastContext'
import { StoreVisibilityProvider } from './contexts/StoreVisibilityContext'
import Home from './Home'
import './App.css'

export default function App() {
  return (
    <ToastProvider>
      <StoresProvider>
        <MarkupsProvider>
          <StoreVisibilityProvider>
            <Home />
          </StoreVisibilityProvider>
        </MarkupsProvider>
      </StoresProvider>
    </ToastProvider>
  )
}
