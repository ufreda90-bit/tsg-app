import { Technician } from '../types';
import { X, Save } from 'lucide-react';
import { useState } from 'react';
import { apiFetch } from '../lib/apiFetch';

interface Props {
    technicians: Technician[];
    onClose: () => void;
    onRefresh: () => void;
}

export default function TechnicianColorsModal({ technicians, onClose, onRefresh }: Props) {
    const [colors, setColors] = useState<Record<number, string>>(
        Object.fromEntries(technicians.map(t => [t.id, t.color]))
    );
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        setSaving(true);
        try {
            for (const t of technicians) {
                if (colors[t.id] !== t.color) {
                    await apiFetch(`/api/technicians/${t.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ color: colors[t.id] })
                    });
                }
            }
            onRefresh();
            onClose();
        } catch {
            alert("Errore salvataggio colori");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/30 backdrop-blur-md">
            <div className="glass-modal rounded-3xl shadow-2xl max-w-sm w-full flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 border border-white/70">
                <div className="px-6 py-4 border-b border-white/60 flex justify-between items-center bg-white/30">
                    <h3 className="font-bold text-lg text-slate-800">Colori Tecnici</h3>
                    <button onClick={onClose} className="glass-chip border border-white/70 rounded-full p-2 text-slate-500 hover:text-slate-800 transition">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto w-full custom-scrollbar">
                    {technicians.map(t => (
                        <div key={t.id} className="flex items-center justify-between border-b glass-divider pb-3 last:border-0 last:pb-0">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full border border-white/70 shadow-sm" style={{ backgroundColor: colors[t.id] || '#e2e8f0' }} />
                                <label className="text-sm font-semibold text-slate-700">{t.name}</label>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="text-xs text-slate-500 uppercase w-16 text-right font-mono">{colors[t.id]}</span>
                                <input
                                    type="color"
                                    value={colors[t.id]}
                                    onChange={e => setColors(prev => ({ ...prev, [t.id]: e.target.value }))}
                                    className="w-10 h-10 border-0 p-0 rounded-full cursor-pointer"
                                />
                            </div>
                        </div>
                    ))}
                </div>
                <div className="px-6 py-4 bg-white/30 border-t border-white/60 flex justify-end gap-3 flex-shrink-0">
                    <button onClick={onClose} className="btn-secondary glass-chip">Annulla</button>
                    <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
                        <Save className="w-4 h-4" /> {saving ? 'Salvataggio...' : 'Salva'}
                    </button>
                </div>
            </div>
        </div>
    );
}
