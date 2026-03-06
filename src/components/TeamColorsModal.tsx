import { useState } from 'react';
import { X, Save } from 'lucide-react';
import { Team } from '../types';
import { apiFetch } from '../lib/apiFetch';

type Props = {
  teams: Team[];
  onClose: () => void;
  onRefresh: () => void | Promise<void>;
};

const DEFAULT_TEAM_COLOR = '#3b82f6';

function normalizeColor(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_TEAM_COLOR;
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

async function parseApiErrorMessage(res: Response, fallback: string) {
  try {
    const payload = await res.clone().json();
    if (payload && typeof payload === 'object') {
      const message =
        (typeof payload.message === 'string' && payload.message.trim()) ||
        (typeof payload.error === 'string' && payload.error.trim()) ||
        '';
      if (message) return message;
    }
  } catch {
    // ignore
  }

  try {
    const text = await res.clone().text();
    if (text.trim()) return text.trim();
  } catch {
    // ignore
  }

  return `${fallback} (HTTP ${res.status})`;
}

export default function TeamColorsModal({ teams, onClose, onRefresh }: Props) {
  const [colors, setColors] = useState<Record<number, string>>(
    Object.fromEntries(teams.map((team) => [team.id, normalizeColor(team.color || DEFAULT_TEAM_COLOR)]))
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const team of teams) {
        const currentColor = normalizeColor(team.color || DEFAULT_TEAM_COLOR);
        const nextColor = normalizeColor(colors[team.id] || DEFAULT_TEAM_COLOR);
        if (nextColor === currentColor) continue;

        const res = await apiFetch(`/api/teams/${team.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ color: nextColor })
        });

        if (!res.ok) {
          throw new Error(await parseApiErrorMessage(res, 'Errore salvataggio colori squadre'));
        }
      }

      await onRefresh();
      onClose();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Errore salvataggio colori squadre');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/30 backdrop-blur-md">
      <div className="glass-modal rounded-3xl shadow-2xl max-w-sm w-full flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 border border-white/70">
        <div className="px-6 py-4 border-b border-white/60 flex justify-between items-center bg-white/30">
          <h3 className="font-bold text-lg text-slate-800">Colori Squadre</h3>
          <button onClick={onClose} className="glass-chip border border-white/70 rounded-full p-2 text-slate-500 hover:text-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto w-full custom-scrollbar">
          {teams.map((team) => (
            <div key={team.id} className="flex items-center justify-between border-b glass-divider pb-3 last:border-0 last:pb-0">
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-full border border-white/70 shadow-sm"
                  style={{ backgroundColor: colors[team.id] || DEFAULT_TEAM_COLOR }}
                />
                <label className="text-sm font-semibold text-slate-700">{team.name}</label>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500 uppercase w-16 text-right font-mono">{colors[team.id]}</span>
                <input
                  type="color"
                  value={colors[team.id]}
                  onChange={(event) => setColors((prev) => ({ ...prev, [team.id]: event.target.value }))}
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
