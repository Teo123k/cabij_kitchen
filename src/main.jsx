import React from 'react'
import ReactDOM from 'react-dom/client'
const App = React.lazy(() => import('./App.jsx'));
const OperationsEntry = React.lazy(() => import('./operations/OperationsEntry.jsx'));
const requestedWorkspace = new URLSearchParams(window.location.search).get('workspace');
const projectWorkspace = requestedWorkspace === 'projects' || (!requestedWorkspace && import.meta.env.VITE_DEFAULT_WORKSPACE === 'projects');
import './index.css'
import { BrowserRouter } from 'react-router-dom'
import { SettingsProvider } from './SettingsContext'
import { initDB } from './core/persistence'
import ErrorBoundary from './components/ErrorBoundary'

const renderBootFallback = (error) => {
    const root = document.getElementById('root');
    if (!root) return;
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error || 'Unknown startup error');
    root.innerHTML = `
        <div style="min-height:100vh;background:#0a0a0a;color:#fff;padding:40px;display:flex;align-items:center;justify-content:center;font-family:Inter,system-ui,sans-serif;">
            <div style="width:min(760px,100%);border:1px solid rgba(255,255,255,.08);background:#111;padding:32px;border-radius:24px;box-shadow:0 24px 80px rgba(0,0,0,.45);">
                <div style="font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:#d4af37;font-weight:800;margin-bottom:16px;">Boot Recovery</div>
                <h1 style="margin:0 0 16px;font-size:28px;line-height:1.1;font-weight:900;text-transform:uppercase;">Cabij app could not start cleanly</h1>
                <p style="margin:0 0 20px;color:rgba(255,255,255,.72);font-size:14px;line-height:1.7;">
                    We caught a startup error before the main app mounted. This usually means a browser cache, storage, or bootstrap issue instead of a normal in-app crash.
                </p>
                <div style="padding:16px;border-radius:16px;background:#000;border:1px solid rgba(255,255,255,.08);font-family:ui-monospace, SFMono-Regular, Menlo, monospace;font-size:12px;word-break:break-word;color:#ff7a7a;">
                    ${message}
                </div>
                <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:24px;">
                    <button id="cabij-hard-reload" style="padding:14px 18px;border:none;border-radius:12px;background:#d4af37;color:#111;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.16em;cursor:pointer;">Hard reload</button>
                    <button id="cabij-reset-browser-state" style="padding:14px 18px;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:#181818;color:#fff;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.16em;cursor:pointer;">Clear local browser state</button>
                </div>
            </div>
        </div>
    `;
    document.getElementById('cabij-hard-reload')?.addEventListener('click', () => window.location.reload());
    document.getElementById('cabij-reset-browser-state')?.addEventListener('click', async () => {
        try {
            localStorage.clear();
            sessionStorage.clear();
            if ('serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                await Promise.all(registrations.map((registration) => registration.unregister()));
            }
            if ('caches' in window) {
                const keys = await caches.keys();
                await Promise.all(keys.map((key) => caches.delete(key)));
            }
        } catch (cleanupError) {
            console.error('CABIJ_BOOT_RECOVERY_CLEANUP_FAILED', cleanupError);
        }
        window.location.reload();
    });
};

const ENABLE_PROD_SW = import.meta.env.VITE_ENABLE_SW === 'true';

// Initialize Local Persistence
initDB().catch((error) => {
    console.error('CABIJ_DB_BOOTSTRAP_FAILED', error);
});

const clearDevServiceWorkerState = async () => {
    if (!import.meta.env.DEV || !('serviceWorker' in navigator)) return false;

    const registrations = await navigator.serviceWorker.getRegistrations();
    const cacheKeys = await caches.keys();

    await Promise.all([
        ...registrations.map((registration) => registration.unregister()),
        ...cacheKeys.map((key) => caches.delete(key))
    ]);

    return registrations.length > 0 || cacheKeys.length > 0;
};

if (import.meta.env.DEV) {
    clearDevServiceWorkerState()
        .then((didClear) => {
            if (didClear && !sessionStorage.getItem('cabij-dev-sw-cleared')) {
                sessionStorage.setItem('cabij-dev-sw-cleared', '1');
            }
        })
        .catch((err) => {
            console.log('Dev Service Worker cleanup failed', err);
        });
}

// Register Service Worker (opt-in only). During active product work, stale SW caches are a common blank-screen cause.
if (import.meta.env.PROD && 'serviceWorker' in navigator && ENABLE_PROD_SW) {
    window.addEventListener('load', async () => {
        try {
            const registration = await navigator.serviceWorker.register('/service-worker.js');
            console.log('Service Worker: Registered successfully', registration);

            // Ask the browser to check for a newer SW on each load.
            registration.update().catch(() => {});

            const promoteUpdate = (waitingWorker) => {
                if (!waitingWorker) return;
                waitingWorker.postMessage({ type: 'SKIP_WAITING' });
            };

            if (registration.waiting) promoteUpdate(registration.waiting);

            registration.addEventListener('updatefound', () => {
                const installing = registration.installing;
                if (!installing) return;
                installing.addEventListener('statechange', () => {
                    if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                        promoteUpdate(registration.waiting);
                    }
                });
            });

            let refreshing = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (refreshing) return;
                refreshing = true;
                window.location.reload();
            });
        } catch (err) {
            console.log('Service Worker: Registration failed', err);
        }
    });
} else if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        try {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map((registration) => registration.unregister()));
        } catch (error) {
            console.log('Service Worker: cleanup skipped', error);
        }
    });
}

try {
    ReactDOM.createRoot(document.getElementById('root')).render(
        <React.StrictMode>
            <ErrorBoundary>
                <BrowserRouter>
                    <SettingsProvider>
                        <React.Suspense fallback={<p>Opening CABIJ…</p>}>{projectWorkspace ? <OperationsEntry /> : <App />}</React.Suspense>
                    </SettingsProvider>
                </BrowserRouter>
            </ErrorBoundary>
        </React.StrictMode>,
    )
} catch (error) {
    console.error('CABIJ_BOOTSTRAP_FATAL', error);
    renderBootFallback(error);
}
