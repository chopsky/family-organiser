import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { configure as configureRevenueCat } from './lib/revenuecat.js'
import { initAnalytics } from './lib/analytics.js'
import { setupNativeShell } from './lib/native-shell.js'

// Initialise RevenueCat (no-op on web/Android — see lib/revenuecat.js).
// Fire-and-forget: the SDK buffers logIn / getOfferings calls until
// configure resolves, so we don't need to await this before rendering.
configureRevenueCat();

// Wire the small native-feel plugins (status bar, splash, keyboard).
// No-op on web. See lib/native-shell.js.
setupNativeShell();

// Re-attach Google Analytics if the user previously accepted the cookie
// banner. No-op for new visitors and for anyone who declined; the banner
// (mounted in App.jsx) handles the first-time consent flow.
initAnalytics();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
