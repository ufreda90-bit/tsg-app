import { AlertTriangle, CheckCircle2, CloudOff, Clock3, RefreshCcw } from 'lucide-react';
import type { SaveLifecycleState } from '../saveLifecycle';

type WorkReportStatusBannerProps = {
  saveLifecycle: SaveLifecycleState;
  statusLabel: string;
  isSaving?: boolean;
  helperMessage?: string | null;
  onRetry?: () => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
  actionsDisabled?: boolean;
};

function formatStatusTime(epochMs: number | null) {
  if (!epochMs) return null;
  try {
    return new Date(epochMs).toLocaleTimeString('it-IT', {
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return null;
  }
}

const stateClasses: Record<SaveLifecycleState['state'], string> = {
  DIRTY: 'border-orange-200 bg-orange-50 text-orange-900',
  LOCAL_SAVED: 'border-slate-200 bg-slate-50 text-slate-800',
  QUEUED: 'border-amber-200 bg-amber-50 text-amber-900',
  SYNCING: 'border-sky-200 bg-sky-50 text-sky-900',
  SYNCED: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  FAILED: 'border-rose-200 bg-rose-50 text-rose-900',
  CONFLICT: 'border-amber-300 bg-amber-50 text-amber-900'
};

const DRAFT_PERSIST_WARNING =
  'Bozza non salvata sul dispositivo. Non chiudere questa schermata finché non completi il salvataggio.';

export default function WorkReportStatusBanner({
  saveLifecycle,
  statusLabel,
  isSaving = false,
  helperMessage,
  onRetry,
  onRefresh,
  actionsDisabled = false
}: WorkReportStatusBannerProps) {
  const draftPersistWarning = saveLifecycle.draftPersistFailed
    ? (saveLifecycle.draftPersistErrorMessage || DRAFT_PERSIST_WARNING)
    : null;
  const canUseSavingAsPrimary =
    isSaving &&
    !draftPersistWarning &&
    saveLifecycle.state !== 'FAILED' &&
    saveLifecycle.state !== 'CONFLICT' &&
    (saveLifecycle.state === 'SYNCING' || saveLifecycle.state === 'LOCAL_SAVED');
  const primaryLabel = canUseSavingAsPrimary ? 'Salvataggio in corso...' : statusLabel;
  const savingSecondaryHint =
    isSaving &&
    !canUseSavingAsPrimary &&
    saveLifecycle.state !== 'FAILED' &&
    saveLifecycle.state !== 'CONFLICT'
      ? 'Salvataggio in corso...'
      : null;

  const secondaryLine = (() => {
    if (draftPersistWarning) return draftPersistWarning;
    if (helperMessage) return helperMessage;
    if (savingSecondaryHint) return savingSecondaryHint;
    if (saveLifecycle.state === 'QUEUED') {
      return 'Verrà inviata automaticamente quando torna internet.';
    }
    if (saveLifecycle.state === 'FAILED') {
      return 'Errore: riprova oppure salva in locale e chiudi.';
    }
    if (saveLifecycle.state === 'CONFLICT') {
      return 'Dati aggiornati altrove. Premi "Aggiorna" e ricontrolla.';
    }
    if (saveLifecycle.state === 'LOCAL_SAVED') {
      return 'Bozza salvata localmente su questo dispositivo.';
    }
    return null;
  })();

  const statusTime =
    saveLifecycle.state === 'SYNCED'
      ? formatStatusTime(saveLifecycle.lastServerSavedAt)
      : formatStatusTime(saveLifecycle.lastLocalSavedAt);

  const icon = (() => {
    if (draftPersistWarning) {
      return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />;
    }
    if (saveLifecycle.state === 'DIRTY') {
      return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />;
    }
    if (saveLifecycle.state === 'LOCAL_SAVED') {
      return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />;
    }
    if (saveLifecycle.state === 'FAILED' || saveLifecycle.state === 'CONFLICT') {
      return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />;
    }
    if (saveLifecycle.state === 'QUEUED') {
      return <CloudOff className="mt-0.5 h-4 w-4 shrink-0" />;
    }
    if (saveLifecycle.state === 'SYNCED') {
      return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />;
    }
    if (saveLifecycle.state === 'SYNCING') {
      return <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />;
    }
    return <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />;
  })();

  return (
    <div className={`rounded-xl border px-3 py-2 ${stateClasses[saveLifecycle.state]}`} role="status" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2 text-sm font-semibold">
            {icon}
            <span>{primaryLabel}</span>
          </div>
          {secondaryLine && (
            <p className="mt-1 text-xs opacity-90">{secondaryLine}</p>
          )}
          {saveLifecycle.lastError?.message && (saveLifecycle.state === 'FAILED' || saveLifecycle.state === 'CONFLICT') && (
            <p className="mt-1 text-xs opacity-90">Dettaglio: {saveLifecycle.lastError.message}</p>
          )}
          {statusTime && (
            <p className="mt-1 text-[11px] opacity-75">
              {saveLifecycle.state === 'SYNCED' ? 'Ultimo invio' : 'Ultimo salvataggio locale'}: {statusTime}
            </p>
          )}
        </div>
        {saveLifecycle.state === 'CONFLICT' && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void onRefresh?.();
              }}
              disabled={actionsDisabled}
              className="rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
            >
              Aggiorna
            </button>
            <button
              type="button"
              onClick={() => {
                void onRetry?.();
              }}
              disabled={actionsDisabled}
              className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-200 disabled:opacity-60"
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              Riprova
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
