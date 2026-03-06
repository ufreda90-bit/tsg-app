import { useEffect, useMemo, useRef, useState } from 'react';
import AppLayout from '../components/AppLayout';
import { apiFetch } from '../lib/apiFetch';
import { Team, Technician } from '../types';
import { cn } from '../lib/utils';
import { Plus, Pencil, Trash2, RefreshCw, Users, CheckCircle2, Info } from 'lucide-react';
import { toast } from '../components/Toast';
import { useModalRegistration } from '../components/ModalStackProvider';

type TeamFormState = {
  name: string;
  color: string;
  memberIds: number[];
  isActive: boolean;
  capacityPerDay: string;
  notes: string;
};

type TechnicianFormState = {
  name: string;
  email: string;
  phone: string;
  skills: string;
  color: string;
};

const DEFAULT_TEAM_COLOR = '#3b82f6';
const INITIAL_TECHNICIAN_FORM: TechnicianFormState = {
  name: '',
  email: '',
  phone: '',
  skills: '',
  color: DEFAULT_TEAM_COLOR
};
const DEMO_TEAMS: Team[] = [
  {
    id: -1,
    name: 'Team Alfa',
    color: '#3b82f6',
    isActive: true,
    capacityPerDay: 4,
    notes: 'Manutenzione ordinaria',
    memberIds: [],
    members: [],
    memberCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: -2,
    name: 'Team Beta',
    color: '#10b981',
    isActive: true,
    capacityPerDay: 6,
    notes: 'Installazioni e impianti',
    memberIds: [],
    members: [],
    memberCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: -3,
    name: 'Team Gamma',
    color: '#f59e0b',
    isActive: false,
    capacityPerDay: 2,
    notes: 'Interventi speciali',
    memberIds: [],
    members: [],
    memberCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

function buildInitialForm(team?: Team | null): TeamFormState {
  if (!team) {
    return {
      name: '',
      color: DEFAULT_TEAM_COLOR,
      memberIds: [],
      isActive: true,
      capacityPerDay: '',
      notes: ''
    };
  }
  return {
    name: team.name,
    color: team.color || DEFAULT_TEAM_COLOR,
    memberIds: team.memberIds || [],
    isActive: team.isActive,
    capacityPerDay: team.capacityPerDay ? String(team.capacityPerDay) : '',
    notes: team.notes || ''
  };
}

function normalizeColor(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_TEAM_COLOR;
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

async function parseApiErrorMessage(res: Response, fallback: string) {
  let message = '';
  try {
    const payload = await res.clone().json();
    message =
      (typeof payload?.message === 'string' && payload.message.trim()) ||
      (typeof payload?.error === 'string' && payload.error.trim()) ||
      '';
  } catch {
    message = '';
  }

  if (!message) {
    const text = await res.clone().text().catch(() => '');
    if (text.trim()) {
      message = text.trim();
    }
  }

  return message || `${fallback} (HTTP ${res.status})`;
}

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [form, setForm] = useState<TeamFormState>(() => buildInitialForm());
  const [memberSearch, setMemberSearch] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [deletingTeamId, setDeletingTeamId] = useState<number | null>(null);
  const [newTechnician, setNewTechnician] = useState<TechnicianFormState>(INITIAL_TECHNICIAN_FORM);
  const [isCreatingTechnician, setIsCreatingTechnician] = useState(false);
  const newTechnicianNameInputRef = useRef<HTMLInputElement | null>(null);
  const membersSectionRef = useRef<HTMLElement | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const [teamsRes, techniciansRes] = await Promise.all([
        apiFetch('/api/teams'),
        apiFetch('/api/technicians')
      ]);

      if (!teamsRes.ok || !techniciansRes.ok) {
        const failed = !teamsRes.ok ? teamsRes : techniciansRes;
        const payload = await failed.clone().json().catch(() => null);
        const message = typeof payload?.error === 'string' ? payload.error : 'Errore caricamento dati squadre';
        throw new Error(message);
      }

      const [teamsData, techniciansData] = await Promise.all([
        teamsRes.json().catch(() => []),
        techniciansRes.json().catch(() => [])
      ]);

      setTeams(Array.isArray(teamsData) ? teamsData : []);
      setTechnicians(Array.isArray(techniciansData) ? techniciansData : []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore caricamento dati squadre';
      setLoadError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const sortedTechnicians = useMemo(
    () => [...technicians].sort((a, b) => a.name.localeCompare(b.name, 'it')),
    [technicians]
  );

  const filteredTechnicians = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    if (!query) return sortedTechnicians;
    return sortedTechnicians.filter((technician) => technician.name.toLowerCase().includes(query));
  }, [memberSearch, sortedTechnicians]);

  const filteredTeams = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return teams;
    return teams.filter((team) => {
      const membersText = team.members.map((member) => member.name).join(' ').toLowerCase();
      return (
        team.name.toLowerCase().includes(query) ||
        (team.notes || '').toLowerCase().includes(query) ||
        membersText.includes(query)
      );
    });
  }, [searchQuery, teams]);
  const isDev = import.meta.env.DEV === true;
  const shouldUseDemoTeams = isDev && teams.length === 0 && filteredTeams.length === 0 && !isLoading && !loadError;
  const teamsToRender = shouldUseDemoTeams ? DEMO_TEAMS : filteredTeams;

  const openCreateModal = () => {
    setEditingTeam(null);
    setForm(buildInitialForm());
    setMemberSearch('');
    setIsModalOpen(true);
  };

  const openEditModal = (team: Team) => {
    setEditingTeam(team);
    setForm(buildInitialForm(team));
    setMemberSearch('');
    setIsModalOpen(true);
  };

  const closeModal = () => {
    if (isSaving) return;
    setIsModalOpen(false);
    setEditingTeam(null);
    setForm(buildInitialForm());
    setMemberSearch('');
  };

  useModalRegistration({
    id: 'teams-form-modal',
    isOpen: isModalOpen,
    onClose: closeModal,
    options: {
      closeOnEsc: true,
      blockEscWhenEditing: true,
      priority: 100
    }
  });

  const toggleMember = (technicianId: number) => {
    setForm((prev) => {
      const exists = prev.memberIds.includes(technicianId);
      return {
        ...prev,
        memberIds: exists
          ? prev.memberIds.filter((id) => id !== technicianId)
          : [...prev.memberIds, technicianId]
      };
    });
  };

  const handleSave = async () => {
    const name = form.name.trim();
    if (!name) {
      toast.error('Il nome squadra è obbligatorio');
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        name,
        color: normalizeColor(form.color),
        memberIds: form.memberIds,
        isActive: form.isActive,
        capacityPerDay: form.capacityPerDay ? Number(form.capacityPerDay) : null,
        notes: form.notes.trim() || null
      };

      if (payload.capacityPerDay !== null && (!Number.isFinite(payload.capacityPerDay) || payload.capacityPerDay <= 0)) {
        toast.error('Capienza giornaliera non valida');
        return;
      }

      const isEdit = Boolean(editingTeam);
      const endpoint = isEdit ? `/api/teams/${editingTeam?.id}` : '/api/teams';
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await apiFetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const apiError = await res.clone().json().catch(() => null);
        const message =
          (typeof apiError?.error === 'string' && apiError.error) ||
          `Errore salvataggio squadra (HTTP ${res.status})`;
        toast.error(message);
        return;
      }

      const savedTeam = await res.json().catch(() => null);
      if (!savedTeam || typeof savedTeam.id !== 'number') {
        toast.error('Risposta salvataggio non valida');
        return;
      }

      setTeams((prev) => {
        const exists = prev.some((team) => team.id === savedTeam.id);
        if (exists) {
          return prev.map((team) => (team.id === savedTeam.id ? savedTeam : team));
        }
        return [savedTeam, ...prev];
      });
      toast.success(isEdit ? 'Squadra aggiornata' : 'Squadra creata');
      closeModal();
    } catch {
      toast.error('Errore di rete durante il salvataggio');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (team: Team) => {
    const confirmed = window.confirm(`Eliminare la squadra "${team.name}"?`);
    if (!confirmed) return;

    setDeletingTeamId(team.id);
    try {
      const res = await apiFetch(`/api/teams/${team.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const apiError = await res.clone().json().catch(() => null);
        const message =
          (typeof apiError?.error === 'string' && apiError.error) ||
          `Errore eliminazione squadra (HTTP ${res.status})`;
        toast.error(message);
        return;
      }

      setTeams((prev) => prev.filter((item) => item.id !== team.id));
      toast.success('Squadra eliminata');
    } catch {
      toast.error('Errore di rete durante eliminazione squadra');
    } finally {
      setDeletingTeamId(null);
    }
  };

  const handleCreateTechnician = async () => {
    if (isCreatingTechnician) return;

    const name = newTechnician.name.trim();
    if (!name) {
      toast.error('Il nome impiegato è obbligatorio');
      return;
    }

    setIsCreatingTechnician(true);
    try {
      const payload = {
        name,
        email: newTechnician.email.trim() || null,
        phone: newTechnician.phone.trim() || null,
        skills: newTechnician.skills.trim() || null,
        color: normalizeColor(newTechnician.color),
        isActive: true
      };
      const res = await apiFetch('/api/technicians', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        toast.error(await parseApiErrorMessage(res, 'Errore creazione impiegato'));
        return;
      }

      setNewTechnician(INITIAL_TECHNICIAN_FORM);
      toast.success('Impiegato creato');
      await loadData();
      requestAnimationFrame(() => {
        newTechnicianNameInputRef.current?.focus();
      });
    } catch {
      toast.error('Errore di rete durante creazione impiegato');
    } finally {
      setIsCreatingTechnician(false);
    }
  };

  const handleFocusMemberForm = () => {
    membersSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    requestAnimationFrame(() => {
      newTechnicianNameInputRef.current?.focus();
    });
  };

  return (
    <AppLayout
      title="Squadre"
      subtitle="Gestione operativa team e membri"
      searchPlaceholder="Cerca squadre..."
      onSearchChange={setSearchQuery}
    >
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)] gap-4 lg:gap-6 items-start">
        <div className="space-y-4">
          <section ref={membersSectionRef} className="glass-card rounded-3xl border border-white/70 bg-white/60 p-5 sm:p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">OPERAZIONI</p>
            <h3 className="mt-1 text-xl font-bold text-slate-800">Crea nuova squadra</h3>
            <p className="text-sm text-slate-600 mt-1">
              Avvia una nuova squadra operativa e configura membri, capienza e note dalla modale dedicata.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button type="button" onClick={openCreateModal} className="btn-primary text-sm">
                <Plus className="w-4 h-4" />
                Crea squadra
              </button>
            </div>
          </section>

          <section className="glass-card rounded-3xl border border-white/70 bg-white/60 p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">MEMBRI</p>
                <h4 className="mt-1 text-lg font-bold text-slate-800">Aggiungi nuovo impiegato</h4>
                <p className="text-sm text-slate-600 mt-1">Crea un nuovo membro per assegnarlo alle squadre.</p>
              </div>
            </div>

            <form
              className="mt-4 grid grid-cols-1 gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreateTechnician();
              }}
            >
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-600">Nome *</span>
                <input
                  ref={newTechnicianNameInputRef}
                  value={newTechnician.name}
                  onChange={(event) => setNewTechnician((prev) => ({ ...prev, name: event.target.value }))}
                  className="glass-input rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400/30"
                  placeholder="Es. Mario Rossi"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-600">Email</span>
                <input
                  type="email"
                  value={newTechnician.email}
                  onChange={(event) => setNewTechnician((prev) => ({ ...prev, email: event.target.value }))}
                  className="glass-input rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400/30"
                  placeholder="nome@azienda.it"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-600">Telefono</span>
                <input
                  value={newTechnician.phone}
                  onChange={(event) => setNewTechnician((prev) => ({ ...prev, phone: event.target.value }))}
                  className="glass-input rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400/30"
                  placeholder="+39 ..."
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-600">Skills</span>
                <input
                  value={newTechnician.skills}
                  onChange={(event) => setNewTechnician((prev) => ({ ...prev, skills: event.target.value }))}
                  className="glass-input rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400/30"
                  placeholder="Es. caldaie, climatizzazione"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-600">Colore</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={normalizeColor(newTechnician.color)}
                    onChange={(event) => setNewTechnician((prev) => ({ ...prev, color: event.target.value }))}
                    className="h-10 w-12 rounded-lg border border-white/70 bg-white/80"
                    aria-label="Seleziona colore impiegato"
                  />
                  <input
                    value={newTechnician.color}
                    onChange={(event) => setNewTechnician((prev) => ({ ...prev, color: event.target.value }))}
                    className="glass-input rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400/30 flex-1"
                    placeholder="#3b82f6"
                  />
                </div>
              </label>

              <div className="flex items-end md:justify-end">
                <button
                  type="submit"
                  disabled={isCreatingTechnician}
                  className={cn(
                    'btn-primary text-sm px-5 py-2.5',
                    isCreatingTechnician ? 'opacity-60 cursor-not-allowed' : ''
                  )}
                >
                  {isCreatingTechnician ? 'Creazione...' : 'Aggiungi impiegato'}
                </button>
              </div>
            </form>
          </section>
        </div>

        <section className="glass-card rounded-3xl border border-white/70 bg-white/60 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">SQUADRE</p>
              <h3 className="mt-1 text-xl font-bold text-slate-800">Modifica squadra</h3>
              <p className="text-sm text-slate-600 mt-1">Cerca una squadra esistente e gestisci configurazione e membri.</p>
              <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/55 px-2.5 py-1 text-[11px] text-slate-600">
                <Info className="w-3.5 h-3.5" />
                Tip: clicca una card per modificarla.
              </span>
            </div>
            <button
              type="button"
              onClick={() => void loadData()}
              disabled={isLoading}
              className={cn('btn-secondary glass-chip text-sm', isLoading ? 'opacity-60 cursor-not-allowed' : '')}
            >
              <RefreshCw className={cn('w-4 h-4', isLoading ? 'animate-spin' : '')} />
              Aggiorna
            </button>
          </div>

          <div className="mt-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-600">Ricerca squadre</span>
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="glass-input rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400/30"
                placeholder="Cerca per nome, note o membro..."
              />
            </label>
          </div>

          {loadError ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50/80 p-4">
              <p className="text-sm font-semibold text-rose-700">Errore caricamento squadre</p>
              <p className="text-sm text-rose-600 mt-1">{loadError}</p>
              <button type="button" onClick={() => void loadData()} className="mt-3 btn-secondary text-sm">
                Riprova
              </button>
            </div>
          ) : null}

          {isLoading ? (
            <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((idx) => (
                <div key={idx} className="rounded-2xl border border-white/70 p-4 animate-pulse space-y-3 bg-white/45">
                  <div className="h-4 bg-slate-200/70 rounded w-1/2" />
                  <div className="h-3 bg-slate-200/70 rounded w-2/3" />
                  <div className="h-3 bg-slate-200/60 rounded w-full" />
                </div>
              ))}
            </div>
          ) : null}

          {!isLoading && !loadError && teamsToRender.length === 0 && teams.length === 0 ? (
            <div className="mt-4 rounded-3xl border border-white/70 bg-white/45 p-6 sm:p-8">
              <p className="text-slate-800 text-xl font-bold">Nessuna squadra ancora</p>
              <p className="text-sm text-slate-600 mt-2">Crea la prima squadra e assegna i membri.</p>
              <span className="mt-3 inline-flex items-center rounded-full border border-white/70 bg-white/55 px-3 py-1 text-[11px] text-slate-600">
                Suggerimento: inizia dai membri.
              </span>
              <ul className="mt-4 space-y-2.5 text-sm text-slate-600">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 text-slate-600 shrink-0" />
                  <span>Crea la squadra</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 text-slate-600 shrink-0" />
                  <span>Aggiungi i membri</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 text-slate-600 shrink-0" />
                  <span>Assegna i primi interventi</span>
                </li>
              </ul>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <button type="button" onClick={openCreateModal} className="btn-primary text-sm">
                  <Plus className="w-4 h-4" />
                  Crea la prima squadra
                </button>
                <button type="button" onClick={handleFocusMemberForm} className="btn-secondary glass-chip text-sm">
                  Aggiungi impiegato
                </button>
              </div>
            </div>
          ) : null}

          {!isLoading && !loadError && teamsToRender.length === 0 && teams.length > 0 ? (
            <div className="mt-4 rounded-3xl border border-white/70 bg-white/45 p-8 text-center">
              <p className="text-slate-700 font-semibold">Nessuna squadra corrisponde alla ricerca</p>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="btn-secondary glass-chip mt-4 text-sm"
              >
                Reset ricerca
              </button>
            </div>
          ) : null}

          {!isLoading && !loadError && teamsToRender.length > 0 ? (
            <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-3">
              {shouldUseDemoTeams ? (
                <div className="xl:col-span-2">
                  <span className="glass-chip inline-flex items-center gap-1.5 text-xs px-3 py-1.5">
                    Modalità demo attiva
                  </span>
                </div>
              ) : null}
              {teamsToRender.map((team) => (
                <article key={team.id} className="rounded-2xl border border-white/70 p-4 space-y-3 bg-white/45">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-full border border-slate-200"
                          style={{ backgroundColor: team.color || DEFAULT_TEAM_COLOR }}
                          aria-hidden="true"
                        />
                        <h4 className="text-base font-bold text-slate-800 truncate">{team.name}</h4>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="badge-pill text-[10px] bg-white/70 text-slate-600 border-white/70">
                          <Users className="w-3 h-3" />
                          {team.memberCount} membri
                        </span>
                        <span
                          className={cn(
                            'badge-pill text-[10px] border',
                            team.isActive
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          )}
                        >
                          {team.isActive ? 'Attiva' : 'Disattiva'}
                        </span>
                        {typeof team.capacityPerDay === 'number' ? (
                          <span className="badge-pill text-[10px] bg-sky-50 text-sky-700 border-sky-100">
                            Capienza: {team.capacityPerDay}/giorno
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEditModal(team)}
                        className="btn-secondary glass-chip text-xs px-3 py-2"
                        aria-label={`Modifica ${team.name}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Modifica
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(team)}
                        disabled={deletingTeamId === team.id}
                        className={cn(
                          'btn-secondary glass-chip text-xs px-3 py-2 text-rose-600 hover:text-rose-700',
                          deletingTeamId === team.id ? 'opacity-60 cursor-not-allowed' : ''
                        )}
                        aria-label={`Elimina ${team.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Elimina
                      </button>
                    </div>
                  </div>

                  {team.notes ? <p className="text-sm text-slate-600">{team.notes}</p> : null}

                  <div className="flex flex-wrap gap-1.5">
                    {team.members.length > 0 ? (
                      team.members.map((member) => (
                        <span key={member.id} className="badge-pill text-[10px] bg-white/70 text-slate-600 border-white/70">
                          {member.name}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-slate-500">Nessun tecnico assegnato</span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      </div>

      {isModalOpen ? (
        <div className="fixed inset-0 z-[140] bg-slate-900/30 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            className="glass-modal rounded-3xl border border-white/70 w-full max-w-2xl p-5 sm:p-6 max-h-[90vh] overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-label={editingTeam ? 'Modifica squadra' : 'Crea squadra'}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  {editingTeam ? 'Aggiornamento' : 'Nuova squadra'}
                </p>
                <h4 className="text-lg font-bold text-slate-800 mt-1">
                  {editingTeam ? `Modifica ${editingTeam.name}` : 'Crea squadra operativa'}
                </h4>
              </div>
              <button
                type="button"
                onClick={closeModal}
                disabled={isSaving}
                className="btn-secondary glass-chip text-sm"
              >
                Chiudi
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-600">Nome squadra *</span>
                <input
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  className="glass-input rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400/30"
                  placeholder="Es. Team Nord"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-600">Colore</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={normalizeColor(form.color)}
                    onChange={(event) => setForm((prev) => ({ ...prev, color: event.target.value }))}
                    className="h-10 w-12 rounded-lg border border-white/70 bg-white/80"
                    aria-label="Seleziona colore squadra"
                  />
                  <input
                    value={form.color}
                    onChange={(event) => setForm((prev) => ({ ...prev, color: event.target.value }))}
                    className="glass-input rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400/30 flex-1"
                    placeholder="#3b82f6"
                  />
                </div>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-600">Capienza max/giorno</span>
                <input
                  type="number"
                  min={1}
                  value={form.capacityPerDay}
                  onChange={(event) => setForm((prev) => ({ ...prev, capacityPerDay: event.target.value }))}
                  className="glass-input rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400/30"
                  placeholder="Es. 8"
                />
              </label>

              <label className="flex items-center gap-2 mt-6">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.checked }))}
                  className="h-4 w-4 rounded border-white/70 accent-brand-500"
                />
                <span className="text-sm text-slate-700 font-medium">Squadra attiva</span>
              </label>
            </div>

            <label className="flex flex-col gap-1.5 mt-3">
              <span className="text-xs font-semibold text-slate-600">Note</span>
              <textarea
                rows={3}
                value={form.notes}
                onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                className="glass-input rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400/30 resize-y"
                placeholder="Dettagli operativi della squadra"
              />
            </label>

            <div className="mt-4">
              <p className="text-xs font-semibold text-slate-600 mb-2">Membri squadra</p>
              <input
                value={memberSearch}
                onChange={(event) => setMemberSearch(event.target.value)}
                className="glass-input rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400/30 w-full"
                placeholder="Cerca tecnico..."
              />
              <div className="mt-2 max-h-48 overflow-y-auto rounded-2xl border border-white/70 bg-white/45 p-2 space-y-1 custom-scrollbar">
                {filteredTechnicians.length === 0 ? (
                  <p className="text-xs text-slate-500 px-2 py-3">Nessun tecnico trovato.</p>
                ) : (
                  filteredTechnicians.map((technician) => (
                    <label
                      key={technician.id}
                      className="flex items-center justify-between gap-2 rounded-xl px-2 py-2 hover:bg-white/70 cursor-pointer"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={form.memberIds.includes(technician.id)}
                          onChange={() => toggleMember(technician.id)}
                          className="h-4 w-4 rounded border-white/70 accent-brand-500"
                        />
                        <span className="text-sm text-slate-700 truncate">{technician.name}</span>
                      </span>
                      <span
                        className="w-2.5 h-2.5 rounded-full border border-white/70"
                        style={{ backgroundColor: technician.color || DEFAULT_TEAM_COLOR }}
                        aria-hidden="true"
                      />
                    </label>
                  ))
                )}
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                disabled={isSaving}
                className={cn('btn-secondary text-sm', isSaving ? 'opacity-60 cursor-not-allowed' : '')}
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={isSaving}
                className={cn('btn-primary text-sm px-5', isSaving ? 'opacity-60 cursor-not-allowed' : '')}
              >
                {isSaving ? 'Salvataggio...' : editingTeam ? 'Salva modifiche' : 'Crea squadra'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AppLayout>
  );
}
