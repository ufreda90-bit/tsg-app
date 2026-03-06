import type { RefObject } from 'react';

type WorkReportCloseConfirmProps = {
  open: boolean;
  mode: 'default' | 'syncing';
  action: 'retry' | null;
  primaryButtonRef?: RefObject<HTMLButtonElement | null>;
  onRequestClose: () => void;
  onSaveLocalAndClose: () => void;
  onRetryNow: () => void;
};

export default function WorkReportCloseConfirm({
  open,
  mode,
  action,
  primaryButtonRef,
  onRequestClose,
  onSaveLocalAndClose,
  onRetryNow
}: WorkReportCloseConfirmProps) {
  if (!open) {
    return null;
  }

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
      onMouseDown={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget && !action) {
          onRequestClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Conferma chiusura bolla"
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h4 className="text-sm font-semibold text-slate-900">Conferma chiusura</h4>
        <p className="mt-2 text-xs text-slate-600">
          {mode === 'syncing'
            ? 'Sincronizzazione in corso. Se chiudi ora, la bolla potrebbe essere ancora in invio. Vuoi salvare in locale e chiudere?'
            : 'Hai modifiche non ancora sincronizzate. Scegli come procedere prima di chiudere la bolla.'}
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            ref={primaryButtonRef}
            type="button"
            onClick={onSaveLocalAndClose}
            disabled={action !== null}
            className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            SALVA IN LOCALE E CHIUDI
          </button>
          <button
            type="button"
            onClick={onRetryNow}
            disabled={action !== null}
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {action === 'retry' ? 'RIPROVO...' : 'RIPROVA ORA'}
          </button>
          <button
            type="button"
            onClick={onRequestClose}
            disabled={action !== null}
            className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-60"
          >
            ANNULLA
          </button>
        </div>
      </div>
    </div>
  );
}
