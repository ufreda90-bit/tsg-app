import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { Intervention, InterventionDetails, AttachmentRecord } from '../types';
import { format } from 'date-fns';
import { MapPin, Clock, Video, UploadCloud, X, Paperclip } from 'lucide-react';
import { cn } from '../lib/utils';
import WorkReportModal from '../components/WorkReportModal';
import { apiFetch } from '../lib/apiFetch';
import { useLocation } from 'react-router-dom';
import AppLayout from '../components/AppLayout';
import { toast } from '../components/Toast';
import { getStatusBadgeClasses } from '../lib/status';
import { useModalRegistration } from '../components/ModalStackProvider';

const WORK_REPORT_EMAIL_ENABLED = import.meta.env.VITE_WORK_REPORT_EMAIL_ENABLED === 'true';

export default function TechnicianPage() {
    const { technicianId } = useAuth();
    const [interventions, setInterventions] = useState<Intervention[]>([]);
    const [loading, setLoading] = useState(true);
    const [forcedOpenId, setForcedOpenId] = useState<number | null>(null);
    const isFetchingRef = useRef(false);
    const cooldownUntilRef = useRef(0);
    const location = useLocation();

    const fetchInterventions = useCallback(async () => {
        if (!technicianId) return;
        if (isFetchingRef.current) return;
        if (Date.now() < cooldownUntilRef.current) return;

        isFetchingRef.current = true;
        setLoading(true);
        try {
            const res = await apiFetch(`/api/interventions?technicianId=${technicianId}`);
            if (res.status === 429) {
                cooldownUntilRef.current = Date.now() + 2000;
                toast.error('Troppe richieste, riprova tra qualche secondo');
                return;
            }
            if (!res.ok) {
                return;
            }
            const data = await res.json().catch(() => null);
            setInterventions(Array.isArray(data) ? data : []);
        } catch (e) {
            console.error(e);
            setInterventions([]);
        } finally {
            cooldownUntilRef.current = Math.max(cooldownUntilRef.current, Date.now() + 1000);
            setLoading(false);
            isFetchingRef.current = false;
        }
    }, [technicianId]);

    useEffect(() => {
        fetchInterventions();
    }, [fetchInterventions]);

    useEffect(() => {
        const handler = (event: Event) => {
            const detail = (event as CustomEvent<{ id?: number }>).detail;
            if (detail?.id) {
                setForcedOpenId(detail.id);
            }
        };
        window.addEventListener('open-intervention', handler as EventListener);
        return () => window.removeEventListener('open-intervention', handler as EventListener);
    }, []);

    useEffect(() => {
        const handler = () => fetchInterventions();
        window.addEventListener('refresh-interventions', handler);
        return () => window.removeEventListener('refresh-interventions', handler);
    }, [fetchInterventions]);

    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const storedId = sessionStorage.getItem('openInterventionId');
        const idRaw = params.get('openInterventionId') || storedId;
        if (!idRaw) return;
        const id = Number(idRaw);
        if (!Number.isFinite(id)) return;
        sessionStorage.removeItem('openInterventionId');
        setForcedOpenId(id);
    }, [location.search]);

    if (!technicianId) return <div className="p-4">Accesso non autorizzato</div>;

    const today = new Date().toISOString().split('T')[0];
    const todaysInterventions = interventions.filter(i => i.startAt?.startsWith(today));
    const upcomingInterventions = interventions.filter(i => i.startAt && i.startAt > today && !i.startAt.startsWith(today));

    return (
        <AppLayout
            title="Tecnico"
            subtitle={`Bologna · Tecnico #${technicianId}`}
            searchPlaceholder="Cerca interventi..."
            contentClassName="space-y-6 pb-16"
        >
            <div className="space-y-6">
                {/* Today Section */}
                <section className="space-y-4">
                    <div className="flex items-center gap-2">
                        <div className="glass-chip rounded-full px-3 py-1 text-xs font-semibold text-slate-600 border border-white/60">Oggi</div>
                        <Clock className="w-4 h-4 text-brand-500" />
                    </div>
                    {todaysInterventions.length === 0 ? (
                        <p className="text-slate-500 italic">Nessun intervento oggi.</p>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                            {todaysInterventions.map(i => (
                                <InterventionCard
                                    key={i.id}
                                    intervention={i}
                                    isLoading={false}
                                    onRefresh={fetchInterventions}
                                    forceOpenReportId={forcedOpenId}
                                    onForceOpenHandled={() => setForcedOpenId(null)}
                                />
                            ))}
                        </div>
                    )}
                </section>

                {/* Upcoming Section */}
                <section className="space-y-4">
                    <div className="flex items-center gap-2">
                        <div className="glass-chip rounded-full px-3 py-1 text-xs font-semibold text-slate-600 border border-white/60">Prossimi</div>
                        <CalendarIcon className="w-4 h-4 text-accent-500" />
                    </div>
                    {upcomingInterventions.length === 0 ? (
                        <p className="text-slate-500 italic">Nessun intervento programmato.</p>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
                            {upcomingInterventions.map(i => (
                                <InterventionCard
                                    key={i.id}
                                    intervention={i}
                                    isLoading={false}
                                    onRefresh={fetchInterventions}
                                    forceOpenReportId={forcedOpenId}
                                    onForceOpenHandled={() => setForcedOpenId(null)}
                                />
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </AppLayout>
    );
}

function CalendarIcon({ className }: { className?: string }) {
    return <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2" /><line x1="16" x2="16" y1="2" y2="6" /><line x1="8" x2="8" y1="2" y2="6" /><line x1="3" x2="21" y1="10" y2="10" /></svg>
}

function InterventionCard({
    intervention,
    onRefresh,
    isLoading,
    forceOpenReportId,
    onForceOpenHandled
}: {
    intervention: Intervention,
    onRefresh: () => void,
    isLoading: boolean,
    forceOpenReportId?: number | null,
    onForceOpenHandled?: () => void
}) {
    const isDone = intervention.status === 'COMPLETED';
    const allDisabled = isLoading;
    const [uploading, setUploading] = useState(false);
    const [isReportOpen, setIsReportOpen] = useState(false);
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);
    const [mediaList, setMediaList] = useState<any[]>(intervention.media || []);

    useEffect(() => {
        setMediaList(intervention.media || []);
    }, [intervention]);

    useEffect(() => {
        if (forceOpenReportId === intervention.id) {
            setIsReportOpen(true);
        }
    }, [forceOpenReportId, intervention.id]);

    useModalRegistration({
        id: `technician-report-modal-${intervention.id}`,
        isOpen: isReportOpen,
        onClose: () => {
            setIsReportOpen(false);
            if (forceOpenReportId === intervention.id) {
                onForceOpenHandled?.();
            }
        },
        options: {
            closeOnEsc: true,
            blockEscWhenEditing: true,
            priority: 140
        }
    });

    useModalRegistration({
        id: `technician-details-modal-${intervention.id}`,
        isOpen: isDetailsOpen,
        onClose: () => setIsDetailsOpen(false),
        options: {
            closeOnEsc: true,
            blockEscWhenEditing: false,
            priority: 130
        }
    });

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        toast.info('Upload foto in arrivo - demo: allegati non attivi');
        if (e.target) {
            e.target.value = '';
        }
    };

    const priorityClass = cn(
        'badge-pill',
        intervention.priority === 'URGENT' && 'bg-rose-50 text-rose-600 border-rose-100',
        intervention.priority === 'HIGH' && 'bg-amber-50 text-amber-700 border-amber-100',
        intervention.priority === 'MEDIUM' && 'bg-blue-50 text-blue-600 border-blue-100',
        intervention.priority === 'LOW' && 'bg-emerald-50 text-emerald-600 border-emerald-100'
    );

    const statusLabel = (() => {
        if (intervention.status === 'SCHEDULED') return 'DA INIZIARE';
        if (intervention.status === 'IN_PROGRESS') return 'IN CORSO';
        if (intervention.status === 'COMPLETED') return 'COMPLETATO';
        if (intervention.status === 'FAILED') return 'FALLITO';
        if (intervention.status === 'CANCELLED') return 'ANNULLATO';
        if (intervention.status === 'NO_SHOW') return 'NON PRESENTE';
        return intervention.status;
    })();

    const reportChip = (() => {
        if (!isDone) return null;
        if (intervention.workReport?.emailedAt) {
            return { label: 'INVIATA', className: 'bg-emerald-50 text-emerald-700 border-emerald-100' };
        }
        if (intervention.workReport?.signedAt) {
            return {
                label: WORK_REPORT_EMAIL_ENABLED ? 'DA INVIARE' : 'FIRMATA',
                className: 'bg-sky-50 text-sky-700 border-sky-100'
            };
        }
        return { label: 'DA FIRMARE', className: 'bg-amber-50 text-amber-700 border-amber-100' };
    })();

    const primaryCta = (() => {
        if (isDone) {
            if (!intervention.workReport?.signedAt) return { label: 'Firma bolla', action: () => setIsReportOpen(true), aria: 'Firma bolla' };
            if (WORK_REPORT_EMAIL_ENABLED && !intervention.workReport?.emailedAt) {
                return { label: 'Invia bolla', action: () => setIsReportOpen(true), aria: 'Invia bolla' };
            }
            return { label: 'Visualizza bolla', action: () => setIsReportOpen(true), aria: 'Visualizza bolla' };
        }
        return { label: 'Compila bolla', action: () => setIsReportOpen(true), aria: 'Compila bolla' };
    })();

    const secondaryCtaLabel = 'Dettagli';
    const primaryLoadingLabel = '...';

    return (
        <div className={cn(
            'glass-card p-5 rounded-3xl shadow-xl border border-white/70 transition-all',
            isDone && 'opacity-70'
        )}>
            <div className="flex justify-between items-start mb-3 gap-3">
                <div className="flex flex-wrap gap-2">
                    <span
                        className={cn(
                            'badge-pill',
                            getStatusBadgeClasses(intervention.status),
                            intervention.status === 'IN_PROGRESS' && 'animate-pulse'
                        )}
                    >
                        {statusLabel}
                    </span>
                    {reportChip && (
                        <span className={cn('badge-pill', reportChip.className)}>{reportChip.label}</span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <span className={priorityClass}>{intervention.priority}</span>
                    <span className="text-[11px] text-slate-400 font-semibold">#{intervention.id}</span>
                </div>
            </div>

            <h3 className="font-bold text-slate-800 text-lg leading-tight mb-1">{intervention.title}</h3>

            <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(intervention.address)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-slate-600 hover:text-brand-600 transition text-sm mb-3 group"
            >
                <MapPin className="w-4 h-4 flex-shrink-0 group-hover:scale-110 transition-transform" />
                <span className="truncate underline decoration-dotted underline-offset-2" title="Apri in Google Maps">{intervention.address}</span>
            </a>

            {intervention.startAt && (
                <div className="text-sm text-slate-500 mb-4">
                    {format(new Date(intervention.startAt), 'HH:mm')} - {intervention.endAt ? format(new Date(intervention.endAt), 'HH:mm') : '?'}
                </div>
            )}

            <div className="flex flex-col gap-2 mt-4 pt-4 border-t glass-divider">
                <button
                    onClick={primaryCta.action}
                    disabled={allDisabled}
                    className="btn-primary w-full text-sm flex items-center justify-center gap-2"
                    aria-label={primaryCta.aria}
                >
                    {allDisabled ? primaryLoadingLabel : (
                        primaryCta.label
                    )}
                </button>
                <div className="flex items-center justify-between gap-2">
                    <button
                        onClick={() => setIsDetailsOpen(true)}
                        disabled={allDisabled}
                        className="text-sm text-slate-500 hover:text-slate-800 transition underline underline-offset-4 decoration-dotted disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label="Apri dettagli intervento"
                    >
                        {secondaryCtaLabel}
                    </button>
                    <label className={cn(
                        'glass-chip border border-white/70 flex items-center justify-center w-10 h-10 rounded-full transition flex-shrink-0',
                        allDisabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-white/80'
                    )} title="Allega foto/video">
                        <UploadCloud className="w-5 h-5 text-slate-600" />
                        <input type="file" accept="image/*,video/*" className="hidden" onChange={handleFileUpload} disabled={uploading || allDisabled} />
                    </label>
                </div>
            </div>

            {uploading && <div className="text-xs text-brand-600 font-medium mt-2 animate-pulse">Caricamento file in corso...</div>}

            {/* Media Gallery */}
            {mediaList && mediaList.length > 0 && (
                <div className="mt-4">
                    <h4 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Allegati ({mediaList.length})</h4>
                    <div className="flex gap-2 overflow-x-auto pb-2 snap-x custom-scrollbar">
                        {mediaList.map((m: any) => (
                            <div key={m.id} className="relative w-20 h-20 rounded-2xl border border-white/70 overflow-hidden flex-shrink-0 snap-start bg-white/50 backdrop-blur">
                                {m.type === 'video' ? (
                                    <div className="w-full h-full flex items-center justify-center bg-slate-800/80">
                                        <Video className="w-6 h-6 text-white opacity-70" />
                                        <a href={m.url} target="_blank" rel="noopener noreferrer" className="absolute inset-0 z-10"></a>
                                    </div>
                                ) : (
                                    <a href={m.url} target="_blank" rel="noopener noreferrer" className="block w-full h-full">
                                        <img src={m.url} alt="allegato" className="w-full h-full object-cover" />
                                    </a>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {isReportOpen && (
                <WorkReportModal
                    intervention={intervention}
                    onClose={() => {
                        setIsReportOpen(false);
                        if (forceOpenReportId === intervention.id) {
                            onForceOpenHandled?.();
                        }
                    }}
                    onRefresh={onRefresh}
                />
            )}

            {isDetailsOpen && (
                <TechnicianInterventionDetailsModal
                    interventionId={intervention.id}
                    fallbackIntervention={intervention}
                    onClose={() => setIsDetailsOpen(false)}
                    onOpenWorkReport={() => {
                        setIsDetailsOpen(false);
                        setIsReportOpen(true);
                    }}
                />
            )}
        </div>
    );
}

function formatAttachmentSize(size?: number) {
    if (!size || size <= 0) return '0 KB';
    if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function AttachmentListSection({ title, items }: { title: string; items?: AttachmentRecord[] }) {
    const attachments = Array.isArray(items) ? items : [];
    return (
        <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h4>
            {attachments.length === 0 ? (
                <div className="text-xs text-slate-500 bg-white/40 border border-white/60 rounded-xl px-3 py-2">
                    Nessun allegato
                </div>
            ) : (
                <div className="space-y-2">
                    {attachments.map(att => (
                        <div key={att.id} className="rounded-2xl border border-white/70 bg-white/60 p-2.5">
                            <div className="flex items-center justify-between gap-2">
                                <a
                                    href={att.downloadUrl || `/api/attachments/${att.id}/download`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="min-w-0 flex items-center gap-2 text-sm text-slate-700 hover:text-brand-600"
                                >
                                    <Paperclip className="w-4 h-4 shrink-0" />
                                    <span className="truncate">{att.originalName}</span>
                                </a>
                                <span className="text-[11px] text-slate-500 shrink-0">{formatAttachmentSize(att.size)}</span>
                            </div>
                            {att.kind === 'AUDIO' && (
                                <audio className="w-full mt-2" controls preload="none" src={att.downloadUrl || `/api/attachments/${att.id}/download`} />
                            )}
                            {att.kind === 'IMAGE' && (
                                <a href={att.downloadUrl || `/api/attachments/${att.id}/download`} target="_blank" rel="noopener noreferrer" className="block mt-2">
                                    <img
                                        src={att.downloadUrl || `/api/attachments/${att.id}/download`}
                                        alt={att.originalName}
                                        className="w-full max-h-40 object-cover rounded-xl border border-white/70 bg-white"
                                        loading="lazy"
                                    />
                                </a>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function TechnicianInterventionDetailsModal({
    interventionId,
    fallbackIntervention,
    onClose,
    onOpenWorkReport
}: {
    interventionId: number;
    fallbackIntervention: Intervention;
    onClose: () => void;
    onOpenWorkReport: () => void;
}) {
    const [loading, setLoading] = useState(true);
    const [details, setDetails] = useState<InterventionDetails | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const run = async () => {
            setLoading(true);
            setError(null);
            try {
                const res = await apiFetch(`/api/interventions/${interventionId}/details`);
                const payload = await res.json().catch(() => null);
                if (!res.ok) {
                    const message =
                        (typeof payload?.message === 'string' && payload.message) ||
                        (typeof payload?.error === 'string' && payload.error) ||
                        'Errore caricamento dettagli';
                    if (!cancelled) setError(message);
                    return;
                }
                if (!cancelled) setDetails(payload as InterventionDetails);
            } catch (e) {
                if (!cancelled) setError('Errore di rete durante il caricamento dettagli');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        run();
        return () => {
            cancelled = true;
        };
    }, [interventionId]);

    const customerName =
        details?.customer?.name ||
        details?.customerNameSnapshot ||
        fallbackIntervention.customer?.name ||
        fallbackIntervention.customerNameSnapshot ||
        'Cliente non disponibile';

    const physicalAddress =
        details?.customer?.physicalAddress ||
        details?.customer?.addressLine ||
        details?.customerAddressSnapshot ||
        fallbackIntervention.address;

    return (
        <div className="fixed inset-0 z-[110] bg-black/40 backdrop-blur-sm p-4 flex items-center justify-center" onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
        }}>
            <div className="glass-modal rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden border border-white/70">
                <div className="px-5 py-4 border-b border-white/60 bg-white/30 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h3 className="text-lg font-bold text-slate-800 truncate">{fallbackIntervention.title}</h3>
                        <p className="text-sm text-slate-500 truncate">{fallbackIntervention.address}</p>
                    </div>
                    <button onClick={onClose} className="glass-chip border border-white/70 rounded-full p-2 text-slate-600 hover:text-slate-800">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="p-5 space-y-4 overflow-y-auto max-h-[calc(90vh-80px)]">
                    <div className="flex flex-wrap gap-2">
                        <button onClick={onOpenWorkReport} className="btn-primary text-sm px-4 py-2">
                            Apri bolla
                        </button>
                        {fallbackIntervention.status === 'SCHEDULED' && (
                            <div className="glass-chip text-xs text-slate-500 border border-white/70 px-3 py-2">
                                Compila la bolla direttamente dalla card intervento
                            </div>
                        )}
                    </div>

                    {loading ? (
                        <div className="text-sm text-slate-600">Caricamento dettagli...</div>
                    ) : error ? (
                        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</div>
                    ) : (
                        <>
                            <section className="glass-card border border-white/70 rounded-2xl p-4 space-y-2">
                                <h4 className="font-semibold text-slate-800">Cliente e accesso</h4>
                                <div className="text-sm text-slate-700"><strong>Cliente:</strong> {customerName}</div>
                                {details?.description && <div className="text-sm text-slate-700"><strong>Descrizione:</strong> {details.description}</div>}
                                {physicalAddress && <div className="text-sm text-slate-700"><strong>Indirizzo fisico:</strong> {physicalAddress}</div>}
                                {details?.customer?.intercomInfo && <div className="text-sm text-slate-700"><strong>Citofono/Scala:</strong> {details.customer.intercomInfo}</div>}
                                {details?.customer?.intercomLabel && <div className="text-sm text-slate-700"><strong>Nome su citofono:</strong> {details.customer.intercomLabel}</div>}
                                {details?.customer?.notes && <div className="text-sm text-slate-700 whitespace-pre-wrap"><strong>Note cliente:</strong> {details.customer.notes}</div>}
                            </section>

                            <AttachmentListSection title="Allegati admin intervento" items={details?.attachments} />
                            <AttachmentListSection title="Allegati bolla di lavoro" items={details?.workReport?.attachments} />
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
