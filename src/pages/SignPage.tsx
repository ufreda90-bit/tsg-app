import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import SignatureCanvas from 'react-signature-canvas';
import { CheckCircle, ShieldCheck, PenTool, RefreshCw } from 'lucide-react';
import { apiFetch } from '../lib/apiFetch';

export default function SignPage() {
    const { token } = useParams();
    const [report, setReport] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    // Firma e nome finto se vogliamo forzarlo
    const sigPad = useRef<any>(null);
    const [customerName, setCustomerName] = useState('');

    useEffect(() => {
        const fetchReport = async () => {
            try {
                const res = await apiFetch(`/api/public/sign/${token}`);
                if (!res.ok) {
                    setError("Link non valido o scaduto.");
                } else {
                    const data = await res.json();
                    setReport(data);
                    if (data.signedAt) {
                        setSuccess(true);
                    }
                    if (data.customerName) setCustomerName(data.customerName);
                }
            } catch (e) {
                setError("Errore di connessione.");
            } finally {
                setLoading(false);
            }
        };
        fetchReport();
    }, [token]);

    const handleClear = () => {
        sigPad.current?.clear();
    };

    const handleSubmit = async () => {
        if (sigPad.current?.isEmpty()) {
            alert("Per favore, inserisci una firma nel riquadro.");
            return;
        }

        setSubmitting(true);

        try {
            // Usa getCanvas invece del trimmed per essere più safe contro errori di cross-origin/dimensione
            const dataUrl = sigPad.current?.getCanvas().toDataURL('image/png');

            const res = await apiFetch(`/api/public/sign/${token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    signatureDataUrl: dataUrl,
                    customerName: customerName.trim() || undefined
                })
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || "Errore sconosciuto");
            }
            setSuccess(true);
        } catch (e: any) {
            console.error(e);
            alert("Errore durante il salvataggio della firma: " + (e.message || "Riprova"));
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">Caricamento in corso...</div>;
    }

    if (error) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
                <div className="bg-white p-6 rounded-2xl shadow-xl max-w-sm w-full text-center space-y-4 border border-red-100">
                    <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto">
                        <ShieldCheck className="w-8 h-8" />
                    </div>
                    <h2 className="text-xl font-bold text-slate-800">Accesso Negato</h2>
                    <p className="text-slate-600">{error}</p>
                </div>
            </div>
        );
    }

    if (success) {
        return (
            <div className="min-h-screen bg-emerald-50 flex items-center justify-center p-4">
                <div className="bg-white p-8 rounded-3xl shadow-xl max-w-sm w-full text-center space-y-6 border border-emerald-100 animate-in zoom-in-95">
                    <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                        <CheckCircle className="w-10 h-10" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 mb-2">Bolla Firmata!</h2>
                        <p className="text-slate-600 text-sm">Grazie per aver confermato il report. Il tecnico è stato notificato e riceverai a breve una copia PDF all'indirizzo email indicato.</p>
                    </div>
                    <div className="pt-6 border-t border-slate-100 text-xs text-slate-400">
                        Puoi chiudere questa pagina in sicurezza.
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-100 p-4 md:p-8 flex items-center justify-center">
            <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200">
                {/* Header */}
                <div className="bg-brand-600 px-6 py-8 text-center text-white space-y-2">
                    <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4 backdrop-blur-sm">
                        <PenTool className="w-7 h-7" />
                    </div>
                    <h1 className="text-2xl font-bold">Firma Bolla di Lavoro</h1>
                    <p className="opacity-90 text-sm">Rivedi i dettagli dell'intervento e apponi la tua firma per conferma.</p>
                </div>

                {/* Content */}
                <div className="p-6 md:p-8 space-y-8">

                    {/* Riepilogo */}
                    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-3">
                        <h3 className="font-bold text-slate-800 border-b border-slate-200 pb-2 mb-3">Riepilogo Dettagli</h3>
                        <div className="space-y-1 text-sm">
                            <p className="text-slate-500">Intervento: <span className="text-slate-800 font-medium block">{report.intervention?.title}</span></p>
                            <p className="text-slate-500 mt-2">Indirizzo: <span className="text-slate-800 block">{report.intervention?.address}</span></p>
                            <p className="text-slate-500 mt-2">Data: <span className="text-slate-800 font-medium block">{report.actualStartAt ? new Date(report.actualStartAt).toLocaleDateString() : 'Oggi'}</span></p>
                        </div>
                        <div className="mt-4 pt-3 border-t border-slate-200">
                            <h4 className="font-semibold text-sm text-slate-700 mb-1">Lavori Svolti:</h4>
                            <p className="text-sm text-slate-600 italic bg-white p-3 rounded-lg border border-slate-100/50">{report.workPerformed || 'Nessuna nota fornita dal tecnico.'}</p>
                        </div>
                    </div>

                    {/* Form di Firma */}
                    <div className="space-y-5 relative">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1">Nome Referente</label>
                            <input
                                type="text"
                                value={customerName}
                                onChange={e => setCustomerName(e.target.value)}
                                placeholder="Tuo Nome e Cognome"
                                className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 outline-none focus:border-brand-500 focus:bg-brand-50/30 transition shadow-sm"
                            />
                        </div>

                        <div>
                            <div className="flex justify-between items-end mb-2">
                                <label className="block text-sm font-semibold text-slate-700">La tua firma</label>
                                <button onClick={handleClear} className="text-xs text-brand-600 font-medium hover:underline flex items-center gap-1">
                                    <RefreshCw className="w-3 h-3" /> Pulisci
                                </button>
                            </div>
                            <div className="border-2 border-slate-300 border-dashed rounded-2xl overflow-hidden bg-white shadow-inner relative">
                                <SignatureCanvas
                                    ref={sigPad}
                                    penColor="black"
                                    canvasProps={{ className: 'w-full h-56 touch-none' }}
                                />
                                <div className="absolute top-4 left-4 text-slate-300 font-bold text-lg select-none pointer-events-none opacity-50">
                                    Firma qui
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={handleSubmit}
                            disabled={submitting}
                            className="w-full bg-slate-900 hover:bg-black text-white rounded-xl py-4 font-bold text-lg shadow-lg hover:shadow-xl transition flex items-center justify-center gap-2 transform active:scale-[0.98]"
                        >
                            {submitting ? 'Salvataggio in corso...' : 'Conferma e Firma'}
                        </button>
                    </div>

                </div>
            </div>
        </div>
    );
}
