import { PenTool } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

type WorkReportSignStepProps = {
  isSigned: boolean;
  customerSignatureDataUrl?: string | null;
  signUrl: string | null;
  saving: boolean;
  onShowSignatureInfo: () => void;
  onGenerateSignLink: () => Promise<void>;
  onRefreshSignatureStatus: () => Promise<unknown>;
  showGoToSendButton: boolean;
  goToSendDisabled: boolean;
  onGoToSend: () => void;
  signStepHint: string | null;
};

export default function WorkReportSignStep({
  isSigned,
  customerSignatureDataUrl,
  signUrl,
  saving,
  onShowSignatureInfo,
  onGenerateSignLink,
  onRefreshSignatureStatus,
  showGoToSendButton,
  goToSendDisabled,
  onGoToSend,
  signStepHint
}: WorkReportSignStepProps) {
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold text-slate-900">Firma cliente</h4>
            <p className="text-xs text-slate-500">Firma con il dito dal telefono tramite link/QR.</p>
          </div>
          <button
            type="button"
            onClick={onShowSignatureInfo}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600"
          >
            Come funziona
          </button>
        </div>

        <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-3">
          <div className="flex h-44 items-center justify-center rounded-lg bg-white">
            {isSigned && customerSignatureDataUrl ? (
              <img
                src={customerSignatureDataUrl}
                alt="Firma cliente"
                className="max-h-36 w-auto object-contain"
              />
            ) : (
              <div className="text-center">
                <PenTool className="mx-auto mb-2 h-6 w-6 text-slate-400" />
                <p className="text-sm text-slate-500">Nessuna firma acquisita</p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {!signUrl && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              Genera il link firma, fai firmare il cliente e poi premi "FIRMA E CHIUDI".
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {!signUrl && (
              <button
                type="button"
                onClick={() => { void onGenerateSignLink(); }}
                disabled={saving}
                className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Genera link firma
              </button>
            )}
            <button
              type="button"
              onClick={() => { void onRefreshSignatureStatus(); }}
              disabled={saving}
              className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Verifica firma
            </button>
            {showGoToSendButton && (
              <button
                type="button"
                onClick={onGoToSend}
                disabled={goToSendDisabled}
                className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Vai a invio email
              </button>
            )}
          </div>

          {signUrl && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex justify-center rounded-lg border border-slate-200 bg-white p-3">
                <QRCodeSVG value={signUrl} size={150} />
              </div>
              <p className="mt-3 text-sm text-slate-700">
                Fai inquadrare il QR al cliente dal suo smartphone.
              </p>
              <div className="mt-2 break-all rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-500">
                {signUrl}
              </div>
              <a
                href={signUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
              >
                <PenTool className="h-4 w-4" />
                Firma con il dito
              </a>
            </div>
          )}

          {signStepHint && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {signStepHint}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
