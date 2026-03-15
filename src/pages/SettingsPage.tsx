import { useEffect, useMemo, useState } from 'react';
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
import { apiFetch, extractErrorMessage } from '../lib/apiFetch';
import { toast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { Save, RotateCcw, LogOut } from 'lucide-react';
import { useTheme } from '../lib/useTheme';
import type { ThemeMode } from '../lib/theme';
import type { ManagedUser, Technician, UserRoleValue } from '../types';

type LocalSettings = {
  conflictToasts: boolean;
  urgentToasts: boolean;
  uiDensity: 'comfortable' | 'compact';
};

type UserFormState = {
  username: string;
  email: string;
  password: string;
  role: UserRoleValue;
  technicianId: number | null;
  isActive: boolean;
};

const APP_SETTINGS_STORAGE_KEY = 'app.settings.v1';

const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
  conflictToasts: true,
  urgentToasts: true,
  uiDensity: 'comfortable'
};

const DEFAULT_USER_FORM: UserFormState = {
  username: '',
  email: '',
  password: '',
  role: 'DISPATCHER',
  technicianId: null,
  isActive: true
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
  const { user, role: persistentRole, activeRole, logout } = useAuth();
  const { mode: themeMode, effectiveTheme, setMode: setThemeMode } = useTheme();
  const isAdmin = activeRole === 'ADMIN';
  const [plannerPrefs, setPlannerPrefs] = useState<PlannerPreferences>(() => loadPlannerPreferences());
  const [localSettings, setLocalSettings] = useState<LocalSettings>(() => loadLocalSettings());
  const [isSaving, setIsSaving] = useState(false);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [techniciansLoading, setTechniciansLoading] = useState(false);
  const [isSavingUser, setIsSavingUser] = useState(false);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [userForm, setUserForm] = useState<UserFormState>(DEFAULT_USER_FORM);
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

  const loadUsers = async () => {
    if (!isAdmin) return;
    setUsersLoading(true);
    try {
      const res = await apiFetch('/api/users');
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(extractErrorMessage(data));
        return;
      }
      setUsers(Array.isArray(data) ? data : []);
    } catch {
      toast.error('Errore caricamento utenti');
    } finally {
      setUsersLoading(false);
    }
  };

  const loadTechnicians = async () => {
    if (!isAdmin) return;
    setTechniciansLoading(true);
    try {
      const res = await apiFetch('/api/technicians');
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(extractErrorMessage(data));
        return;
      }
      setTechnicians(Array.isArray(data) ? data : []);
    } catch {
      toast.error('Errore caricamento tecnici');
    } finally {
      setTechniciansLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    void loadUsers();
    void loadTechnicians();
  }, [isAdmin]);

  const resetUserForm = () => {
    setEditingUserId(null);
    setUserForm(DEFAULT_USER_FORM);
  };

  const startEditUser = (target: ManagedUser) => {
    setEditingUserId(target.id);
    setUserForm({
      username: target.username || '',
      email: target.email || '',
      password: '',
      role: target.role,
      technicianId: target.technicianId ?? null,
      isActive: target.isActive
    });
  };

  const handleSubmitUser = async () => {
    if (!isAdmin) return;
    const username = userForm.username.trim();
    if (!username) {
      toast.error('Username obbligatorio');
      return;
    }
    if (!editingUserId && userForm.password.trim().length < 8) {
      toast.error('Password minima 8 caratteri');
      return;
    }
    if (userForm.role === 'TECHNICIAN' && !userForm.technicianId) {
      toast.error('Seleziona un tecnico per il ruolo TECHNICIAN');
      return;
    }

    setIsSavingUser(true);
    try {
      const payload: Record<string, unknown> = {
        username,
        email: userForm.email.trim() || null,
        role: userForm.role,
        technicianId: userForm.role === 'TECHNICIAN' ? userForm.technicianId : null,
        isActive: userForm.isActive
      };
      if (editingUserId) {
        if (userForm.password.trim()) {
          payload.password = userForm.password;
        }
      } else {
        payload.password = userForm.password;
      }

      const res = await apiFetch(editingUserId ? `/api/users/${editingUserId}` : '/api/users', {
        method: editingUserId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(extractErrorMessage(data));
        return;
      }
      toast.success(editingUserId ? 'Utente aggiornato' : 'Utente creato');
      resetUserForm();
      await loadUsers();
    } catch {
      toast.error('Errore salvataggio utente');
    } finally {
      setIsSavingUser(false);
    }
  };

  const handleDeleteUser = async (target: ManagedUser) => {
    if (!isAdmin) return;
    if (!window.confirm(`Eliminare l'utente ${target.username || target.name}?`)) {
      return;
    }
    try {
      const res = await apiFetch(`/api/users/${target.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(extractErrorMessage(data));
        return;
      }
      toast.success('Utente eliminato');
      if (editingUserId === target.id) {
        resetUserForm();
      }
      await loadUsers();
    } catch {
      toast.error('Errore eliminazione utente');
    }
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

        {isAdmin && (
          <section className="glass-card rounded-2xl border border-white/70 p-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-base font-semibold text-slate-800">Utenti</h4>
              <button
                type="button"
                onClick={() => void loadUsers()}
                className="btn-secondary glass-chip text-sm"
                disabled={usersLoading}
              >
                {usersLoading ? 'Aggiornamento...' : 'Ricarica lista'}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-600">Username</span>
                <input
                  type="text"
                  value={userForm.username}
                  onChange={(event) => setUserForm((prev) => ({ ...prev, username: event.target.value }))}
                  className="glass-input rounded-xl px-3 py-2 text-sm"
                  placeholder="username"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-600">Email</span>
                <input
                  type="email"
                  value={userForm.email}
                  onChange={(event) => setUserForm((prev) => ({ ...prev, email: event.target.value }))}
                  className="glass-input rounded-xl px-3 py-2 text-sm"
                  placeholder="utente@azienda.it"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-600">
                  Password {editingUserId ? '(lascia vuoto per non cambiarla)' : ''}
                </span>
                <input
                  type="password"
                  value={userForm.password}
                  onChange={(event) => setUserForm((prev) => ({ ...prev, password: event.target.value }))}
                  className="glass-input rounded-xl px-3 py-2 text-sm"
                  placeholder={editingUserId ? 'Nuova password (opzionale)' : 'Password'}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-600">Ruolo</span>
                <select
                  value={userForm.role}
                  onChange={(event) =>
                    setUserForm((prev) => {
                      const nextRole = event.target.value as UserRoleValue;
                      return {
                        ...prev,
                        role: nextRole,
                        technicianId: nextRole === 'TECHNICIAN' ? prev.technicianId : null
                      };
                    })
                  }
                  className="glass-input rounded-xl px-3 py-2 text-sm"
                >
                  <option value="ADMIN">ADMIN</option>
                  <option value="DISPATCHER">DISPATCHER</option>
                  <option value="TECHNICIAN">TECHNICIAN</option>
                </select>
              </label>
              {userForm.role === 'TECHNICIAN' ? (
                <label className="flex flex-col gap-1.5 md:col-span-2">
                  <span className="text-xs font-semibold text-slate-600">Tecnico collegato</span>
                  <select
                    value={userForm.technicianId ?? ''}
                    onChange={(event) =>
                      setUserForm((prev) => ({
                        ...prev,
                        technicianId: event.target.value ? Number(event.target.value) : null
                      }))
                    }
                    className="glass-input rounded-xl px-3 py-2 text-sm"
                    disabled={techniciansLoading}
                  >
                    <option value="">Seleziona tecnico</option>
                    {technicians.map((technician) => (
                      <option key={technician.id} value={technician.id}>
                        {technician.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>

            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={userForm.isActive}
                onChange={(event) => setUserForm((prev) => ({ ...prev, isActive: event.target.checked }))}
                className="h-4 w-4 rounded border-white/70 accent-brand-500"
              />
              Utente attivo
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleSubmitUser()}
                disabled={isSavingUser}
                className={cn(
                  'btn-primary text-sm',
                  isSavingUser ? 'opacity-60 cursor-not-allowed' : ''
                )}
              >
                {isSavingUser ? 'Salvataggio...' : editingUserId ? 'Aggiorna utente' : 'Crea utente'}
              </button>
              {editingUserId ? (
                <button type="button" onClick={resetUserForm} className="btn-secondary glass-chip text-sm">
                  Annulla modifica
                </button>
              ) : null}
            </div>

            <div className="rounded-xl border border-white/70 bg-white/45 overflow-x-auto">
              {usersLoading ? (
                <p className="px-4 py-3 text-sm text-slate-600">Caricamento utenti...</p>
              ) : users.length === 0 ? (
                <p className="px-4 py-3 text-sm text-slate-600">Nessun utente trovato.</p>
              ) : (
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-600 border-b border-white/70">
                      <th className="px-3 py-2 font-semibold">Username</th>
                      <th className="px-3 py-2 font-semibold">Email</th>
                      <th className="px-3 py-2 font-semibold">Ruolo</th>
                      <th className="px-3 py-2 font-semibold">Stato</th>
                      <th className="px-3 py-2 font-semibold">Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((managedUser) => (
                      <tr key={managedUser.id} className="border-b border-white/60 last:border-b-0 text-slate-700">
                        <td className="px-3 py-2">{managedUser.username || '-'}</td>
                        <td className="px-3 py-2">{managedUser.email || '-'}</td>
                        <td className="px-3 py-2">{managedUser.role}</td>
                        <td className="px-3 py-2">{managedUser.isActive ? 'Attivo' : 'Disattivo'}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => startEditUser(managedUser)} className="btn-secondary glass-chip text-xs">
                              Modifica
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteUser(managedUser)}
                              className="rounded-lg border border-rose-300/80 bg-rose-50/80 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                              disabled={managedUser.id === user?.id}
                              title={managedUser.id === user?.id ? 'Non puoi eliminare l’utente corrente' : 'Elimina utente'}
                            >
                              Elimina
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        )}

        <section className="glass-card rounded-2xl border border-white/70 p-4 space-y-3">
          <h4 className="text-base font-semibold text-slate-800">Account</h4>
          <div className="rounded-xl border border-white/70 bg-white/45 px-3 py-3 text-sm text-slate-700 space-y-1">
            <p><span className="font-semibold">Utente:</span> {user?.name || 'N/D'}</p>
            <p><span className="font-semibold">Ruolo:</span> {persistentRole || 'N/D'}</p>
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
