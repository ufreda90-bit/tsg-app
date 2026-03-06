import { useRef } from 'react';
import { Intervention } from '../types';
import { X, Edit2, FileText, Trash2, Calendar, MapPin, User, Clock, AlertTriangle, Copy } from 'lucide-react';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { cn } from '../lib/utils';
import { getStatusBadgeClasses, getStatusLabel } from '../lib/status';

interface Props {
    intervention: Intervention;
    onClose: () => void;
    onEdit: () => void;
    onOpenReport: () => void;
    onDuplicateAssign?: (anchorRect?: { left: number; top: number; width: number; height: number }) => void;
    isDuplicating?: boolean;
    onDelete: () => void;
    getTeamLabel?: (techId?: number | null) => string | null;
}

function getPriorityColor(p: string) {
    switch (p) {
        case 'URGENT': return 'bg-rose-50 text-rose-600 border-rose-100';
        case 'HIGH': return 'bg-amber-50 text-amber-700 border-amber-100';
        case 'MEDIUM': return 'bg-blue-50 text-blue-600 border-blue-100';
        case 'LOW': return 'bg-emerald-50 text-emerald-600 border-emerald-100';
        default: return 'bg-slate-50 text-slate-500 border-slate-200';
    }
}

export default function InterventionDetailModal({
    intervention,
    onClose,
    onEdit,
    onOpenReport,
    onDuplicateAssign,
    isDuplicating = false,
    onDelete,
    getTeamLabel
}: Props) {
    const duplicateBtnRef = useRef<HTMLButtonElement | null>(null);
    const handleDelete = () => {
        if (window.confirm(`Vuoi davvero eliminare l'intervento "${intervention.title}"?`)) {
            onDelete();
        }
    };
    const handleDuplicateAssignClick = () => {
        const rect = duplicateBtnRef.current?.getBoundingClientRect();
        onDuplicateAssign?.(
            rect
                ? {
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height
                }
                : undefined
        );
    };
    const teamLabel = getTeamLabel ? getTeamLabel(intervention.technicianId) : null;
    const googleMapsEmbedUrl = `https://www.google.com/maps?q=${encodeURIComponent(intervention.address || '')}&output=embed`;
    const googleMapsLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(intervention.address || '')}`;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/30 backdrop-blur-md">
            <div className="glass-modal rounded-3xl shadow-2xl max-w-lg w-full flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 border border-white/70">

                {/* Header */}
                <div className="px-6 py-4 border-b border-white/60 flex justify-between items-start bg-white/30">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            {intervention.status === 'IN_PROGRESS' ? (
                                <>
                                    <span className="badge-pill bg-amber-50 text-amber-700 border border-amber-100">
                                        INTERVENTO IN LAVORAZIONE
                                    </span>
                                    <span className="text-[10px] text-slate-500 font-medium italic">
                                        (In attesa sync tecnico)
                                    </span>
                                </>
                            ) : (
                                <span className={cn("badge-pill", getStatusBadgeClasses(intervention.status))}>
                                    {getStatusLabel(intervention.status)}
                                </span>
                            )}
                            <span className={cn("badge-pill", getPriorityColor(intervention.priority))}>
                                {intervention.priority}
                            </span>
                        </div>
                        <h3 className="font-bold text-xl text-slate-800">{intervention.title}</h3>
                    </div>
                    <button onClick={onClose} className="glass-chip border border-white/70 rounded-full p-2 text-slate-500 hover:text-slate-800 transition mt-1">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-5 overflow-y-auto max-h-[70vh] custom-scrollbar">

                    <div className="flex items-start gap-3">
                        <MapPin className="w-5 h-5 text-slate-400 mt-0.5" />
                        <div>
                            <p className="text-sm font-medium text-slate-700">Indirizzo</p>
                            <p className="text-sm text-slate-600">{intervention.address}</p>
                        </div>
                    </div>

                    <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-slate-400 mt-0.5" />
                        <div>
                            <p className="text-sm font-medium text-slate-700">Descrizione</p>
                            <p className="text-sm text-slate-600 whitespace-pre-wrap">{intervention.description || 'Nessuna descrizione'}</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t glass-divider pt-5">
                        <div className="flex items-start gap-3">
                            <User className="w-5 h-5 text-slate-400 mt-0.5" />
                            <div>
                                <p className="text-sm font-medium text-slate-700">Squadra</p>
                                <div className="text-sm text-slate-600 flex items-center gap-1.5 mt-0.5">
                                    {intervention.technician ? (
                                        <>
                                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: intervention.technician.color }}></div>
                                            {teamLabel || intervention.technician.name}
                                        </>
                                    ) : 'Da assegnare'}
                                </div>
                            </div>
                        </div>

                        <div className="flex items-start gap-3">
                            <Clock className="w-5 h-5 text-slate-400 mt-0.5" />
                            <div>
                                <p className="text-sm font-medium text-slate-700">Orario</p>
                                <p className="text-sm text-slate-600 mt-0.5">
                                    {intervention.startAt && intervention.endAt ? (
                                        <>
                                            {format(new Date(intervention.startAt), 'dd MMM HH:mm', { locale: it })}
                                            <br />
                                            Meno di {Math.max(1, Math.round((new Date(intervention.endAt).getTime() - new Date(intervention.startAt).getTime()) / 3600000))}h previste
                                        </>
                                    ) : 'Non pianificato'}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Customer Snapshot Info if present */}
                    {(intervention.customerNameSnapshot || intervention.customer) && (
                        <div className="glass-card p-4 rounded-2xl border border-white/70 mt-4">
                            <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Riferimenti Cliente</p>
                            <p className="text-sm font-medium text-slate-800">{intervention.customer?.name || intervention.customerNameSnapshot}</p>
                            {(intervention.customer?.email || intervention.customerEmailSnapshot) && (
                                <p className="text-sm text-slate-600">{intervention.customer?.email || intervention.customerEmailSnapshot}</p>
                            )}
                            {(intervention.customer?.phone || intervention.customerPhoneSnapshot) && (
                                <p className="text-sm text-slate-600">{intervention.customer?.phone || intervention.customerPhoneSnapshot}</p>
                            )}
                        </div>
                    )}

                    <div className="rounded-2xl border border-white/70 bg-white/70 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-slate-500 uppercase">Mappa</p>
                            <a
                                href={googleMapsLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                            >
                                Apri in Google Maps
                            </a>
                        </div>
                        <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                            <iframe
                                title={`Mappa intervento ${intervention.id}`}
                                src={googleMapsEmbedUrl}
                                className="h-48 w-full"
                                loading="lazy"
                                referrerPolicy="no-referrer-when-downgrade"
                            />
                        </div>
                    </div>

                </div>

                {/* Footer Actions */}
                <div className="px-6 py-4 bg-white/30 border-t border-white/60 flex-shrink-0">
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            onClick={handleDelete}
                            className="motion-premium inline-flex w-full justify-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 shadow-sm hover:border-red-300 hover:bg-red-100"
                        >
                            <Trash2 className="w-4 h-4" />
                            Elimina
                        </button>
                        <button
                            onClick={onEdit}
                            className="btn-secondary glass-chip w-full justify-center"
                        >
                            <Edit2 className="w-4 h-4" />
                            Modifica
                        </button>
                        <button
                            ref={duplicateBtnRef}
                            onClick={handleDuplicateAssignClick}
                            disabled={isDuplicating}
                            className="btn-secondary glass-chip w-full justify-center"
                        >
                            <Copy className="w-4 h-4" />
                            {isDuplicating ? 'Duplicazione...' : 'Duplica e assegna'}
                        </button>
                        <button
                            onClick={onOpenReport}
                            className="btn-primary w-full justify-center"
                        >
                            <FileText className="w-4 h-4" />
                            {intervention.workReport ? 'Vedi Bolla' : 'Apri Bolla'}
                        </button>
                    </div>
                </div>

            </div>
        </div>
    );
}
