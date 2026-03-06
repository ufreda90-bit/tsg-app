import { useMemo, useState } from 'react';
import AppLayout from '../components/AppLayout';
import {
  DEFAULT_PLANNER_PREFERENCES,
  loadPlannerPreferences,
  savePlannerPreferences,
  type PlannerAutoRefreshSeconds,
  type PlannerPreferences,
  type PlannerSlotMinutes
} from '../lib/plannerPreferences';
import { cn } from '../lib/utils';
import { toast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { Save, RotateCcw, LogOut } from 'lucide-react';
import { useTheme } from '../lib/useTheme';
import type { ThemeMode } from '../lib/theme';

type LocalSettings = {
  conflictToasts: boolean;
  urgentToasts: boolean;
  uiDensity: 'comfortable' | 'compact';
};

const APP_SETTINGS_STORAGE_KEY = 'app.settings.v1';

const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
  conflictToasts: true,
  urgentToasts: true,
  uiDensity: 'comfortable'
};

const THEME_OPTIONS: Array<{
  value: ThemeMode;
  label: string;
}> = [
  { value: 'system', label: 'Sistema' },
  { value: 'light', label: 'Chiaro' },
  { value: 'dark', label: 'Scuro' }
];

function loadLocalSettings(): LocalSettings {
  if (typeof window === 'undefined') return DEFAULT_LOCAL_SETTINGS;
  try {
    const raw = window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_LOCAL_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<LocalSettings>;
    return {
      conflictToasts: typeof parsed.conflictToasts === 'boolean' ? parsed.conflictToasts : DEFAULT_LOCAL_SETTINGS.conflictToasts,
      urgentToasts: typeof parsed.urgentToasts === 'boolean' ? parsed.urgentToasts : DEFAULT_LOCAL_SETTINGS.urgentToasts,
      uiDensity: parsed.uiDensity === 'compact' ? 'compact' : 'comfortable'
    };
  } catch {
    return DEFAULT_LOCAL_SETTINGS;
  }
}

function saveLocalSettings(next: LocalSettings) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(next));
}

export default function SettingsPage() {
  const { user, role, logout } = useAuth();
  const { mode: themeMode, effectiveTheme, setMode: setThemeMode } = useTheme();
  const [plannerPrefs, setPlannerPrefs] = useState<PlannerPreferences>(() => loadPlannerPreferences());
  const [localSettings, setLocalSettings] = useState<LocalSettings>(() => loadLocalSettings());
  const [isSaving, setIsSaving] = useState(false);
  const [savedHash, setSavedHash] = useState(() =>
    JSON.stringify({ planner: loadPlannerPreferences(), local: loadLocalSettings() })
  );

  const currentHash = useMemo(
    () => JSON.stringify({ planner: plannerPrefs, local: localSettings }),
    [plannerPrefs, localSettings]
  );

  const hasPendingChanges = savedHash !== currentHash;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      savePlannerPreferences(plannerPrefs);
      saveLocalSettings(localSettings);
      setSavedHash(JSON.stringify({ planner: plannerPrefs, local: localSettings }));
      toast.success('Preferenze salvate');
    } catch {
      toast.error('Errore salvataggio impostazioni');
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetDefaults = () => {
    setPlannerPrefs(DEFAULT_PLANNER_PREFERENCES);
    setLocalSettings(DEFAULT_LOCAL_SETTINGS);
    toast.info('Valori ripristinati ai default');
  };

  return (
    <AppLayout title="Impostazioni" subtitle="Preferenze operative e account" searchPlaceholder="Cerca impostazioni...">
      <div className="max-w-5xl mx-auto space-y-4">
        <section className="glass-card rounded-3xl border border-white/70 bg-white/60 p-5 sm:p-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Configuration</p>
            <h3 className="text-xl font-bold text-slate-800 mt-1">Impostazioni applicazione</h3>
            <p className="text-sm text-slate-600 mt-1">Le preferenze planner vengono applicate al prossimo accesso in pagina.</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleResetDefaults} className="btn-secondary glass-chip text-sm">
              <RotateCcw className="w-4 h-4" />
              Ripristina default
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!hasPendingChanges || isSaving}
              className={cn(
                'btn-primary text-sm px-5',
                !hasPendingChanges || isSaving ? 'opacity-60 cursor-not-allowed' : ''
              )}
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'Salvataggio...' : 'Salva impostazioni'}
            </button>
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <article className="glass-card rounded-2xl border border-white/70 p-4 space-y-3">
            <h4 className="text-base font-semibold text-slate-800">Planner</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-600">Vista default</span>
                <select
                  value={plannerPrefs.defaultView}
                  onChange={(event) =>
                    setPlannerPrefs((prev) => ({
                      ...prev,
                      defaultView: event.target.value === 'week' ? 'week' : 'day'
                    }))
                  }
                  className="glass-input rounded-xl px-3 py-2 text-sm"
                >
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-600">Slot minuti</span>
                <select
                  value={plannerPrefs.slotMinutes}
                  onChange={(event) =>
                    setPlannerPrefs((prev) => ({
                      ...prev,
                      slotMinutes: Number(event.target.value) as PlannerSlotMinutes
                    }))
                  }
                  className="glass-input rounded-xl px-3 py-2 text-sm"
                >
                  <option value={15}>15</option>
                  <option value={30}>30</option>
                  <option value={60}>60</option>
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-600">Inizio giornata</span>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={plannerPrefs.dayStartHour}
                  onChange={(event) => {
                    const next = Math.max(0, Math.min(23, Number(event.target.value) || 0));
                    setPlannerPrefs((prev) => ({
                      ...prev,
                      dayStartHour: next <= prev.dayEndHour ? next : prev.dayEndHour
                    }));
                  }}
                  className="glass-input rounded-xl px-3 py-2 text-sm"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-600">Fine giornata</span>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={plannerPrefs.dayEndHour}
                  onChange={(event) => {
                    const next = Math.max(0, Math.min(23, Number(event.target.value) || 23));
                    setPlannerPrefs((prev) => ({
                      ...prev,
                      dayEndHour: next >= prev.dayStartHour ? next : prev.dayStartHour
                    }));
                  }}
                  className="glass-input rounded-xl px-3 py-2 text-sm"
                />
              </label>

              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="text-xs font-semibold text-slate-600">Auto refresh</span>
                <select
                  value={plannerPrefs.autoRefreshSeconds}
                  onChange={(event) =>
                    setPlannerPrefs((prev) => ({
                      ...prev,
                      autoRefreshSeconds: Number(event.target.value) as PlannerAutoRefreshSeconds
                    }))
                  }
                  className="glass-input rounded-xl px-3 py-2 text-sm"
                >
                  <option value={0}>Disattivato</option>
                  <option value={30}>30 secondi</option>
                  <option value={60}>60 secondi</option>
                  <option value={120}>120 secondi</option>
                </select>
              </label>
            </div>
          </article>

          <article className="glass-card rounded-2xl border border-white/70 p-4 space-y-3">
            <h4 className="text-base font-semibold text-slate-800">Notifiche e aspetto</h4>
            <div className="space-y-2">
              <label className="flex items-center justify-between gap-2 rounded-xl border border-white/70 bg-white/45 px-3 py-2">
                <span className="text-sm text-slate-700">Toast conflitti planner</span>
                <input
                  type="checkbox"
                  checked={localSettings.conflictToasts}
                  onChange={(event) => setLocalSettings((prev) => ({ ...prev, conflictToasts: event.target.checked }))}
                  className="h-4 w-4 rounded border-white/70 accent-brand-500"
                />
              </label>
              <label className="flex items-center justify-between gap-2 rounded-xl border border-white/70 bg-white/45 px-3 py-2">
                <span className="text-sm text-slate-700">Notifiche urgenze</span>
                <input
                  type="checkbox"
                  checked={localSettings.urgentToasts}
                  onChange={(event) => setLocalSettings((prev) => ({ ...prev, urgentToasts: event.target.checked }))}
                  className="h-4 w-4 rounded border-white/70 accent-brand-500"
                />
              </label>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-600">Densità UI</p>
              <div className="glass-chip rounded-2xl border border-white/70 p-1 flex items-center gap-1">
                {(['comfortable', 'compact'] as const).map((density) => (
                  <button
                    key={density}
                    type="button"
                    onClick={() => setLocalSettings((prev) => ({ ...prev, uiDensity: density }))}
                    className={cn(
                      'flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition',
                      localSettings.uiDensity === density
                        ? 'bg-white text-brand-700 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    )}
                  >
                    {density === 'comfortable' ? 'Comfort' : 'Compatta'}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                Modalità attuale: {localSettings.uiDensity === 'comfortable' ? 'Comfort' : 'Compatta'}
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-600">Aspetto</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {THEME_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={cn(
                      'rounded-xl border px-3 py-3 flex gap-2 items-center cursor-pointer',
                      themeMode === option.value
                        ? 'border-brand-300 bg-brand-50/70'
                        : 'border-white/70 bg-white/45'
                    )}
                  >
                    <input
                      type="radio"
                      name="theme-mode"
                      value={option.value}
                      checked={themeMode === option.value}
                      onChange={() => setThemeMode(option.value)}
                      className="mt-0.5 h-4 w-4 accent-brand-500"
                    />
                    <span className="min-w-0">
                      <span
                        className={cn(
                          'block text-sm font-semibold',
                          themeMode === option.value ? 'text-[#0f172a]' : 'text-slate-700'
                        )}
                      >
                        {option.label}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                Tema attivo: {effectiveTheme === 'dark' ? 'Scuro' : 'Chiaro'} ({themeMode === 'system' ? 'Sistema' : themeMode === 'dark' ? 'Scuro' : 'Chiaro'})
              </p>
            </div>
          </article>
        </section>

        <section className="glass-card rounded-2xl border border-white/70 p-4 space-y-3">
          <h4 className="text-base font-semibold text-slate-800">Account</h4>
          <div className="rounded-xl border border-white/70 bg-white/45 px-3 py-3 text-sm text-slate-700 space-y-1">
            <p><span className="font-semibold">Utente:</span> {user?.name || 'N/D'}</p>
            <p><span className="font-semibold">Ruolo:</span> {role || 'N/D'}</p>
          </div>
          <button type="button" onClick={() => void logout()} className="btn-secondary glass-chip text-sm">
            <LogOut className="w-4 h-4" />
            Esci
          </button>
        </section>
      </div>
    </AppLayout>
  );
}
