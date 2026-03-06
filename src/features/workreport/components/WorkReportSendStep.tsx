
type WorkReportSendStepProps = {
  customerEmail: string;
  customerName: string;
  onCustomerEmailChange: (value: string) => void;
  onCustomerNameChange: (value: string) => void;
  emailValid: boolean;
  isSigned: boolean;
  actualMinutes: number;
  isStopped: boolean;
  emailedAt?: string | null;
};

export default function WorkReportSendStep({
  customerEmail,
  customerName,
  onCustomerEmailChange,
  onCustomerNameChange,
  emailValid,
  isSigned,
  actualMinutes,
  isStopped,
  emailedAt
}: WorkReportSendStepProps) {
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h4 className="text-sm font-semibold text-slate-900">Invio al cliente</h4>
        <p className="mt-1 text-xs text-slate-500">
          Inserisci una email valida. L&apos;invio è disponibile solo dopo la firma.
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Email cliente</label>
            <input
              type="email"
              value={customerEmail}
              onChange={e => onCustomerEmailChange(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-brand-400/40"
              placeholder="cliente@email.com"
            />
            {!!customerEmail && !emailValid && (
              <p className="mt-1 text-xs text-rose-600">Email non valida.</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Nome cliente / referente (opzionale)
            </label>
            <input
              type="text"
              value={customerName}
              onChange={e => onCustomerNameChange(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-brand-400/40"
              placeholder="Nome referente"
            />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <h4 className="text-sm font-semibold text-slate-900">Riepilogo</h4>
        <div className="mt-3 space-y-2 text-sm text-slate-700">
          <div className="flex items-center justify-between">
            <span>Bolla firmata</span>
            <span className={isSigned ? 'font-semibold text-emerald-700' : 'font-semibold text-rose-600'}>
              {isSigned ? 'Sì' : 'No'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>Totale minuti</span>
            <span className="font-semibold">{actualMinutes}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Timer terminato</span>
            <span className="font-semibold">{isStopped ? 'Sì' : 'No'}</span>
          </div>
        </div>

        {!isSigned && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            La bolla deve essere firmata prima dell&apos;invio.
          </div>
        )}

        {emailedAt && (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
            Ultimo invio: {new Date(emailedAt).toLocaleString()}
          </div>
        )}
      </section>
    </div>
  );
}
