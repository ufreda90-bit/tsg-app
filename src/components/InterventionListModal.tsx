import { useEffect, useRef, useState } from 'react';
import { Intervention } from '../types';
import { X, Calendar as CalendarIcon, MapPin, Clock, Search } from 'lucide-react';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { cn } from '../lib/utils';
import { getStatusBadgeClasses, getStatusLabel } from '../lib/status';
import { apiFetch } from '../lib/apiFetch';

interface InterventionListModalProps {
  onClose: () => void;
  getTeamLabel?: (techId?: number | null) => string | null;
}

type FilterPreset = 'ALL' | 'TO_COMPLETE' | 'TO_BILL';
type SortBy = 'statusPriority' | 'dateTime' | 'team' | 'address';
type SortDir = 'asc' | 'desc';
const PAGE_LIMIT = 200;

export default function InterventionListModal({ onClose, getTeamLabel }: InterventionListModalProps) {
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [filterPreset, setFilterPreset] = useState<FilterPreset>('ALL');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('dateTime');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const isMountedRef = useRef(true);
  const listVersionRef = useRef(0);
  const loadMoreRequestIdRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const listVersion = listVersionRef.current + 1;
    listVersionRef.current = listVersion;
    // Invalidate any in-flight load-more tied to a previous base query.
    loadMoreRequestIdRef.current += 1;

    const fetchAll = async () => {
      setLoading(true);
      setLoadingMore(false);
      try {
        const params = new URLSearchParams({
          filterPreset,
          sortBy,
          sortDir,
          limit: String(PAGE_LIMIT),
          offset: '0'
        });
        if (debouncedSearch.length > 0) {
          params.set('q', debouncedSearch);
        }
        const res = await apiFetch(`/api/interventions?${params.toString()}`, { signal: controller.signal });
        const data = await res.json().catch(() => []);
        if (!cancelled && isMountedRef.current && listVersion === listVersionRef.current) {
          const page = Array.isArray(data) ? data as Intervention[] : [];
          setInterventions(page);
          setOffset(page.length);
          setHasMore(page.length === PAGE_LIMIT);
        }
      } catch (e) {
        if (!cancelled && isMountedRef.current && listVersion === listVersionRef.current) {
          console.error('Failed to fetch interventions', e);
          setInterventions([]);
          setOffset(0);
          setHasMore(false);
        }
      } finally {
        if (!cancelled && isMountedRef.current && listVersion === listVersionRef.current) setLoading(false);
      }
    };

    void fetchAll();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [debouncedSearch, filterPreset, sortBy, sortDir]);

  const handleLoadMore = async () => {
    if (loading || loadingMore || !hasMore) return;
    const listVersion = listVersionRef.current;
    const requestId = loadMoreRequestIdRef.current + 1;
    loadMoreRequestIdRef.current = requestId;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({
        filterPreset,
        sortBy,
        sortDir,
        limit: String(PAGE_LIMIT),
        offset: String(offset)
      });
      if (debouncedSearch.length > 0) {
        params.set('q', debouncedSearch);
      }
      const res = await apiFetch(`/api/interventions?${params.toString()}`);
      const data = await res.json().catch(() => []);
      if (
        !isMountedRef.current ||
        listVersion !== listVersionRef.current ||
        requestId !== loadMoreRequestIdRef.current
      ) {
        return;
      }
      const page = Array.isArray(data) ? data as Intervention[] : [];
      setInterventions(prev => [...prev, ...page]);
      setOffset(prev => prev + page.length);
      setHasMore(page.length === PAGE_LIMIT);
    } catch (e) {
      if (
        !isMountedRef.current ||
        listVersion !== listVersionRef.current ||
        requestId !== loadMoreRequestIdRef.current
      ) {
        return;
      }
      console.error('Failed to load more interventions', e);
      setHasMore(false);
    } finally {
      if (
        isMountedRef.current &&
        listVersion === listVersionRef.current &&
        requestId === loadMoreRequestIdRef.current
      ) {
        setLoadingMore(false);
      }
    }
  };

  const toggleSort = (nextSortBy: SortBy) => {
    setSortBy((prev) => {
      if (prev === nextSortBy) {
        setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return nextSortBy;
    });
  };

  const headerLabel = (label: string, key: SortBy) => (
    <button
      type="button"
      onClick={() => toggleSort(key)}
      className="inline-flex items-center gap-1 hover:text-slate-700"
      aria-label={`Ordina per ${label}`}
    >
      {label}
      {sortBy === key && <span className="text-[10px]">{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </button>
  );

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-md z-50 flex items-center justify-center p-4 sm:p-6 fade-in duration-200">
      <div className="glass-modal rounded-3xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 border border-white/70">

        <div className="flex justify-between items-center p-6 border-b border-white/60 bg-white/30">
          <div className="flex items-center gap-3">
            <div className="bg-white/70 p-2 rounded-full text-brand-600 border border-white/70">
              <ListIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">Elenco Completo Interventi</h2>
              <p className="text-sm text-slate-500">Filtra e ordina rapidamente lo storico operativo</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="glass-chip border border-white/70 p-2 rounded-full transition text-slate-500 hover:text-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4 border-b border-white/50 bg-white/20 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="inline-flex items-center gap-2">
            <label htmlFor="intervention-list-filter" className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Filtro
            </label>
            <select
              id="intervention-list-filter"
              value={filterPreset}
              onChange={(e) => setFilterPreset(e.target.value as FilterPreset)}
              className="glass-input rounded-xl px-3 py-2 text-sm text-slate-700 bg-white/70 border border-white/70 outline-none"
            >
              <option value="ALL">Tutti</option>
              <option value="TO_COMPLETE">Da completare</option>
              <option value="TO_BILL">Da contabilizzare</option>
            </select>
          </div>
          <label className="relative block sm:w-96">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca per cliente, titolo o indirizzo..."
              className="w-full glass-input rounded-xl pl-9 pr-3 py-2 text-sm text-slate-700 bg-white/70 border border-white/70 outline-none"
            />
          </label>
        </div>

        <div className="flex-1 overflow-auto p-0 custom-scrollbar">
          {loading ? (
            <div className="p-12 text-center text-slate-500">Caricamento in corso...</div>
          ) : interventions.length === 0 ? (
            <div className="p-12 text-center text-slate-500">Nessun intervento trovato con i filtri selezionati.</div>
          ) : (
            <>
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-white/40 sticky top-0 z-10 border-b border-white/60 shadow-sm text-slate-500 backdrop-blur">
                  <tr>
                    <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">ID / Titolo</th>
                    <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">{headerLabel('Stato / Priorità', 'statusPriority')}</th>
                    <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">{headerLabel('Data e Ora', 'dateTime')}</th>
                    <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">{headerLabel('Squadra Assegnata', 'team')}</th>
                    <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">{headerLabel('Indirizzo', 'address')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/40">
                  {interventions.map((item) => (
                    <tr key={item.id} className="hover:bg-white/40 transition duration-150">
                      <td className="px-6 py-4">
                        <div className="font-semibold text-slate-800">{item.title}</div>
                        <div className="text-slate-400 text-xs mt-0.5">#{item.id}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1 items-start">
                          <span className={cn('badge-pill', getStatusBadgeClasses(item.status))}>
                            {getStatusLabel(item.status)}
                          </span>
                          <span className={cn('badge-pill', getPriorityBadge(item.priority))}>
                            {item.priority}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {item.startAt ? (
                          <div className="flex flex-col gap-1 text-slate-600">
                            <span className="flex items-center gap-1.5 font-medium">
                              <CalendarIcon className="w-3.5 h-3.5 text-slate-400" />
                              {format(new Date(item.startAt), 'dd MMM yyyy', { locale: it })}
                            </span>
                            <span className="flex items-center gap-1.5 text-slate-500">
                              <Clock className="w-3.5 h-3.5 text-slate-400" />
                              {format(new Date(item.startAt), 'HH:mm')}
                              {item.endAt ? ` - ${format(new Date(item.endAt), 'HH:mm')}` : ''}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic font-medium bg-white/60 px-2 py-1 rounded-full">Da Pianificare</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {item.technician ? (
                          <div className="flex items-center gap-2">
                            <div
                              className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                              style={{ backgroundColor: item.technician.color }}
                            >
                              {(getTeamLabel?.(item.technicianId) || item.technician.name).charAt(0)}
                            </div>
                            <span className="font-medium text-slate-700">{getTeamLabel?.(item.technicianId) || item.technician.name}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">Non assegnato</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-slate-600 truncate max-w-[240px]">
                        <div className="flex items-center gap-1.5" title={item.address}>
                          <MapPin className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                          <span className="truncate">{item.address}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {hasMore && (
                <div className="px-6 py-4 border-t border-white/50 bg-white/20">
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="glass-chip border border-white/70 px-4 py-2 rounded-full text-sm font-semibold text-slate-700 disabled:opacity-60"
                  >
                    {loadingMore ? 'Caricamento...' : 'Mostra altri interventi'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ListIcon({ className }: { className?: string }) {
  return <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" x2="21" y1="6" y2="6" /><line x1="8" x2="21" y1="12" y2="12" /><line x1="8" x2="21" y1="18" y2="18" /><line x1="3" x2="3.01" y1="6" y2="6" /><line x1="3" x2="3.01" y1="12" y2="12" /><line x1="3" x2="3.01" y1="18" y2="18" /></svg>;
}

function getPriorityBadge(p: string) {
  switch (p) {
    case 'URGENT': return 'bg-rose-50 text-rose-600 border-rose-100';
    case 'HIGH': return 'bg-amber-50 text-amber-700 border-amber-100';
    case 'MEDIUM': return 'bg-blue-50 text-blue-600 border-blue-100';
    case 'LOW': return 'bg-emerald-50 text-emerald-600 border-emerald-100';
    default: return 'bg-slate-50 text-slate-500 border-slate-200';
  }
}
