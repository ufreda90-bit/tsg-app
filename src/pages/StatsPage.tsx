import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import AppLayout from '../components/AppLayout';
import { apiFetch } from '../lib/apiFetch';
import { StatsOverview, Team } from '../types';
import { cn } from '../lib/utils';
import { getStatusLabel } from '../lib/status';
import { toast } from '../components/Toast';
import { CalendarDays, RefreshCw, AlertTriangle, TrendingUp, Clock3 } from 'lucide-react';
import { useModalRegistration } from '../components/ModalStackProvider';

type RangePreset = '7' | '30' | '90' | 'custom';

function toInputDate(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function formatMinutes(minutes: number) {
  const safe = Math.max(0, Math.trunc(minutes));
  const hours = Math.floor(safe / 60);
  const rem = safe % 60;
  if (hours === 0) return `${rem} min`;
  if (rem === 0) return `${hours} h`;
  return `${hours} h ${rem} min`;
}

const DEMO_TEAMS: Team[] = [
  {
    id: -1,
    name: 'Team Alfa',
    color: '#3b82f6',
    memberIds: [],
    members: [],
    memberCount: 0,
    isActive: true,
    capacityPerDay: 4,
    notes: 'Manutenzione ordinaria',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: -2,
    name: 'Team Beta',
    color: '#10b981',
    memberIds: [],
    members: [],
    memberCount: 0,
    isActive: true,
    capacityPerDay: 6,
    notes: 'Installazioni e impianti',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: -3,
    name: 'Team Gamma',
    color: '#f59e0b',
    memberIds: [],
    members: [],
    memberCount: 0,
    isActive: false,
    capacityPerDay: 2,
    notes: 'Interventi speciali',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

export default function StatsPage() {
  const today = useMemo(() => new Date(), []);
  const [searchQuery, setSearchQuery] = useState('');
  const [rangePreset, setRangePreset] = useState<RangePreset>('30');
  const [fromDate, setFromDate] = useState<string>(() => toInputDate(addDays(today, -30)));
  const [toDate, setToDate] = useState<string>(() => toInputDate(today));
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamIds, setSelectedTeamIds] = useState<number[] | 'ALL'>('ALL');
  const [isTeamFilterOpen, setIsTeamFilterOpen] = useState(false);
  const teamFilterBtnRef = useRef<HTMLButtonElement | null>(null);
  const teamFilterMenuRef = useRef<HTMLDivElement | null>(null);
  const [teamFilterPos, setTeamFilterPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const isDev = import.meta.env.DEV === true;
  const shouldUseDemoTeams = isDev && teams.length === 0;
  const teamsForFilter = shouldUseDemoTeams ? DEMO_TEAMS : teams;

  useModalRegistration({
    id: 'stats-team-filter',
    isOpen: isTeamFilterOpen,
    onClose: () => setIsTeamFilterOpen(false),
    options: {
      type: 'popover',
      closeOnEsc: true,
      blockEscWhenEditing: false,
      priority: 60
    }
  });

  const loadTeams = async () => {
    try {
      const res = await apiFetch('/api/teams');
      if (!res.ok) return;
      const payload = await res.json().catch(() => []);
      setTeams(Array.isArray(payload) ? payload : []);
    } catch {
      // teams filter stays available with empty set
    }
  };

  useEffect(() => {
    void loadTeams();
  }, []);

  useEffect(() => {
    if (rangePreset === 'custom') return;
    const todayDate = new Date();
    const days = rangePreset === '7' ? 7 : rangePreset === '30' ? 30 : 90;
    setFromDate(toInputDate(addDays(todayDate, -days)));
    setToDate(toInputDate(todayDate));
  }, [rangePreset]);

  const loadOverview = async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const params = new URLSearchParams();
      params.set('from', `${fromDate}T00:00:00.000Z`);
      params.set('to', `${toDate}T23:59:59.999Z`);
      if (selectedTeamIds !== 'ALL' && selectedTeamIds.length > 0) {
        params.set('teamIds', selectedTeamIds.join(','));
      }

      const res = await apiFetch(`/api/stats/overview?${params.toString()}`);
      if (!res.ok) {
        const apiError = await res.clone().json().catch(() => null);
        const message =
          (typeof apiError?.error === 'string' && apiError.error) ||
          `Errore caricamento statistiche (HTTP ${res.status})`;
        throw new Error(message);
      }

      const payload = await res.json().catch(() => null);
      if (!payload || typeof payload !== 'object') {
        throw new Error('Risposta statistiche non valida');
      }
      setOverview(payload as StatsOverview);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore caricamento statistiche';
      setLoadError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadOverview();
  }, [fromDate, toDate, selectedTeamIds]);

  const computeTeamFilterPos = () => {
    const btn = teamFilterBtnRef.current;
    if (!btn) return null;
    const margin = 12;
    const rect = btn.getBoundingClientRect();
    const maxWidth = Math.min(rect.width, Math.max(0, window.innerWidth - margin * 2));
    const left = Math.min(
      Math.max(rect.left, margin),
      Math.max(margin, window.innerWidth - margin - maxWidth)
    );
    return {
      left,
      top: rect.bottom + 8,
      width: maxWidth
    };
  };

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isTeamFilterOpen) return;

    const updatePosition = () => {
      setTeamFilterPos(computeTeamFilterPos());
    };

    updatePosition();
    requestAnimationFrame(() => {
      teamFilterMenuRef.current?.focus();
    });
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isTeamFilterOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isTeamFilterOpen) return;

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (teamFilterMenuRef.current?.contains(target)) return;
      if (teamFilterBtnRef.current?.contains(target)) return;
      setIsTeamFilterOpen(false);
    };

    document.addEventListener('mousedown', handleMouseDown);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [isTeamFilterOpen]);

  const isTeamSelected = (teamId: number) => selectedTeamIds === 'ALL' || selectedTeamIds.includes(teamId);

  const toggleTeam = (teamId: number) => {
    setSelectedTeamIds((prev) => {
      const allIds = teamsForFilter.map((team) => team.id);
      if (prev === 'ALL') {
        return allIds.filter((id) => id !== teamId);
      }
      const exists = prev.includes(teamId);
      const next = exists ? prev.filter((id) => id !== teamId) : [...prev, teamId];
      if (next.length === 0) return 'ALL';
      if (next.length === allIds.length) return 'ALL';
      return next;
    });
  };

  const selectedTeamsLabel = useMemo(() => {
    if (selectedTeamIds === 'ALL') return 'Tutte le squadre';
    if (selectedTeamIds.length === 0) return 'Nessuna squadra';
    return `Squadre: ${selectedTeamIds.length}`;
  }, [selectedTeamIds]);

  const maxTeamLoad = useMemo(() => {
    if (!overview?.loadByTeam?.length) return 1;
    return Math.max(1, ...overview.loadByTeam.map((item) => item.interventions));
  }, [overview]);

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredLoadByTeam = useMemo(() => {
    if (!overview) return [];
    if (!normalizedSearch) return overview.loadByTeam;
    return overview.loadByTeam.filter((item) => item.teamName.toLowerCase().includes(normalizedSearch));
  }, [normalizedSearch, overview]);

  const filteredTopCustomers = useMemo(() => {
    if (!overview) return [];
    if (!normalizedSearch) return overview.topCustomers;
    return overview.topCustomers.filter((item) => item.name.toLowerCase().includes(normalizedSearch));
  }, [normalizedSearch, overview]);

  return (
    <AppLayout
      title="Statistiche"
      subtitle="Panoramica performance e carichi operativi"
      searchPlaceholder="Cerca cliente o squadra..."
      onSearchChange={setSearchQuery}
    >
      <div className="max-w-6xl mx-auto space-y-4">
        <section className="glass-card rounded-3xl border border-white/70 bg-white/60 p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Overview</p>
              <h3 className="text-lg font-bold text-slate-800 mt-1">Cruscotto operativo</h3>
            </div>
            <button
              type="button"
              onClick={() => void loadOverview()}
              disabled={isLoading}
              className={cn('btn-secondary glass-chip text-sm', isLoading ? 'opacity-60 cursor-not-allowed' : '')}
            >
              <RefreshCw className={cn('w-4 h-4', isLoading ? 'animate-spin' : '')} />
              Aggiorna
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="glass-chip rounded-2xl border border-white/70 p-3 space-y-2">
              <p className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                <CalendarDays className="w-3.5 h-3.5" />
                Periodo
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(['7', '30', '90', 'custom'] as const).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setRangePreset(preset)}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-xs font-semibold',
                      rangePreset === preset
                        ? 'bg-brand-50 border-brand-200 text-brand-700'
                        : 'bg-white/70 border-white/70 text-slate-600 hover:text-slate-800'
                    )}
                  >
                    {preset === 'custom' ? 'Custom' : `${preset} giorni`}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-slate-500">
                  Da
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(event) => {
                      setRangePreset('custom');
                      setFromDate(event.target.value);
                    }}
                    className="mt-1 glass-input rounded-xl px-2.5 py-1.5 text-xs w-full"
                  />
                </label>
                <label className="text-xs text-slate-500">
                  A
                  <input
                    type="date"
                    value={toDate}
                    onChange={(event) => {
                      setRangePreset('custom');
                      setToDate(event.target.value);
                    }}
                    className="mt-1 glass-input rounded-xl px-2.5 py-1.5 text-xs w-full"
                  />
                </label>
              </div>
            </div>

            <div className="glass-chip rounded-2xl border border-white/70 p-3 space-y-2 overflow-visible">
              <p className="text-xs font-semibold text-slate-600">Filtro squadre</p>
              <button
                ref={teamFilterBtnRef}
                type="button"
                onClick={() => setIsTeamFilterOpen((prev) => !prev)}
                className="glass-input rounded-xl px-3 py-2 text-sm text-slate-700 w-full text-left"
                aria-haspopup="listbox"
                aria-expanded={isTeamFilterOpen}
              >
                {selectedTeamsLabel}
              </button>
            </div>

            <div className="glass-chip rounded-2xl border border-white/70 p-3">
              <p className="text-xs font-semibold text-slate-600">Intervallo attivo</p>
              <p className="text-sm text-slate-700 mt-2">
                {fromDate} <span className="text-slate-400">→</span> {toDate}
              </p>
              {overview?.selectedTeamIds?.length ? (
                <p className="text-xs text-slate-500 mt-1">Team filtrati: {overview.selectedTeamIds.length}</p>
              ) : (
                <p className="text-xs text-slate-500 mt-1">Nessun filtro squadra</p>
              )}
            </div>
          </div>
        </section>

        {loadError ? (
          <section className="glass-card rounded-2xl border border-rose-200 bg-rose-50/80 p-4">
            <p className="text-sm font-semibold text-rose-700">Errore caricamento statistiche</p>
            <p className="text-sm text-rose-600 mt-1">{loadError}</p>
            <button type="button" onClick={() => void loadOverview()} className="btn-secondary mt-3 text-sm">
              Riprova
            </button>
          </section>
        ) : null}

        {isLoading ? (
          <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-7 gap-3">
            {[1, 2, 3, 4, 5, 6, 7].map((idx) => (
              <div key={idx} className="glass-card rounded-2xl border border-white/70 p-4 animate-pulse space-y-2">
                <div className="h-3 w-1/2 bg-slate-200/70 rounded" />
                <div className="h-6 w-2/3 bg-slate-200/70 rounded" />
              </div>
            ))}
          </section>
        ) : null}

        {!isLoading && !loadError && overview ? (
          <>
            <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-7 gap-3">
              <article className="glass-card rounded-2xl border border-white/70 p-4">
                <p className="text-xs text-slate-500">Interventi pianificati</p>
                <p className="text-2xl font-bold text-slate-800 mt-1">{overview.kpis.plannedInterventions}</p>
              </article>
              <article className="glass-card rounded-2xl border border-white/70 p-4">
                <p className="text-xs text-slate-500">Interventi completati</p>
                <p className="text-2xl font-bold text-slate-800 mt-1">{overview.kpis.completedInterventions}</p>
              </article>
              <article className="glass-card rounded-2xl border border-white/70 p-4">
                <p className="text-xs text-slate-500">Tasso completamento</p>
                <p className="text-2xl font-bold text-slate-800 mt-1">{overview.kpis.completionRate}%</p>
              </article>
              <article className="glass-card rounded-2xl border border-white/70 p-4">
                <p className="text-xs text-slate-500">Backlog attuale</p>
                <p className="text-2xl font-bold text-slate-800 mt-1">{overview.kpis.backlogCurrent}</p>
              </article>
              <article className="glass-card rounded-2xl border border-white/70 p-4">
                <p className="text-xs text-slate-500">Conflitti planner</p>
                <p className="text-2xl font-bold text-slate-800 mt-1">{overview.kpis.plannerConflicts}</p>
              </article>
              <article className="glass-card rounded-2xl border border-white/70 p-4">
                <p className="text-xs text-slate-500">Bolla compilata</p>
                <p className="text-2xl font-bold text-slate-800 mt-1">{overview.kpis.workReportCompiled}</p>
              </article>
              <article className="glass-card rounded-2xl border border-white/70 p-4">
                <p className="text-xs text-slate-500">Bolla non compilata</p>
                <p className="text-2xl font-bold text-slate-800 mt-1">{overview.kpis.workReportMissing}</p>
              </article>
            </section>

            <section className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              <article className="glass-card rounded-2xl border border-white/70 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-base font-semibold text-slate-800 flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4 text-brand-600" />
                    Carico squadre
                  </h4>
                  <span className="text-xs text-slate-500">Ore lavorate: {formatMinutes(overview.kpis.totalWorkedMinutes)}</span>
                </div>

                {filteredLoadByTeam.length === 0 ? (
                  <p className="text-sm text-slate-500">Nessun dato disponibile per il filtro selezionato.</p>
                ) : (
                  <div className="space-y-2">
                    {filteredLoadByTeam.map((row) => {
                      const pct = Math.round((row.interventions / maxTeamLoad) * 100);
                      return (
                        <div key={row.teamId} className="space-y-1">
                          <div className="flex items-center justify-between gap-2 text-sm">
                            <span className="font-medium text-slate-700 truncate">{row.teamName}</span>
                            <span className="text-xs text-slate-500 whitespace-nowrap">
                              {row.interventions} int. · {formatMinutes(row.workedMinutes)}
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-full rounded-full bg-brand-400/80" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </article>

              <article className="glass-card rounded-2xl border border-white/70 p-4 space-y-3">
                <h4 className="text-base font-semibold text-slate-800">Top clienti/cantieri</h4>
                {filteredTopCustomers.length === 0 ? (
                  <p className="text-sm text-slate-500">Nessun cliente nel periodo selezionato.</p>
                ) : (
                  <ul className="space-y-2">
                    {filteredTopCustomers.map((customer) => (
                      <li key={customer.name} className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-slate-700 truncate">{customer.name}</span>
                        <span className="badge-pill text-[10px] bg-white/70 text-slate-600 border-white/70">
                          {customer.count} interventi
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            </section>

            <section className="glass-card rounded-2xl border border-white/70 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Clock3 className="w-4 h-4 text-slate-500" />
                <h4 className="text-base font-semibold text-slate-800">Distribuzione stati</h4>
              </div>
              {overview.statusCounts.length === 0 ? (
                <p className="text-sm text-slate-500">Nessun dato stato disponibile.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {overview.statusCounts.map((entry) => (
                    <div key={entry.status} className="rounded-xl border border-white/70 bg-white/50 px-3 py-2 flex items-center justify-between">
                      <span className="text-sm text-slate-700">{getStatusLabel(entry.status)}</span>
                      <span className="text-xs font-semibold text-slate-500">{entry.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : null}

        {!isLoading && !loadError && overview && overview.kpis.plannedInterventions === 0 && overview.kpis.completedInterventions === 0 ? (
          <section className="glass-card rounded-2xl border border-amber-200 bg-amber-50/70 p-4 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5" />
            <p className="text-sm text-amber-700">
              Nessun intervento nel periodo selezionato. Amplia il range o rimuovi il filtro squadre.
            </p>
          </section>
        ) : null}
      </div>
      {isTeamFilterOpen && teamFilterPos && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={teamFilterMenuRef}
              className="fixed z-[9999] rounded-2xl border border-white/70 bg-white/85 shadow-xl backdrop-blur p-2 max-h-52 overflow-y-auto space-y-1 custom-scrollbar"
              style={{ left: teamFilterPos.left, top: teamFilterPos.top, width: teamFilterPos.width }}
              role="listbox"
              aria-label="Filtro squadre"
              tabIndex={-1}
            >
              <button
                type="button"
                onClick={() => setSelectedTeamIds('ALL')}
                className="w-full text-left rounded-xl px-2 py-2 text-xs font-semibold text-brand-700 hover:bg-brand-50"
              >
                Tutte le squadre
              </button>
              {shouldUseDemoTeams ? (
                <div className="px-2 py-1">
                  <span className="glass-chip inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1">
                    Modalità demo attiva
                  </span>
                </div>
              ) : null}
              {teamsForFilter.length === 0 ? (
                <div className="px-2 py-2 text-xs text-slate-500">Nessuna squadra disponibile.</div>
              ) : (
                teamsForFilter.map((team) => (
                  <label
                    key={team.id}
                    className={cn(
                      'flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-white cursor-pointer',
                      shouldUseDemoTeams ? 'opacity-60 cursor-not-allowed' : ''
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isTeamSelected(team.id)}
                      onChange={() => toggleTeam(team.id)}
                      disabled={shouldUseDemoTeams}
                      className="h-4 w-4 rounded border-white/70 accent-brand-500"
                    />
                    <span className="text-xs text-slate-700 truncate">{team.name}</span>
                  </label>
                ))
              )}
            </div>,
            document.body
          )
        : null}
    </AppLayout>
  );
}
