import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth, UserRole } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import UnauthorizedPage from './pages/UnauthorizedPage';
import { getOutboxItems, removeOutboxItem, updateOutboxItem, OutboxItem } from './lib/db';
import { WifiOff, BellRing, CloudUpload, AlertTriangle } from 'lucide-react';
import { apiFetch } from './lib/apiFetch';
import { ToastProvider } from './components/Toast';
import { ModalStackProvider, useModalRegistration } from './components/ModalStackProvider';
import { emitWorkReportOutboxEvent } from './lib/events';

const PUSH_PROMPT_DISMISSED_AT_KEY = 'app.pushPromptDismissedAt';
const PUSH_PROMPT_DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
const DispatcherPage = lazy(() => import('./pages/DispatcherPage'));
const TechnicianPage = lazy(() => import('./pages/TechnicianPage'));
const SignPage = lazy(() => import('./pages/SignPage'));
const CustomersPage = lazy(() => import('./pages/CustomersPage'));
const TeamsPage = lazy(() => import('./pages/TeamsPage'));
const StatsPage = lazy(() => import('./pages/StatsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

type AllowedRole = Exclude<UserRole, null>;

function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode, allowedRoles: AllowedRole[] }) {
  const { activeRole } = useAuth();
  if (!activeRole) return <Navigate to="/login" />;

  if (allowedRoles.includes(activeRole)) return <>{children}</>;

  if (activeRole === 'TECHNICIAN' && !allowedRoles.includes('TECHNICIAN')) {
    return <Navigate to="/technician" />;
  }

  if ((activeRole === 'ADMIN' || activeRole === 'DISPATCHER') && allowedRoles.includes('TECHNICIAN')) {
    return <Navigate to="/dispatcher" />;
  }

  return <UnauthorizedPage />;
}

function AppInner() {
  const { activeRole, technicianId } = useAuth();
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const isSyncingRef = useRef(false);
  const [showPushPrompt, setShowPushPrompt] = useState(false);
  const [pushPromptMessage, setPushPromptMessage] = useState('');
  const [outboxStats, setOutboxStats] = useState({ pending: 0, failed: 0 });
  const [outboxItems, setOutboxItems] = useState<OutboxItem[]>([]);
  const [showOutboxPanel, setShowOutboxPanel] = useState(false);
  const outboxLastFocusRef = useRef<HTMLElement | null>(null);
  const pushLastFocusRef = useRef<HTMLElement | null>(null);
  const inFlightOutboxItemIdsRef = useRef<Set<number>>(new Set());
  const inFlightWorkReportInterventionIdsRef = useRef<Set<number>>(new Set());
  const vapidKey = (import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '').trim();
  const pushEnabled = vapidKey.length > 0;

  const isPushPromptDismissed = () => {
    if (typeof window === 'undefined') return false;
    const raw = window.localStorage.getItem(PUSH_PROMPT_DISMISSED_AT_KEY);
    const timestamp = Number(raw);
    if (!Number.isFinite(timestamp)) return false;
    return Date.now() - timestamp < PUSH_PROMPT_DISMISS_MS;
  };

  const dismissPushPromptForPeriod = () => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(PUSH_PROMPT_DISMISSED_AT_KEY, String(Date.now()));
  };

  const openOutboxPanel = () => {
    outboxLastFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setShowOutboxPanel(true);
  };

  const closeOutboxPanel = () => {
    setShowOutboxPanel(false);
    requestAnimationFrame(() => {
      outboxLastFocusRef.current?.focus();
    });
  };

  const openPushPrompt = () => {
    pushLastFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPushPromptMessage('');
    setShowPushPrompt(true);
  };

  const closePushPrompt = (persistDismiss: boolean) => {
    setShowPushPrompt(false);
    if (persistDismiss) dismissPushPromptForPeriod();
    requestAnimationFrame(() => {
      pushLastFocusRef.current?.focus();
    });
  };

  useModalRegistration({
    id: 'app-outbox-panel',
    isOpen: showOutboxPanel,
    onClose: closeOutboxPanel,
    options: { closeOnEsc: true, blockEscWhenEditing: false, priority: 320 }
  });

  useModalRegistration({
    id: 'app-push-prompt',
    isOpen: showPushPrompt,
    onClose: () => closePushPrompt(false),
    options: { closeOnEsc: true, blockEscWhenEditing: false, priority: 310 }
  });

  const refreshOutboxStats = async () => {
    try {
      const items = await getOutboxItems();
      setOutboxItems(items);
      setOutboxStats({
        pending: items.filter(i => i.status === 'pending').length,
        failed: items.filter(i => i.status === 'failed' || i.status === 'conflict').length
      });
    } catch (e) { }
  };

  useEffect(() => {
    refreshOutboxStats();
    const interval = setInterval(refreshOutboxStats, 5000); // Poll UI manually or when sync completes
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!pushEnabled) {
      setShowPushPrompt(false);
      return;
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !activeRole) return;
    if (Notification.permission === 'default' && !isPushPromptDismissed()) {
      const t = window.setTimeout(() => openPushPrompt(), 3000);
      return () => window.clearTimeout(t);
    }
    if (Notification.permission === 'granted') {
      void subscribeToPush();
    }
  }, [activeRole, technicianId, pushEnabled]);

  const subscribeToPush = async () => {
    if (!pushEnabled) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      if (!reg) return;

      const existingSub = await reg.pushManager.getSubscription();
      if (existingSub) return; // already subbed

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey)
      });

      // Send to server
      const res = await apiFetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.toJSON().keys?.p256dh,
            auth: subscription.toJSON().keys?.auth
          },
          technicianId: technicianId,
          role: activeRole
        })
      });
      if (!res.ok) {
        setPushPromptMessage('Errore durante l’attivazione delle notifiche.');
        return;
      }
      closePushPrompt(true);
    } catch (e) {
      console.error("Push subscribe fail:", e);
      setPushPromptMessage('Impossibile attivare le notifiche in questo momento.');
    }
  };

  const requestPushPermission = async () => {
    if (!pushEnabled) return;
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        await subscribeToPush();
      } else {
        setPushPromptMessage(permission === 'denied' ? 'Permesso notifiche negato.' : 'Attivazione notifiche annullata.');
        dismissPushPromptForPeriod();
        closePushPrompt(false);
      }
    } catch (e) {
      console.error(e);
      setPushPromptMessage('Errore durante la richiesta permessi notifiche.');
      dismissPushPromptForPeriod();
    }
  };

  // Sync Manager Background Job
  useEffect(() => {
    const handleOnline = async () => {
      if (isSyncingRef.current) return;
      isSyncingRef.current = true;
      setIsOffline(false);
      setIsSyncing(true);
      try {
        const outbox = await getOutboxItems();
        if (outbox.length > 0) {
          console.log(`[SyncManager] Sincronizzando ${outbox.length} operazioni offline...`);
          for (const item of outbox) {
            await processOutboxItem(item);
          }
          console.log('[SyncManager] Sincronizzazione completata.');
        }
      } catch (err) {
        console.error('[SyncManager] Errore di sincronizzazione', err);
      } finally {
        setIsSyncing(false);
        isSyncingRef.current = false;
      }
    };

    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Trigger on startup if online
    if (navigator.onLine) handleOnline();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    }
  }, []);

  const resolveWorkReportVersionForSync = async (interventionId: number) => {
    const interventionRes = await apiFetch(`/api/interventions/${interventionId}`);
    if (interventionRes.ok) {
      const interventionData = await interventionRes.json().catch(() => null);
      const version = interventionData?.workReport?.version;
      if (typeof version === 'number' && Number.isInteger(version)) {
        return version;
      }
    }

    const reportRes = await apiFetch(`/api/interventions/${interventionId}/work-report`);
    if (!reportRes.ok) return null;
    const reportData = await reportRes.json().catch(() => null);
    const version = reportData?.version;
    if (typeof version === 'number' && Number.isInteger(version)) {
      return version;
    }
    return null;
  };

  const processOutboxItem = async (item: OutboxItem) => {
    const workReportInterventionId = item.action === 'SUBMIT_REPORT'
      ? Number(item.payload?.interventionId)
      : null;
    const normalizedWorkReportInterventionId = Number.isFinite(workReportInterventionId)
      ? workReportInterventionId
      : null;
    const itemId = typeof item.id === 'number' ? item.id : null;
    const sameItemInFlight = itemId !== null && inFlightOutboxItemIdsRef.current.has(itemId);
    const sameWorkReportInFlight =
      normalizedWorkReportInterventionId !== null &&
      inFlightWorkReportInterventionIdsRef.current.has(normalizedWorkReportInterventionId);
    if (sameItemInFlight || sameWorkReportInFlight) {
      return;
    }
    if (itemId !== null) {
      inFlightOutboxItemIdsRef.current.add(itemId);
    }
    if (normalizedWorkReportInterventionId !== null) {
      inFlightWorkReportInterventionIdsRef.current.add(normalizedWorkReportInterventionId);
    }
    let workReportFailureEventEmitted = false;

    try {
      let res: Response | null = null;

      const legacyAction = String(item.action || '');
      if (
        legacyAction === 'START_SESSION' ||
        legacyAction === 'STOP_SESSION' ||
        legacyAction === 'PAUSE_START' ||
        legacyAction === 'PAUSE_STOP'
      ) {
        if (item.id !== undefined) {
          await removeOutboxItem(item.id);
        }
        return;
      }

      if (item.action === 'SUBMIT_REPORT') {
        let version = item.payload.version;
        if (!(typeof version === 'number' && Number.isInteger(version))) {
          version = await resolveWorkReportVersionForSync(Number(item.payload.interventionId));
        }
        if (!(typeof version === 'number' && Number.isInteger(version))) {
          throw new Error('Missing work report version for sync');
        }

        res = await apiFetch(`/api/interventions/${item.payload.interventionId}/work-report`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            version,
            workPerformed: item.payload.workPerformed,
            extraWork: item.payload.extraWork,
            materials: item.payload.materials,
            customerName: item.payload.customerName,
            customerEmail: item.payload.customerEmail,
          })
        });
      } else if (item.action === 'CREATE_INTERVENTION') {
        res = await apiFetch('/api/interventions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.payload)
        });
      } else if (item.action === 'UPDATE_INTERVENTION') {
        res = await apiFetch(`/api/interventions/${item.payload.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.payload.patch)
        });
      }

      if (!res) {
        console.warn(`[SyncManager] Azione outbox non gestita: ${item.action}. Item lasciato in coda.`);
        return;
      }

      if (res.ok) {
        if (normalizedWorkReportInterventionId !== null) {
          const payload = await res.clone().json().catch(() => null);
          const versionCandidate = payload?.version ?? payload?.report?.version;
          const version = typeof versionCandidate === 'number' && Number.isInteger(versionCandidate)
            ? versionCandidate
            : undefined;
          emitWorkReportOutboxEvent({
            interventionId: normalizedWorkReportInterventionId,
            outcome: 'SYNC_OK',
            at: Date.now(),
            version
          });
        }
        await removeOutboxItem(item.id!);
      } else if (res.status === 409) {
        if (normalizedWorkReportInterventionId !== null) {
          const payload = await res.clone().json().catch(() => null);
          const message = typeof payload?.error === 'string'
            ? payload.error
            : 'Conflitto versione durante sincronizzazione';
          emitWorkReportOutboxEvent({
            interventionId: normalizedWorkReportInterventionId,
            outcome: 'CONFLICT',
            at: Date.now(),
            kind: 'CONFLICT',
            message
          });
        }
        item.status = 'conflict';
        await updateOutboxItem(item);
        console.warn(`[SyncManager] Conflict 409 per item #${item.id}`);
      } else {
        if (normalizedWorkReportInterventionId !== null) {
          const payload = await res.clone().json().catch(() => null);
          const message = typeof payload?.error === 'string'
            ? payload.error
            : `Server returned ${res.status}`;
          const kind = res.status === 400 || res.status === 422
            ? 'VALIDATION'
            : res.status === 401 || res.status === 403
              ? 'SERVER'
              : res.status >= 500
                ? 'SERVER'
                : 'UNKNOWN';
          emitWorkReportOutboxEvent({
            interventionId: normalizedWorkReportInterventionId,
            outcome: 'SYNC_FAIL',
            at: Date.now(),
            kind,
            message
          });
          workReportFailureEventEmitted = true;
        }
        throw new Error(`Server returned ${res.status}`);
      }

    } catch (e) {
      console.error(`[SyncManager] Errore item #${item.id}`, e);
      if (item.status !== 'conflict') {
        item.retryCount = (item.retryCount || 0) + 1;
        if (item.retryCount > 5) {
          item.status = 'failed';
        }
        await updateOutboxItem(item);
      }
      if (
        normalizedWorkReportInterventionId !== null &&
        item.status !== 'conflict' &&
        !workReportFailureEventEmitted
      ) {
        const message = e instanceof Error ? e.message : 'Sincronizzazione outbox non riuscita';
        const lowMessage = message.toLowerCase();
        const kind = lowMessage.includes('network') || lowMessage.includes('fetch')
          ? 'NETWORK'
          : 'SERVER';
        emitWorkReportOutboxEvent({
          interventionId: normalizedWorkReportInterventionId,
          outcome: 'SYNC_FAIL',
          at: Date.now(),
          kind,
          message
        });
      }
    } finally {
      if (itemId !== null) {
        inFlightOutboxItemIdsRef.current.delete(itemId);
      }
      if (normalizedWorkReportInterventionId !== null) {
        inFlightWorkReportInterventionIdsRef.current.delete(normalizedWorkReportInterventionId);
      }
    }
  };

  const retryItem = async (item: OutboxItem) => {
    const itemId = typeof item.id === 'number' ? item.id : null;
    const workReportInterventionId = item.action === 'SUBMIT_REPORT'
      ? Number(item.payload?.interventionId)
      : null;
    const normalizedWorkReportInterventionId = Number.isFinite(workReportInterventionId)
      ? workReportInterventionId
      : null;
    const sameItemInFlight = itemId !== null && inFlightOutboxItemIdsRef.current.has(itemId);
    const sameWorkReportInFlight =
      normalizedWorkReportInterventionId !== null &&
      inFlightWorkReportInterventionIdsRef.current.has(normalizedWorkReportInterventionId);
    if (sameItemInFlight || sameWorkReportInFlight) {
      return;
    }
    item.status = 'pending';
    item.retryCount = 0;
    await updateOutboxItem(item);
    refreshOutboxStats();
    if (navigator.onLine) {
      processOutboxItem(item).then(refreshOutboxStats);
    }
  };

  const discardItem = async (id: number) => {
    if (window.confirm("Sei sicuro di voler scartare questa operazione? I dati verranno persi.")) {
      await removeOutboxItem(id);
      refreshOutboxStats();
    }
  };

  const getOutboxInterventionId = (item: OutboxItem): number | null => {
    const rawId = item.payload?.interventionId ?? item.payload?.id ?? item.payload?.patch?.id;
    const id = Number(rawId);
    return Number.isFinite(id) ? id : null;
  };

  const openInterventionFromOutbox = (item: OutboxItem) => {
    const id = getOutboxInterventionId(item);
    if (!id) {
      alert('ID intervento non disponibile per questo elemento.');
      return;
    }

    const targetPath = activeRole === 'TECHNICIAN' ? '/technician' : '/dispatcher';
    window.dispatchEvent(new CustomEvent('open-intervention', { detail: { id } }));

    if (!window.location.pathname.startsWith(targetPath)) {
      sessionStorage.setItem('openInterventionId', String(id));
      window.location.href = `${targetPath}?openInterventionId=${id}`;
    } else {
      setShowOutboxPanel(false);
    }
  };

  const refreshInterventionsFromOutbox = () => {
    const targetPath = activeRole === 'TECHNICIAN' ? '/technician' : '/dispatcher';
    if (!window.location.pathname.startsWith(targetPath)) {
      window.location.href = targetPath;
      return;
    }
    window.dispatchEvent(new Event('refresh-interventions'));
  };

  const loginRouteElement = activeRole
    ? (
      <Navigate to={activeRole === 'TECHNICIAN' ? '/technician' : '/dispatcher'} replace />
    )
    : <LoginPage />;

  return (
    <BrowserRouter>
      {isOffline && (
        <div className="bg-amber-500 text-white text-sm font-medium px-4 py-2 flex items-center justify-center gap-2 sticky top-0 z-[100]">
          <WifiOff className="w-4 h-4" />
          Sei offline. Modifiche salvate in locale e sync pronte al ritorno della rete.
        </div>
      )}
      {isSyncing && (
        <div className="bg-brand-500 text-white text-sm font-medium px-4 py-1.5 flex items-center justify-center gap-2 sticky top-0 z-[100] animate-pulse">
          <CloudUpload className="w-4 h-4" /> Sincronizzazione in corso...
        </div>
      )}
      {!isSyncing && outboxStats.pending > 0 && outboxStats.failed === 0 && (
        <div className="bg-blue-600 text-white text-sm font-medium px-4 py-1.5 flex items-center justify-center gap-2 sticky top-0 z-[100]">
          <CloudUpload className="w-4 h-4" /> {outboxStats.pending} operazioni in attesa
        </div>
      )}
      {!isSyncing && outboxStats.failed > 0 && (
        <button
          onClick={openOutboxPanel}
          className="w-full bg-red-600 text-white text-sm font-medium px-4 py-1.5 flex items-center justify-center gap-2 sticky top-0 z-[100] hover:bg-red-700 transition"
        >
          <AlertTriangle className="w-4 h-4" /> {outboxStats.failed} operazioni fallite o in conflitto (Clicca per risolvere)
        </button>
      )}

      {showOutboxPanel && typeof document !== 'undefined'
        ? createPortal(
          <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4 backdrop-blur-sm">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Code di Sincronizzazione"
              className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[80vh] flex flex-col overflow-hidden animate-in zoom-in-95"
            >
              <div className="p-4 bg-red-50 border-b border-red-100 flex justify-between items-center">
                <h3 className="font-bold text-red-800 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5" /> Code di Sincronizzazione
                </h3>
                <button
                  onClick={closeOutboxPanel}
                  aria-label="Chiudi"
                  className="text-red-400 hover:text-red-600 font-bold px-2 py-1 rounded"
                >
                  Chiudi
                </button>
              </div>
              <div className="p-4 overflow-y-auto flex-1 space-y-4">
                {outboxItems.filter(i => i.status === 'failed' || i.status === 'conflict').map(item => (
                  <div key={item.id} className="border border-slate-200 p-3 rounded-lg bg-slate-50 relative">
                    <div className="absolute top-2 right-2 flex gap-2">
                      <button onClick={() => retryItem(item)} className="text-xs bg-brand-600 text-white px-2 py-1 rounded shadow-sm font-medium hover:bg-brand-700">Riprova</button>
                      <button onClick={() => discardItem(item.id!)} className="text-xs bg-slate-200 text-slate-700 px-2 py-1 rounded font-medium hover:bg-slate-300">Scarta</button>
                    </div>
                    <p className="font-bold text-slate-800 text-sm mb-1">{item.action.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-slate-500 mb-2 font-mono bg-slate-100 p-1 rounded inline-block">ID Intervento: {item.payload?.id || item.payload?.interventionId || 'N/A'}</p>
                    <div className="text-xs font-medium px-2 py-1 rounded inline-block ml-2 border" style={{
                      backgroundColor: item.status === 'conflict' ? '#fffbeb' : '#fef2f2',
                      borderColor: item.status === 'conflict' ? '#fde68a' : '#fecaca',
                      color: item.status === 'conflict' ? '#92400e' : '#991b1b'
                    }}>
                      {item.status === 'conflict' ? 'Conflitto DB (409) - Ricarica dati e riprova' : 'Tentativi esauriti'}
                    </div>
                    {item.status === 'conflict' && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          onClick={() => openInterventionFromOutbox(item)}
                          className="text-xs bg-amber-500 text-white px-2 py-1 rounded font-medium hover:bg-amber-600"
                        >
                          Apri intervento
                        </button>
                        <button
                          onClick={refreshInterventionsFromOutbox}
                          className="text-xs bg-slate-200 text-slate-700 px-2 py-1 rounded font-medium hover:bg-slate-300"
                        >
                          Ricarica dati
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {outboxItems.filter(i => i.status === 'failed' || i.status === 'conflict').length === 0 && (
                  <p className="text-sm text-slate-500 text-center py-4">Nessun problema rilevato.</p>
                )}
              </div>
            </div>
          </div>,
          document.body
        )
        : null}

      {pushEnabled && showPushPrompt && typeof document !== 'undefined'
        ? createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Abilita Notifiche"
            className="fixed bottom-4 left-4 right-4 md:left-auto md:w-96 bg-white border border-slate-200 shadow-2xl rounded-2xl p-4 z-[210] flex flex-col gap-3 animate-in slide-in-from-bottom-5"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-accent-50 flex items-center justify-center flex-shrink-0 text-accent-600">
                <BellRing className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-slate-800 text-sm">Abilita Notifiche</h4>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">Ricevi avvisi in tempo reale quando ti viene assegnato o spostato un intervento.</p>
              </div>
            </div>
            {pushPromptMessage ? (
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">{pushPromptMessage}</p>
            ) : null}
            <div className="flex gap-2 w-full mt-2">
              <button onClick={() => closePushPrompt(true)} className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl transition">Non ora</button>
              <button onClick={requestPushPermission} className="flex-1 py-2 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded-xl shadow-sm transition">Attiva</button>
            </div>
          </div>,
          document.body
        )
        : null}

      <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-slate-600">Caricamento...</div>}>
        <Routes>
          <Route
            path="/"
            element={loginRouteElement}
          />
          <Route
            path="/login"
            element={loginRouteElement}
          />
          <Route path="/sign/:token" element={<SignPage />} />
          <Route
            path="/dispatcher"
            element={
              <ProtectedRoute allowedRoles={["ADMIN", "DISPATCHER"]}>
                <DispatcherPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/customers"
            element={
              <ProtectedRoute allowedRoles={["ADMIN", "DISPATCHER"]}>
                <CustomersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/technician"
            element={
              <ProtectedRoute allowedRoles={["TECHNICIAN"]}>
                <TechnicianPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teams"
            element={
              <ProtectedRoute allowedRoles={["ADMIN", "DISPATCHER"]}>
                <TeamsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/stats"
            element={
              <ProtectedRoute allowedRoles={["ADMIN", "DISPATCHER"]}>
                <StatsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute allowedRoles={["ADMIN", "DISPATCHER"]}>
                <SettingsPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <ModalStackProvider>
        <AppInner />
      </ModalStackProvider>
    </ToastProvider>
  );
}
