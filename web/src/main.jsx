import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { configure as configureRevenueCat } from './lib/revenuecat.js'

// Initialise RevenueCat (no-op on web/Android — see lib/revenuecat.js).
// Fire-and-forget: the SDK buffers logIn / getOfferings calls until
// configure resolves, so we don't need to await this before rendering.
configureRevenueCat();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
