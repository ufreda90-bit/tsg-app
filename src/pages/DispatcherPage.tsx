import { useEffect, useLayoutEffect, useState, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import FullCalendar from '@fullcalendar/react';
import resourceTimeGridPlugin from '@fullcalendar/resource-timegrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin, { Draggable } from '@fullcalendar/interaction';
import { Intervention, InterventionStatus, Team, Technician } from '../types';
import { cn } from '../lib/utils';
import { getStatusLabel } from '../lib/status';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { Plus, AlertCircle, Info, List, Users, CheckCircle2, Flame, ArrowUpCircle, ArrowRightCircle, ArrowDownCircle, ChevronDown, ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import CreateInterventionModal from '../components/CreateInterventionModal';
import InterventionListModal from '../components/InterventionListModal';
import WorkReportModal from '../components/WorkReportModal';
import InterventionDetailModal from '../components/InterventionDetailModal';
import TeamColorsModal from '../components/TeamColorsModal';
import AppLayout from '../components/AppLayout';
import { useModalRegistration, useModalStack } from '../components/ModalStackProvider';
import { Link, useLocation } from 'react-router-dom';
import { apiFetch } from '../lib/apiFetch';
import { buildDemoTeamsFromTechnicians, buildTeamMapsFromTeams, fetchTeams } from '../lib/teamData';
import {
  formatHourToSlot,
  loadPlannerPreferences,
  savePlannerPreferences
} from '../lib/plannerPreferences';

const formatPlannerHeaderDate = (date: Date, compact: boolean) => {
  const raw = format(date, compact ? 'd MMM' : 'EEE d MMM yyyy', { locale: it });
  return raw
    .split(' ')
    .map(part => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(' ');
};

export default function DispatcherPage() {
  const { isAnyModalOpen } = useModalStack();
  const [plannerPrefs, setPlannerPrefs] = useState(() => loadPlannerPreferences());
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [backendTeams, setBackendTeams] = useState<Team[] | null>(null);
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [backlog, setBacklog] = useState<Intervention[]>([]);
  const [visibleRange, setVisibleRange] = useState<{ start: string; end: string } | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIntervention, setEditingIntervention] = useState<Intervention | null>(null);
  const [selectedIntervention, setSelectedIntervention] = useState<Intervention | null>(null);
  const [isListModalOpen, setIsListModalOpen] = useState(false);
  const [reportIntervention, setReportIntervention] = useState<Intervention | null>(null);
  const [toast, setToast] = useState<{ msg: string, type: 'error' | 'success' | 'info' } | null>(null);
  const [isDataLoading, setIsDataLoading] = useState(false);
  const [dataLoadError, setDataLoadError] = useState<string | null>(null);
  const plannerShellRef = useRef<HTMLDivElement | null>(null);
  const calendarRef = useRef<FullCalendar>(null);
  const plannerMainRef = useRef<HTMLElement | null>(null);
  const resizeRafRef = useRef<number | null>(null);
  const backlogRef = useRef<HTMLDivElement>(null);
  const backlogDraggableRef = useRef<Draggable | null>(null);
  const backlogColumnRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>(() =>
    loadPlannerPreferences().defaultView === 'week' ? 'week' : 'day'
  );

  const [filterStatus, setFilterStatus] = useState<'ALL' | 'DONE' | 'TO_DO' | 'TO_BILL'>('ALL');
  const [selectedTeamIds, setSelectedTeamIds] = useState<number[] | 'ALL'>('ALL');
  const [isTeamFilterOpen, setIsTeamFilterOpen] = useState(false);
  const [isStatusFilterOpen, setIsStatusFilterOpen] = useState(false);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [isColorsModalOpen, setIsColorsModalOpen] = useState(false);
  const [isBacklogCollapsed, setIsBacklogCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('planner.backlogCollapsed') === '1';
  });
  const backlogCollapsedBeforeDragRef = useRef(false);
  const location = useLocation();
  const openHandledRef = useRef(false);
  const [slotConfirm, setSlotConfirm] = useState<{ date: Date; teamId: number | null } | null>(null);
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 768 : false));
  const [createPrefill, setCreatePrefill] = useState<{
    scheduledDate?: string;
    startTime?: string;
    endTime?: string;
    technicianId?: number | null;
    secondaryTechnicianId?: number | null;
  } | null>(null);
  const shouldShowCollapsedBacklogRail = !isMobile && isBacklogCollapsed;
  const [isDraggingEvent, setIsDraggingEvent] = useState(false);
  const [hoverCard, setHoverCard] = useState<{
    x: number;
    y: number;
    title: string;
    address?: string;
    team?: string;
    time?: string;
    status?: string;
    priority?: string;
  } | null>(null);
  const fetchDataInFlightRef = useRef<Promise<void> | null>(null);
  const fetchSeqRef = useRef(0);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const teamsFetchSeqRef = useRef(0);
  const deletedInterventionIdsRef = useRef<Set<number>>(new Set());
  const patchInFlightRef = useRef<Set<number>>(new Set());
  const [eventContextMenu, setEventContextMenu] = useState<{
    x: number;
    y: number;
    interventionId: number;
    mode: 'duplicate';
    targetTeamId: number | null;
    anchorRect?: { left: number; top: number; width: number; height: number } | null;
  } | null>(null);
  const [isDuplicatingIntervention, setIsDuplicatingIntervention] = useState(false);
  const eventContextMenuPopoverRef = useRef<HTMLDivElement>(null);
  const teamFilterMenuRef = useRef<HTMLDivElement | null>(null);
  const statusFilterMenuRef = useRef<HTMLDivElement | null>(null);
  const datePickerMenuRef = useRef<HTMLDivElement | null>(null);
  const [teamFilterMenuPos, setTeamFilterMenuPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const [statusFilterMenuPos, setStatusFilterMenuPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const [datePickerMenuPos, setDatePickerMenuPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const rawSchedulerLicenseKey =
    (import.meta.env as Record<string, string | undefined>).VITE_FULLCALENDAR_LICENSE_KEY?.trim() ?? '';
  const schedulerLicenseKey = rawSchedulerLicenseKey || 'CC-Attribution-NonCommercial-NoDerivatives';
  const teamFilterAnchorElRef = useRef<HTMLButtonElement | null>(null);
  const statusFilterAnchorElRef = useRef<HTMLButtonElement | null>(null);
  const datePickerAnchorElRef = useRef<HTMLButtonElement | null>(null);
  const wasTeamFilterOpenRef = useRef(false);
  const wasStatusFilterOpenRef = useRef(false);
  const wasDatePickerOpenRef = useRef(false);
  const DEBUG_PLANNER = Boolean((import.meta as any)?.env?.DEV);
  const [currentCalendarDate, setCurrentCalendarDate] = useState<Date>(new Date());
  const [calendarDatePickerValue, setCalendarDatePickerValue] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const lastDurationMsRef = useRef<Record<number, number>>({});
  const toastTimerRef = useRef<number | null>(null);
  const successToastAutoHideRef = useRef<number | null>(null);
  const lastToastRef = useRef<{ msg: string; ts: number } | null>(null);
  const dragMirrorParent = typeof document !== 'undefined' ? document.body : undefined;
  type DuplicateAnchorRect = { left: number; top: number; width: number; height: number };
  const MIN_EVENT_DURATION_MS = 30 * 60 * 1000;
  const DEFAULT_EVENT_DURATION_MS = 60 * 60 * 1000;
  const closeCreateInterventionModal = () => {
    setIsModalOpen(false);
    setEditingIntervention(null);
    setCreatePrefill(null);
  };

  const clampDurationMs = (ms: number) => {
    if (!Number.isFinite(ms)) return DEFAULT_EVENT_DURATION_MS;
    return Math.max(MIN_EVENT_DURATION_MS, ms);
  };

  const shouldSkipToast = (msg: string, dedupeWindowMs = 800) => {
    const now = Date.now();
    const last = lastToastRef.current;
    if (last && last.msg === msg && now - last.ts < dedupeWindowMs) {
      return true;
    }
    lastToastRef.current = { msg, ts: now };
    return false;
  };

  const showSuccessToast = (msg: string) => {
    if (shouldSkipToast(msg)) return;
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast({ msg, type: 'success' });
      toastTimerRef.current = null;
    }, 200);
  };

  const showInfoToast = (msg: string) => {
    if (shouldSkipToast(msg)) return;
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast({ msg, type: 'info' });
  };

  const forceCalendarResize = useCallback(() => {
    const calendarApi = calendarRef.current?.getApi?.();
    if (!calendarApi) return;
    calendarApi.updateSize();
  }, []);
  const scheduleCalendarResize = useCallback(() => {
    forceCalendarResize();
    requestAnimationFrame(() => {
      forceCalendarResize();
      requestAnimationFrame(() => {
        forceCalendarResize();
      });
    });
  }, [forceCalendarResize]);
  const setBacklogCollapsed = useCallback((collapsed: boolean) => {
    setIsBacklogCollapsed(collapsed);
    scheduleCalendarResize();
  }, [scheduleCalendarResize]);

  const getApiErrorMessage = (res: Response, payload: any, fallback: string) => {
    const apiMessage =
      (typeof payload?.message === 'string' && payload.message) ||
      (typeof payload?.error === 'string' && payload.error) ||
      '';
    if (apiMessage) return apiMessage;
    if (res.status === 401) return 'Sessione scaduta. Effettua di nuovo il login.';
    if (res.status === 403) return 'Non hai i permessi per questa operazione.';
    if (res.status === 409) return 'Conflitto dati: ricarica e riprova.';
    if (res.status === 413) return 'Contenuto troppo grande per essere elaborato.';
    return fallback;
  };

  const markDeleted = (id: number) => {
    deletedInterventionIdsRef.current.add(id);
    setTimeout(() => {
      deletedInterventionIdsRef.current.delete(id);
    }, 60_000);
  };

  useModalRegistration({
    id: 'dispatcher-context-menu',
    isOpen: Boolean(eventContextMenu),
    onClose: () => setEventContextMenu(null),
    options: { type: 'popover', closeOnEsc: true, blockEscWhenEditing: false, priority: 210 }
  });

  useModalRegistration({
    id: 'dispatcher-team-filter',
    isOpen: isTeamFilterOpen,
    onClose: () => setIsTeamFilterOpen(false),
    options: { type: 'popover', closeOnEsc: true, blockEscWhenEditing: false, priority: 200 }
  });

  useModalRegistration({
    id: 'dispatcher-status-filter',
    isOpen: isStatusFilterOpen,
    onClose: () => setIsStatusFilterOpen(false),
    options: { type: 'popover', closeOnEsc: true, blockEscWhenEditing: false, priority: 195 }
  });

  useModalRegistration({
    id: 'dispatcher-date-picker',
    isOpen: isDatePickerOpen,
    onClose: () => setIsDatePickerOpen(false),
    options: { type: 'popover', closeOnEsc: true, blockEscWhenEditing: false, priority: 190 }
  });

  useModalRegistration({
    id: 'dispatcher-colors-modal',
    isOpen: isColorsModalOpen,
    onClose: () => setIsColorsModalOpen(false),
    options: { closeOnEsc: true, blockEscWhenEditing: false, priority: 180 }
  });

  useModalRegistration({
    id: 'dispatcher-slot-confirm',
    isOpen: Boolean(slotConfirm),
    onClose: () => setSlotConfirm(null),
    options: { closeOnEsc: true, blockEscWhenEditing: false, priority: 170 }
  });

  useModalRegistration({
    id: 'dispatcher-create-modal',
    isOpen: isModalOpen,
    onClose: closeCreateInterventionModal,
    options: { closeOnEsc: true, blockEscWhenEditing: true, priority: 160 }
  });

  useModalRegistration({
    id: 'dispatcher-report-modal',
    isOpen: Boolean(reportIntervention),
    onClose: () => setReportIntervention(null),
    options: { closeOnEsc: true, blockEscWhenEditing: false, priority: 150 }
  });

  useModalRegistration({
    id: 'dispatcher-detail-modal',
    isOpen: Boolean(selectedIntervention),
    onClose: () => setSelectedIntervention(null),
    options: { closeOnEsc: true, blockEscWhenEditing: false, priority: 140 }
  });

  useModalRegistration({
    id: 'dispatcher-list-modal',
    isOpen: isListModalOpen,
    onClose: () => setIsListModalOpen(false),
    options: { closeOnEsc: true, blockEscWhenEditing: false, priority: 130 }
  });

  // Fetch data
  const fetchData = async (force: boolean = false) => {
    if (!force && fetchDataInFlightRef.current) {
      return fetchDataInFlightRef.current;
    }
    if (!visibleRange) return Promise.resolve();
    const seq = ++fetchSeqRef.current;
    if (fetchAbortRef.current) {
      fetchAbortRef.current.abort();
    }
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    setIsDataLoading(true);
    setDataLoadError(null);
    const requestPromise: Promise<void> = (async () => {
      try {
        const calendarParams = new URLSearchParams({
          from: visibleRange.start,
          to: visibleRange.end
        });
        const backlogParams = new URLSearchParams({ backlog: 'true' });
        const [techRes, intRes, backlogRes] = await Promise.all([
          apiFetch('/api/technicians', { signal: controller.signal }),
          apiFetch(`/api/interventions?${calendarParams.toString()}`, { signal: controller.signal }),
          apiFetch(`/api/interventions?${backlogParams.toString()}`, { signal: controller.signal }),
        ]);

        if (!techRes.ok || !intRes.ok || !backlogRes.ok) {
          const failed = [techRes, intRes, backlogRes].find(r => !r.ok)!;
          const failedPayload = await failed.clone().json().catch(() => null);
          const errorMessage = getApiErrorMessage(failed, failedPayload, 'Errore caricamento dati planner');
          if (seq === fetchSeqRef.current) {
            setIsDataLoading(false);
            setDataLoadError(errorMessage);
          }
          setToast({
            msg: errorMessage,
            type: 'error'
          });
          return;
        }

        const techData = await techRes.json().catch(() => null);
        const intData = await intRes.json().catch(() => null);
        const backlogData = await backlogRes.json().catch(() => null);
        if (seq !== fetchSeqRef.current) return;
        setIsDataLoading(false);
        setDataLoadError(null);

        const nextTechnicians = Array.isArray(techData) ? techData : [];
        const nextInterventions = Array.isArray(intData) ? intData : [];
        const nextBacklog = Array.isArray(backlogData) ? backlogData : [];

        for (const intervention of [...nextInterventions, ...nextBacklog]) {
          const interventionId = Number(intervention?.id);
          if (!Number.isFinite(interventionId) || !intervention?.startAt || !intervention?.endAt) continue;
          const startMs = new Date(intervention.startAt).getTime();
          const endMs = new Date(intervention.endAt).getTime();
          if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
          const durationMs = endMs - startMs;
          lastDurationMsRef.current[interventionId] = clampDurationMs(durationMs);
        }

        setTechnicians(nextTechnicians);
        setInterventions(nextInterventions);
        setBacklog(nextBacklog);
      } catch (e) {
        if (controller.signal.aborted) return;
        console.error(e);
        if (seq !== fetchSeqRef.current) return;
        setIsDataLoading(false);
        setDataLoadError('Errore di rete durante il caricamento dati');
        setToast({ msg: 'Errore di rete durante il caricamento dati', type: 'error' });
      }
    })().finally(() => {
      if (seq === fetchSeqRef.current) {
        setIsDataLoading(false);
      }
      if (fetchAbortRef.current === controller) {
        fetchAbortRef.current = null;
      }
      if (fetchDataInFlightRef.current === requestPromise) {
        fetchDataInFlightRef.current = null;
      }
    });

    fetchDataInFlightRef.current = requestPromise;
    return fetchDataInFlightRef.current;
  };

  const openInterventionById = async (id: number) => {
    const local = interventions.find(i => i.id === id);
    if (local) {
      setSelectedIntervention(local);
      return;
    }
    try {
      const res = await apiFetch(`/api/interventions/${id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedIntervention(data);
      }
    } catch (e) {
      console.error('Errore apertura intervento', e);
    }
  };

  useEffect(() => {
    if (!visibleRange) return;
    void fetchData(true);
    return () => {
      fetchAbortRef.current?.abort();
    };
  }, [visibleRange]);

  useEffect(() => {
    const controller = new AbortController();
    const seq = ++teamsFetchSeqRef.current;
    void (async () => {
      const result = await fetchTeams(controller.signal);
      if (controller.signal.aborted || seq !== teamsFetchSeqRef.current) return;
      if (result.ok) {
        setBackendTeams(result.teams);
      } else {
        setBackendTeams([]);
      }
    })();
    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: number }>).detail;
      if (detail?.id) {
        openInterventionById(detail.id);
      }
    };
    window.addEventListener('open-intervention', handler as EventListener);
    return () => window.removeEventListener('open-intervention', handler as EventListener);
  }, [interventions]);

  useEffect(() => {
    const handler = () => fetchData();
    window.addEventListener('refresh-interventions', handler);
    return () => window.removeEventListener('refresh-interventions', handler);
  }, []);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('planner.backlogCollapsed', isBacklogCollapsed ? '1' : '0');
  }, [isBacklogCollapsed]);

  useLayoutEffect(() => {
    scheduleCalendarResize();
  }, [shouldShowCollapsedBacklogRail, scheduleCalendarResize]);

  useLayoutEffect(() => {
    const plannerShell = plannerShellRef.current;
    if (!plannerShell) return;

    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target !== plannerShell) return;
      if (event.propertyName !== 'grid-template-columns') return;
      forceCalendarResize();
    };

    plannerShell.addEventListener('transitionend', onTransitionEnd);
    return () => {
      plannerShell.removeEventListener('transitionend', onTransitionEnd);
    };
  }, [forceCalendarResize]);

  useLayoutEffect(() => {
    const plannerMain = plannerMainRef.current;
    if (!plannerMain || typeof ResizeObserver === 'undefined') return;

    const scheduleResize = () => {
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current);
      }
      resizeRafRef.current = requestAnimationFrame(() => {
        resizeRafRef.current = null;
        forceCalendarResize();
      });
    };

    const observer = new ResizeObserver(() => {
      scheduleResize();
    });

    observer.observe(plannerMain);
    scheduleResize();

    return () => {
      observer.disconnect();
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
    };
  }, [forceCalendarResize]);

  useEffect(() => {
    if (successToastAutoHideRef.current !== null) {
      window.clearTimeout(successToastAutoHideRef.current);
      successToastAutoHideRef.current = null;
    }

    if (!toast || toast.type !== 'success') {
      return;
    }

    successToastAutoHideRef.current = window.setTimeout(() => {
      setToast(current => (current?.type === 'success' ? null : current));
      successToastAutoHideRef.current = null;
    }, 3000);

    return () => {
      if (successToastAutoHideRef.current !== null) {
        window.clearTimeout(successToastAutoHideRef.current);
        successToastAutoHideRef.current = null;
      }
    };
  }, [toast]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      if (successToastAutoHideRef.current !== null) {
        window.clearTimeout(successToastAutoHideRef.current);
      }
      if (typeof document !== 'undefined') {
        document.body.classList.remove('is-dragging-event');
        document.body.classList.remove('is-dragging-backlog');
      }
    };
  }, []);

  useEffect(() => {
    if (plannerPrefs.autoRefreshSeconds <= 0) return;
    const intervalId = window.setInterval(() => {
      void fetchData();
    }, plannerPrefs.autoRefreshSeconds * 1000);
    return () => window.clearInterval(intervalId);
  }, [plannerPrefs.autoRefreshSeconds]);

  useEffect(() => {
    if (isMobile && viewMode === 'week') {
      setViewMode('day');
    }
  }, [isMobile, viewMode]);

  useEffect(() => {
    if (openHandledRef.current) return;
    const params = new URLSearchParams(location.search);
    const storedId = sessionStorage.getItem('openInterventionId');
    const idRaw = params.get('openInterventionId') || storedId;
    if (!idRaw) return;
    const id = Number(idRaw);
    if (!Number.isFinite(id)) return;
    openHandledRef.current = true;
    sessionStorage.removeItem('openInterventionId');
    openInterventionById(id);
  }, [location.search, interventions]);

  useEffect(() => {
    if (!eventContextMenu) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && eventContextMenuPopoverRef.current?.contains(target)) return;
      setEventContextMenu(null);
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [eventContextMenu]);

  const computePopoverPosition = (button: HTMLElement | null, preferredWidth?: number) => {
    if (!button) return null;
    const margin = 12;
    const rect = button.getBoundingClientRect();
    const widthBase = preferredWidth ?? rect.width;
    const width = Math.min(widthBase, Math.max(0, window.innerWidth - margin * 2));
    const left = Math.min(
      Math.max(rect.left, margin),
      Math.max(margin, window.innerWidth - margin - width)
    );
    const top = rect.bottom + 8;
    return { left, top, width };
  };

  const toggleTeamFilterMenu = (button: HTMLButtonElement | null) => {
    if (!button) return;
    const isSameAnchor = teamFilterAnchorElRef.current === button;
    if (isTeamFilterOpen && isSameAnchor) {
      setIsTeamFilterOpen(false);
      return;
    }
    setIsStatusFilterOpen(false);
    teamFilterAnchorElRef.current = button;
    setTeamFilterMenuPos(computePopoverPosition(button));
    setIsTeamFilterOpen(true);
  };

  const toggleStatusFilterMenu = (button: HTMLButtonElement | null) => {
    if (!button) return;
    const isSameAnchor = statusFilterAnchorElRef.current === button;
    if (isStatusFilterOpen && isSameAnchor) {
      setIsStatusFilterOpen(false);
      return;
    }
    setIsTeamFilterOpen(false);
    statusFilterAnchorElRef.current = button;
    setStatusFilterMenuPos(computePopoverPosition(button));
    setIsStatusFilterOpen(true);
  };

  const toggleDatePickerMenu = (button: HTMLButtonElement | null) => {
    if (!button) return;
    const isSameAnchor = datePickerAnchorElRef.current === button;
    if (isDatePickerOpen && isSameAnchor) {
      setIsDatePickerOpen(false);
      return;
    }
    setIsTeamFilterOpen(false);
    setIsStatusFilterOpen(false);
    datePickerAnchorElRef.current = button;
    setDatePickerMenuPos(computePopoverPosition(button, 280));
    setIsDatePickerOpen(true);
  };

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isTeamFilterOpen) return;
    if (!teamFilterAnchorElRef.current) return;

    const updatePosition = () => {
      setTeamFilterMenuPos(computePopoverPosition(teamFilterAnchorElRef.current));
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

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isStatusFilterOpen) return;
    if (!statusFilterAnchorElRef.current) return;

    const updatePosition = () => {
      setStatusFilterMenuPos(computePopoverPosition(statusFilterAnchorElRef.current));
    };

    updatePosition();
    requestAnimationFrame(() => {
      statusFilterMenuRef.current?.focus();
    });

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isStatusFilterOpen]);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isDatePickerOpen) return;
    if (!datePickerAnchorElRef.current) return;

    const updatePosition = () => {
      setDatePickerMenuPos(computePopoverPosition(datePickerAnchorElRef.current, 280));
    };

    updatePosition();
    requestAnimationFrame(() => {
      datePickerMenuRef.current?.focus();
    });

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isDatePickerOpen]);

  const refreshTeamsData = useCallback(async () => {
    const result = await fetchTeams();
    if (result.ok) {
      setBackendTeams(result.teams);
      return;
    }
    setToast({ msg: 'error' in result ? result.error : 'Errore aggiornamento squadre', type: 'error' });
  }, []);

  useEffect(() => {
    if (!isTeamFilterOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (teamFilterMenuRef.current?.contains(target)) return;
      if (teamFilterAnchorElRef.current?.contains(target)) return;
      setIsTeamFilterOpen(false);
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isTeamFilterOpen]);

  useEffect(() => {
    if (!isStatusFilterOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (statusFilterMenuRef.current?.contains(target)) return;
      if (statusFilterAnchorElRef.current?.contains(target)) return;
      setIsStatusFilterOpen(false);
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isStatusFilterOpen]);

  useEffect(() => {
    if (!isDatePickerOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (datePickerMenuRef.current?.contains(target)) return;
      if (datePickerAnchorElRef.current?.contains(target)) return;
      setIsDatePickerOpen(false);
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isDatePickerOpen]);

  useEffect(() => {
    if (wasTeamFilterOpenRef.current && !isTeamFilterOpen) {
      teamFilterAnchorElRef.current?.focus();
    }
    wasTeamFilterOpenRef.current = isTeamFilterOpen;
  }, [isTeamFilterOpen]);

  useEffect(() => {
    if (wasStatusFilterOpenRef.current && !isStatusFilterOpen) {
      statusFilterAnchorElRef.current?.focus();
    }
    wasStatusFilterOpenRef.current = isStatusFilterOpen;
  }, [isStatusFilterOpen]);

  useEffect(() => {
    if (wasDatePickerOpenRef.current && !isDatePickerOpen) {
      datePickerAnchorElRef.current?.focus();
    }
    wasDatePickerOpenRef.current = isDatePickerOpen;
  }, [isDatePickerOpen]);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    if (!eventContextMenu) return;

    const pad = 8;
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

    const updatePosition = () => {
      const menuRect = eventContextMenuPopoverRef.current?.getBoundingClientRect();
      const width = menuRect?.width ?? 320;
      const height = menuRect?.height ?? 220;
      setEventContextMenu((current) => {
        if (!current) return current;

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const maxX = Math.max(pad, viewportWidth - width - pad);
        const maxY = Math.max(pad, viewportHeight - height - pad);

        let nextX = clamp(current.x, pad, maxX);
        let nextY = clamp(current.y, pad, maxY);

        if (current.anchorRect) {
          nextX = clamp(current.anchorRect.left + current.anchorRect.width - width, pad, maxX);
          const yAbove = current.anchorRect.top - height - 8;
          nextY = yAbove >= pad
            ? clamp(yAbove, pad, maxY)
            : clamp(current.anchorRect.top + current.anchorRect.height + 8, pad, maxY);
        }

        if (nextX === current.x && nextY === current.y) return current;
        return { ...current, x: nextX, y: nextY };
      });
    };

    updatePosition();
    requestAnimationFrame(updatePosition);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [Boolean(eventContextMenu)]);

  // Setup Draggable for Backlog
  useEffect(() => {
    backlogDraggableRef.current?.destroy();
    backlogDraggableRef.current = null;

    if (!backlogRef.current || shouldShowCollapsedBacklogRail) {
      return;
    }
    backlogDraggableRef.current = new Draggable(backlogRef.current, {
      itemSelector: '.fc-event',
      appendTo: document.body,
      minDistance: 1,
      eventData: function (eventEl) {
        const id = eventEl.getAttribute('data-id');
        const title = eventEl.getAttribute('data-title');
        const color = eventEl.getAttribute('data-color');
        const durationMinutesRaw = Number(eventEl.getAttribute('data-duration-minutes'));
        const durationMinutes = Number.isFinite(durationMinutesRaw) && durationMinutesRaw > 0
          ? durationMinutesRaw
          : Math.round(DEFAULT_EVENT_DURATION_MS / 60000);
        return {
          id: id,
          title: title,
          backgroundColor: color,
          borderColor: color,
          duration: { minutes: durationMinutes },
          create: true
        };
      }
    });

    return () => {
      backlogDraggableRef.current?.destroy();
      backlogDraggableRef.current = null;
    };
  }, [backlog, shouldShowCollapsedBacklogRail]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const backlogEl = backlogRef.current;
    if (!backlogEl || shouldShowCollapsedBacklogRail) return;

    let pointerDownOnBacklogItem = false;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('.fc-event')) return;
      pointerDownOnBacklogItem = true;
      document.body.classList.add('is-dragging-backlog');
    };

    const clearBacklogDragClass = () => {
      if (!pointerDownOnBacklogItem) return;
      pointerDownOnBacklogItem = false;
      document.body.classList.remove('is-dragging-backlog');
    };

    backlogEl.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', clearBacklogDragClass);
    window.addEventListener('pointercancel', clearBacklogDragClass);
    window.addEventListener('blur', clearBacklogDragClass);

    return () => {
      backlogEl.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', clearBacklogDragClass);
      window.removeEventListener('pointercancel', clearBacklogDragClass);
      window.removeEventListener('blur', clearBacklogDragClass);
      document.body.classList.remove('is-dragging-backlog');
    };
  }, [shouldShowCollapsedBacklogRail]);

  const getCurrentIntervention = (id: number) =>
    interventions.find(i => i.id === id) || backlog.find(i => i.id === id) || null;

  const getInterventionAssignment = (intervention?: Intervention | null): TeamAssignment => ({
    technicianId: intervention?.technicianId ?? null,
    secondaryTechnicianId: intervention?.secondaryTechnicianId ?? null
  });

  const removeCalendarEventById = (id: number) => {
    const calendarApi = calendarRef.current?.getApi();
    if (!calendarApi) return;
    calendarApi.getEventById(String(id))?.remove();
  };

  type SchedulerEventLike = {
    id: string | number;
    start: Date | null;
    end: Date | null;
    getResources?: () => Array<{ id: string | number | null | undefined }>;
  };

  type TeamAssignment = {
    technicianId: number | null;
    secondaryTechnicianId: number | null;
  };

  type SchedulerInfoLike = {
    event?: SchedulerEventLike;
    revert?: (() => void) | undefined;
  };

  const safeRevert = (info: SchedulerInfoLike | null | undefined) => {
    if (typeof info?.revert === 'function') {
      info.revert();
    }
  };

  const getInterventionIdOrRevert = (
    info: SchedulerInfoLike | null | undefined,
    errorMessage = 'Intervento non valido: ricarica dati e riprova'
  ) => {
    const interventionId = Number(info?.event?.id);
    if (!Number.isFinite(interventionId)) {
      safeRevert(info);
      setToast({ msg: errorMessage, type: 'error' });
      return null;
    }
    return interventionId;
  };

  const buildMovePayloadOrRevert = ({
    info,
    requireTeamAssignment,
    fallbackDurationMs = DEFAULT_EVENT_DURATION_MS,
    fallbackAssignment
  }: {
    info: SchedulerInfoLike;
    requireTeamAssignment: boolean;
    fallbackDurationMs?: number;
    fallbackAssignment?: TeamAssignment;
  }) => {
    const event = info.event;
    if (!event?.start) {
      safeRevert(info);
      setToast({ msg: 'Orario evento non valido: ricarica dati e riprova', type: 'error' });
      return null;
    }

    const startMs = event.start.getTime();
    if (!Number.isFinite(startMs)) {
      safeRevert(info);
      setToast({ msg: 'Orario evento non valido: ricarica dati e riprova', type: 'error' });
      return null;
    }

    const safeFallbackDuration = Number.isFinite(fallbackDurationMs)
      ? Math.max(MIN_EVENT_DURATION_MS, fallbackDurationMs)
      : DEFAULT_EVENT_DURATION_MS;

    const rawDurationMs = event.end ? event.end.getTime() - startMs : safeFallbackDuration;
    const safeDurationMs = Number.isFinite(rawDurationMs)
      ? Math.max(MIN_EVENT_DURATION_MS, rawDurationMs)
      : safeFallbackDuration;
    const endMs = startMs + safeDurationMs;

    let assignment: TeamAssignment = fallbackAssignment ?? {
      technicianId: null,
      secondaryTechnicianId: null
    };

    if (requireTeamAssignment) {
      const resources = typeof event.getResources === 'function' ? event.getResources() : [];
      const resourceIdRaw = resources[0]?.id;
      const targetTeamId = Number(resourceIdRaw);
      if (!Number.isFinite(targetTeamId)) {
        safeRevert(info);
        setToast({ msg: 'Squadra non valida: ricarica dati e riprova', type: 'error' });
        return null;
      }
      const assignmentError = getTeamAssignmentErrorMessage(targetTeamId, true);
      if (assignmentError) {
        safeRevert(info);
        setToast({ msg: assignmentError, type: 'error' });
        return null;
      }
      assignment = getTeamAssignmentFromTeamId(targetTeamId);
      if (!assignment.technicianId) {
        safeRevert(info);
        setToast({ msg: getTeamAssignmentErrorMessage(targetTeamId, true) ?? 'Squadra non valida: ricarica dati e riprova', type: 'error' });
        return null;
      }
    }

    return {
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(endMs).toISOString(),
      assignment
    };
  };

  const parseApiErrorMessage = async (res: Response, fallback: string) => {
    try {
      const payload = await res.clone().json();
      if (payload && typeof payload === 'object') {
        if ('message' in payload && typeof payload.message === 'string' && payload.message.trim()) {
          return payload.message;
        }
        if ('error' in payload && typeof payload.error === 'string' && payload.error.trim()) {
          return payload.error;
        }
      }
    } catch {
      // ignore non-json responses
    }
    try {
      const textPayload = await res.clone().text();
      if (textPayload.trim()) return textPayload.trim();
    } catch {
      // ignore read errors
    }
    return fallback;
  };

  const handleEventReceive = async (info: any) => {
    if (typeof document !== 'undefined') {
      document.body.classList.remove('is-dragging-backlog');
    }
    // Dropped from backlog
    const interventionIdNum = getInterventionIdOrRevert(info);
    if (interventionIdNum === null) {
      return;
    }
    if (deletedInterventionIdsRef.current.has(interventionIdNum)) {
      safeRevert(info);
      return;
    }
    if (patchInFlightRef.current.has(interventionIdNum)) {
      safeRevert(info);
      showInfoToast('Operazione già in corso su questo intervento');
      return;
    }
    patchInFlightRef.current.add(interventionIdNum);
    const source = getCurrentIntervention(interventionIdNum);
    const version = source?.version;
    const sourceDurationMs = source?.startAt && source?.endAt
      ? new Date(source.endAt).getTime() - new Date(source.startAt).getTime()
      : (lastDurationMsRef.current[interventionIdNum] ?? DEFAULT_EVENT_DURATION_MS);
    const fallbackDurationMs = clampDurationMs(sourceDurationMs);

    try {
      if (version === undefined) {
        safeRevert(info);
        setToast({ msg: 'Versione intervento mancante: ricarica dati e riprova', type: 'error' });
        return;
      }
      const movePayload = buildMovePayloadOrRevert({
        info,
        requireTeamAssignment: viewMode === 'day' && teamMaps.teams.length > 0,
        fallbackDurationMs,
        fallbackAssignment: getInterventionAssignment(source)
      });
      if (!movePayload) {
        return;
      }
      if (deletedInterventionIdsRef.current.has(interventionIdNum)) {
        safeRevert(info);
        return;
      }
      const res = await apiFetch(`/api/interventions/${interventionIdNum}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version,
          technicianId: movePayload.assignment.technicianId,
          secondaryTechnicianId: movePayload.assignment.secondaryTechnicianId,
          startAt: movePayload.startAt,
          endAt: movePayload.endAt,
          status: 'SCHEDULED'
        })
      });

      if (res.status === 409) {
        safeRevert(info);
        setToast({ msg: "Dati aggiornati da un'altra operazione. Ricarico e riprova.", type: 'error' });
        await fetchData(true);
        return;
      }
      if (!res.ok) {
        const message = await parseApiErrorMessage(res, 'Errore aggiornamento');
        safeRevert(info); // Revert UI
        setToast({ msg: message, type: 'error' });
        return;
      }
      lastDurationMsRef.current[interventionIdNum] = clampDurationMs(
        new Date(movePayload.endAt).getTime() - new Date(movePayload.startAt).getTime()
      );

      await fetchData(true); // Refresh all
      showSuccessToast('Intervento pianificato!');
    } catch (e) {
      safeRevert(info);
      setToast({ msg: 'Errore di rete', type: 'error' });
    } finally {
      patchInFlightRef.current.delete(interventionIdNum);
    }
  };

  const handleEventDragStop = async (info: any) => {
    const restoreCollapsedAfterDrag = () => {
      if (!backlogCollapsedBeforeDragRef.current) return;
      backlogCollapsedBeforeDragRef.current = false;
      setBacklogCollapsed(true);
    };
    setIsDraggingEvent(false);
    if (typeof document !== 'undefined') {
      document.body.classList.remove('is-dragging-event');
    }
    const backlogEl = backlogRef.current;
    if (!backlogEl) {
      restoreCollapsedAfterDrag();
      return;
    }
    const rect = backlogEl.getBoundingClientRect();
    const { clientX, clientY } = info.jsEvent || {};
    const inBacklog =
      clientX !== undefined &&
      clientY !== undefined &&
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;

    if (!inBacklog) {
      restoreCollapsedAfterDrag();
      return;
    }

    const draggedId = Number(info.event.id);
    if (!Number.isFinite(draggedId)) {
      restoreCollapsedAfterDrag();
      return;
    }
    if (deletedInterventionIdsRef.current.has(draggedId)) {
      restoreCollapsedAfterDrag();
      return;
    }
    const current = getCurrentIntervention(draggedId);
    if (!current) {
      restoreCollapsedAfterDrag();
      return;
    }
    const version = current.version;
    if (version === undefined) {
      setToast({ msg: 'Versione intervento mancante: ricarica dati e riprova', type: 'error' });
      restoreCollapsedAfterDrag();
      return;
    }
    const backlogStatusForDb: InterventionStatus = 'SCHEDULED';
    const prevInterventions = [...interventions];
    const prevBacklog = [...backlog];

    const draggedItem = interventions.find(i => i.id === draggedId) ?? current;
    if (draggedItem) {
      setInterventions(prev => prev.filter(i => i.id !== draggedId));
      setBacklog(prev => [
        {
          ...draggedItem,
          status: backlogStatusForDb,
          startAt: null,
          endAt: null,
          technicianId: null,
          secondaryTechnicianId: null
        },
        ...prev.filter(i => i.id !== draggedId)
      ]);
    }

    removeCalendarEventById(draggedId);
    calendarRef.current?.getApi().refetchEvents();

    if (info.event.remove) {
      info.event.remove();
    }

    try {
      if (deletedInterventionIdsRef.current.has(draggedId)) {
        return;
      }
      const payload = {
        version,
        status: backlogStatusForDb,
        startAt: null,
        endAt: null,
        technicianId: null,
        secondaryTechnicianId: null
      };
      if (DEBUG_PLANNER) {
        console.groupCollapsed('[Planner] Unschedule → backlog');
        console.log('id', info.event.id);
        console.log('payload', payload);
        console.log('current.version', version);
        console.log('event.extendedProps', info.event.extendedProps);
        console.groupEnd();
      }
      const res = await apiFetch(`/api/interventions/${info.event.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const responseBody = await (async () => {
        try {
          return await res.clone().json();
        } catch {
          try {
            return await res.clone().text();
          } catch {
            return null;
          }
        }
      })();
      if (DEBUG_PLANNER) {
        console.groupCollapsed('[Planner] Unschedule response');
        console.log('status', res.status);
        console.log('ok', res.ok);
        console.log('body', responseBody);
        console.groupEnd();
      }

      if (res.status === 409) {
        setInterventions(prevInterventions);
        setBacklog(prevBacklog);
        setToast({ msg: "Dati aggiornati da un'altra operazione. Ricarico e riprova.", type: 'error' });
        void fetchData(true);
        return;
      }
      if (!res.ok) {
        const responseMessage =
          typeof responseBody === 'object' &&
          responseBody !== null &&
          'message' in responseBody &&
          typeof (responseBody as { message?: unknown }).message === 'string'
            ? (responseBody as { message: string }).message
            : '';
        const baseMessage = `Errore spostamento nel backlog (HTTP ${res.status})`;
        setInterventions(prevInterventions);
        setBacklog(prevBacklog);
        setToast({ msg: responseMessage ? `${baseMessage}: ${responseMessage}` : baseMessage, type: 'error' });
        void fetchData(true);
        return;
      }

      await fetchData(true);
      setToast({ msg: 'Intervento spostato nel backlog', type: 'success' });
    } catch (e) {
      setInterventions(prevInterventions);
      setBacklog(prevBacklog);
      void fetchData(true);
      setToast({ msg: 'Errore di rete', type: 'error' });
    } finally {
      restoreCollapsedAfterDrag();
    }
  };

  const handleEventDrop = async (info: any) => {
    // Moved within calendar
    const interventionIdNum = getInterventionIdOrRevert(info);
    if (interventionIdNum === null) {
      return;
    }
    if (deletedInterventionIdsRef.current.has(interventionIdNum)) {
      safeRevert(info);
      return;
    }
    if (patchInFlightRef.current.has(interventionIdNum)) {
      safeRevert(info);
      showInfoToast('Operazione già in corso su questo intervento');
      return;
    }
    patchInFlightRef.current.add(interventionIdNum);
    const current = getCurrentIntervention(interventionIdNum);
    if (!current) {
      safeRevert(info);
      return;
    }
    if (current.version === undefined) {
      safeRevert(info);
      setToast({ msg: 'Versione intervento mancante: ricarica dati e riprova', type: 'error' });
      return;
    }
    const currentDurationMs = (() => {
      const computed = current.startAt && current.endAt
        ? new Date(current.endAt).getTime() - new Date(current.startAt).getTime()
        : DEFAULT_EVENT_DURATION_MS;
      return Number.isFinite(computed) ? Math.max(MIN_EVENT_DURATION_MS, computed) : DEFAULT_EVENT_DURATION_MS;
    })();
    const movePayload = buildMovePayloadOrRevert({
      info,
      requireTeamAssignment: viewMode === 'day' && teamMaps.teams.length > 0,
      fallbackDurationMs: currentDurationMs,
      fallbackAssignment: getInterventionAssignment(current)
    });
    if (!movePayload) {
      return;
    }

    try {
      if (deletedInterventionIdsRef.current.has(interventionIdNum)) {
        safeRevert(info);
        return;
      }
      const res = await apiFetch(`/api/interventions/${interventionIdNum}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: current.version,
          technicianId: movePayload.assignment.technicianId,
          secondaryTechnicianId: movePayload.assignment.secondaryTechnicianId,
          startAt: movePayload.startAt,
          endAt: movePayload.endAt
        })
      });

      if (res.status === 409) {
        safeRevert(info);
        setToast({ msg: "Dati aggiornati da un'altra operazione. Ricarico e riprova.", type: 'error' });
        await fetchData(true);
        return;
      }
      if (!res.ok) {
        const message = await parseApiErrorMessage(res, 'Errore spostamento');
        safeRevert(info);
        setToast({ msg: message, type: 'error' });
        return;
      }
      lastDurationMsRef.current[interventionIdNum] = clampDurationMs(
        new Date(movePayload.endAt).getTime() - new Date(movePayload.startAt).getTime()
      );

      await fetchData(true);
      showSuccessToast('Spostamento salvato');
    } catch (e) {
      safeRevert(info);
      setToast({ msg: 'Errore di rete', type: 'error' });
    } finally {
      patchInFlightRef.current.delete(interventionIdNum);
    }
  };

  const handleEventDragStart = () => {
    backlogCollapsedBeforeDragRef.current = !isMobile && isBacklogCollapsed;
    if (backlogCollapsedBeforeDragRef.current) {
      setBacklogCollapsed(false);
    }
    setIsDraggingEvent(true);
    setHoverCard(null);
    if (typeof document !== 'undefined') {
      document.body.classList.add('is-dragging-event');
    }
  };

  const handleEventResizeStart = () => {
    setIsDraggingEvent(true);
    setHoverCard(null);
    if (typeof document !== 'undefined') {
      document.body.classList.add('is-dragging-event');
    }
  };

  const handleEventResizeStop = () => {
    setIsDraggingEvent(false);
    if (typeof document !== 'undefined') {
      document.body.classList.remove('is-dragging-event');
    }
  };

  const handleEventResize = async (info: any) => {
    const interventionIdNum = getInterventionIdOrRevert(info);
    if (interventionIdNum === null) {
      return;
    }
    if (deletedInterventionIdsRef.current.has(interventionIdNum)) {
      safeRevert(info);
      return;
    }
    if (patchInFlightRef.current.has(interventionIdNum)) {
      safeRevert(info);
      showInfoToast('Operazione già in corso su questo intervento');
      return;
    }
    patchInFlightRef.current.add(interventionIdNum);
    const current = getCurrentIntervention(interventionIdNum);
    if (!current) {
      safeRevert(info);
      return;
    }
    if (current.version === undefined) {
      safeRevert(info);
      setToast({ msg: 'Versione intervento mancante: ricarica dati e riprova', type: 'error' });
      return;
    }
    const currentDurationMs = (() => {
      const computed = current.startAt && current.endAt
        ? new Date(current.endAt).getTime() - new Date(current.startAt).getTime()
        : DEFAULT_EVENT_DURATION_MS;
      return Number.isFinite(computed) ? Math.max(MIN_EVENT_DURATION_MS, computed) : DEFAULT_EVENT_DURATION_MS;
    })();
    const movePayload = buildMovePayloadOrRevert({
      info,
      requireTeamAssignment: false,
      fallbackDurationMs: currentDurationMs
    });
    if (!movePayload) {
      return;
    }

    try {
      if (deletedInterventionIdsRef.current.has(interventionIdNum)) {
        safeRevert(info);
        return;
      }
      const res = await apiFetch(`/api/interventions/${interventionIdNum}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: current.version,
          startAt: movePayload.startAt,
          endAt: movePayload.endAt
        })
      });

      if (res.status === 409) {
        safeRevert(info);
        setToast({ msg: "Dati aggiornati da un'altra operazione. Ricarico e riprova.", type: 'error' });
        await fetchData(true);
        return;
      }
      if (!res.ok) {
        const message = await parseApiErrorMessage(res, 'Errore ridimensionamento');
        safeRevert(info);
        setToast({ msg: message, type: 'error' });
        return;
      }
      lastDurationMsRef.current[interventionIdNum] = clampDurationMs(
        new Date(movePayload.endAt).getTime() - new Date(movePayload.startAt).getTime()
      );
      await fetchData(true);
      showSuccessToast('Durata aggiornata');
    } catch (e) {
      safeRevert(info);
      setToast({ msg: 'Errore di rete', type: 'error' });
    } finally {
      patchInFlightRef.current.delete(interventionIdNum);
    }
  };

  const handleEventClick = async (info: any) => {
    const { event } = info;
    const interventionId = Number(event.id);
    const intervention = interventions.find(i => i.id === interventionId);

    if (intervention) {
      setSelectedIntervention(intervention);
    }
  };

  const syncCalendarDate = (fallbackDate?: Date) => {
    const calendarDate = calendarRef.current?.getApi().getDate();
    setCurrentCalendarDate(calendarDate ?? fallbackDate ?? new Date());
  };

  const handleCalendarNavigation = (direction: 'prev' | 'today' | 'next') => {
    if (!calendarRef.current) return;
    const calendarApi = calendarRef.current.getApi();
    if (direction === 'prev') calendarApi.prev();
    if (direction === 'today') calendarApi.today();
    if (direction === 'next') calendarApi.next();
    setIsDatePickerOpen(false);
    syncCalendarDate();
  };

  // New function to handle view changes
  const handleViewChange = (view: 'day' | 'week' | 'month') => {
    if (calendarRef.current) {
      const calendarApi = calendarRef.current.getApi();
      const safeView: 'day' | 'week' = view === 'week' ? 'week' : 'day';
      const newView = safeView === 'day' ? 'resourceTimeGridDay' : 'timeGridWeek';
      calendarApi.changeView(newView);
      setViewMode(safeView);
      if (plannerPrefs.defaultView !== safeView) {
        const nextPrefs = { ...plannerPrefs, defaultView: safeView };
        setPlannerPrefs(nextPrefs);
        savePlannerPreferences(nextPrefs);
      }
      setIsDatePickerOpen(false);
      syncCalendarDate();
    }
  };

  const handleCalendarDatePick = (nextValue: string) => {
    setCalendarDatePickerValue(nextValue);
    if (!nextValue) return;
    const [yearRaw, monthRaw, dayRaw] = nextValue.split('-').map(Number);
    if (!Number.isFinite(yearRaw) || !Number.isFinite(monthRaw) || !Number.isFinite(dayRaw)) return;
    const targetDate = new Date(yearRaw, monthRaw - 1, dayRaw, 12, 0, 0, 0);
    if (!Number.isFinite(targetDate.getTime())) return;
    const calendarApi = calendarRef.current?.getApi();
    if (!calendarApi) return;
    calendarApi.gotoDate(targetDate);
    setIsDatePickerOpen(false);
    syncCalendarDate(targetDate);
  };

  const effectiveTeams = useMemo(() => {
    if (!backendTeams) return [];
    if (backendTeams.length > 0) return backendTeams;
    if (import.meta.env.DEV) {
      return buildDemoTeamsFromTechnicians(technicians);
    }
    return [];
  }, [backendTeams, technicians]);
  const teamMaps = useMemo(() => buildTeamMapsFromTeams(effectiveTeams), [effectiveTeams]);
  const interventionsById = useMemo(() => {
    const byId = new Map<number, Intervention>();
    for (const intervention of interventions) {
      byId.set(intervention.id, intervention);
    }
    return byId;
  }, [interventions]);
  const teamColorById = useMemo(() => {
    const byId = new Map<number, string>();
    for (const team of teamMaps.teams) {
      const color = typeof team.color === 'string' ? team.color.trim() : '';
      if (color) byId.set(team.id, color);
    }
    return byId;
  }, [teamMaps.teams]);
  const teamIdFromTechId = useCallback((id?: number | null) => {
    if (!id) return null;
    return teamMaps.techIdToTeamId.get(id) ?? null;
  }, [teamMaps.techIdToTeamId]);
  const getTeamColorById = useCallback((teamId: number | string | null | undefined): string | null => {
    const normalizedTeamId = Number(teamId);
    if (!Number.isFinite(normalizedTeamId)) return null;
    return teamColorById.get(normalizedTeamId) ?? null;
  }, [teamColorById]);
  const getEventTeamColor = (event: any): string | null => {
    const resources = typeof event?.getResources === 'function' ? event.getResources() : [];
    const resourceTeamColor = getTeamColorById(resources[0]?.id);
    if (resourceTeamColor) return resourceTeamColor;

    const extendedTeamColor = getTeamColorById(event?.extendedProps?.teamId);
    if (extendedTeamColor) return extendedTeamColor;

    const fallbackTechColor = event?.extendedProps?.techColor;
    if (typeof fallbackTechColor !== 'string') return null;
    const trimmedFallback = fallbackTechColor.trim();
    return trimmedFallback ? trimmedFallback : null;
  };
  const getResolvedPlannerTeamId = useCallback((intervention: Intervention) => {
    const primaryTeamId = teamIdFromTechId(intervention.technicianId);
    const fallbackTeamId = teamIdFromTechId(intervention.secondaryTechnicianId);
    return primaryTeamId ?? fallbackTeamId ?? (teamMaps.teams[0]?.id ?? null);
  }, [teamIdFromTechId, teamMaps.teams]);
  const getTeamLabel = useCallback((id?: number | null) => {
    if (!id) return null;
    return teamMaps.techIdToTeamName.get(id) ?? null;
  }, [teamMaps.techIdToTeamName]);
  const getBacklogStatusLabel = (intervention: Intervention) =>
    (!intervention.startAt && !intervention.technicianId ? 'Da pianificare' : getStatusLabel(intervention.status));

  const getTeamAssignmentFromTeamId = (teamId: number | null) => {
    if (!teamId) return { technicianId: null as number | null, secondaryTechnicianId: null as number | null };
    const team = teamMaps.teams.find(t => t.id === teamId);
    if (!team) return { technicianId: null as number | null, secondaryTechnicianId: null as number | null };
    return {
      technicianId: team.memberIds[0] ?? null,
      secondaryTechnicianId: team.memberIds[1] ?? null
    };
  };
  const getTeamAssignmentErrorMessage = (teamId: number | null, required = true) => {
    if (!teamId) {
      return required ? 'Squadra non valida: ricarica dati e riprova' : null;
    }
    const team = teamMaps.teams.find(t => t.id === teamId);
    if (!team) {
      return 'Squadra non valida: ricarica dati e riprova';
    }
    if (!Array.isArray(team.memberIds) || team.memberIds.length === 0) {
      return `La squadra "${team.name}" non ha tecnici assegnati. Aggiungi almeno un tecnico in Squadre.`;
    }
    return null;
  };
  const isTeamSelected = (teamId: number) =>
    selectedTeamIds === 'ALL' || selectedTeamIds.includes(teamId);
  const selectAllTeams = () => setSelectedTeamIds('ALL');
  const clearTeams = () => setSelectedTeamIds('ALL');
  const toggleTeam = (teamId: number) => {
    setSelectedTeamIds(prev => {
      const allIds = teamMaps.teams.map(t => t.id);
      if (prev === 'ALL') {
        return allIds.filter(id => id !== teamId);
      }
      const exists = prev.includes(teamId);
      const next = exists ? prev.filter(id => id !== teamId) : [...prev, teamId];
      if (next.length === allIds.length) return 'ALL';
      return next;
    });
  };
  const selectedTeamsLabel = useMemo(() => {
    if (selectedTeamIds === 'ALL') return 'Tutte le Squadre';
    if (selectedTeamIds.length === 0) return 'Nessuna squadra';
    return `Squadre: ${selectedTeamIds.length}`;
  }, [selectedTeamIds]);
  const plannerDateLabel = useMemo(
    () => formatPlannerHeaderDate(currentCalendarDate, isMobile),
    [currentCalendarDate, isMobile]
  );

  useEffect(() => {
    setCalendarDatePickerValue(format(currentCalendarDate, 'yyyy-MM-dd'));
  }, [currentCalendarDate]);

  const toAnchorRect = (
    rectLike?: DuplicateAnchorRect | DOMRect | null,
    fallbackElement?: HTMLElement | null
  ): DuplicateAnchorRect | null => {
    if (rectLike) {
      return {
        left: rectLike.left,
        top: rectLike.top,
        width: rectLike.width,
        height: rectLike.height
      };
    }
    const fallbackRect = fallbackElement?.getBoundingClientRect?.();
    if (!fallbackRect) return null;
    return {
      left: fallbackRect.left,
      top: fallbackRect.top,
      width: fallbackRect.width,
      height: fallbackRect.height
    };
  };

  const openDuplicateAssignForIntervention = (interventionId: number, anchorRect?: DuplicateAnchorRect | DOMRect | null) => {
    const source =
      interventions.find(i => i.id === interventionId) ||
      backlog.find(i => i.id === interventionId) ||
      null;
    const currentTeamId = source ? teamIdFromTechId(source.technicianId) : null;
    const defaultTeamId =
      teamMaps.teams.find(t => t.id !== currentTeamId)?.id ?? teamMaps.teams[0]?.id ?? null;
    const menuRect = eventContextMenuPopoverRef.current?.getBoundingClientRect();
    const width = menuRect?.width ?? 320;
    const height = menuRect?.height ?? 220;
    const pad = 8;
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : width + pad * 2;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : height + pad * 2;
    const maxX = Math.max(pad, viewportWidth - width - pad);
    const maxY = Math.max(pad, viewportHeight - height - pad);
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
    const fallbackTriggerElement =
      typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const normalizedAnchorRect = toAnchorRect(anchorRect, fallbackTriggerElement);
    const fallbackCenterX = clamp(viewportWidth / 2 - width / 2, pad, maxX);
    const fallbackCenterY = clamp(viewportHeight / 2 - height / 2, pad, maxY);
    const x = normalizedAnchorRect
      ? clamp(normalizedAnchorRect.left + normalizedAnchorRect.width - width, pad, maxX)
      : clamp(fallbackCenterX, pad, maxX);
    const yAbove = normalizedAnchorRect ? normalizedAnchorRect.top - height - 8 : fallbackCenterY;
    const y = normalizedAnchorRect
      ? (yAbove >= pad
          ? clamp(yAbove, pad, maxY)
          : clamp(normalizedAnchorRect.top + normalizedAnchorRect.height + 8, pad, maxY))
      : clamp(fallbackCenterY, pad, maxY);
    setHoverCard(null);
    setEventContextMenu({
      x,
      y,
      interventionId,
      mode: 'duplicate',
      targetTeamId: defaultTeamId,
      anchorRect: normalizedAnchorRect
    });
  };

  const handleDuplicateInterventionToTeam = async () => {
    if (!eventContextMenu) return;
    if (isDuplicatingIntervention) return;
    if (!eventContextMenu.targetTeamId) {
      setToast({ msg: 'Seleziona una squadra per la duplicazione', type: 'error' });
      return;
    }
    const assignmentError = getTeamAssignmentErrorMessage(eventContextMenu.targetTeamId, true);
    if (assignmentError) {
      setToast({ msg: assignmentError, type: 'error' });
      return;
    }

    const assignment = getTeamAssignmentFromTeamId(eventContextMenu.targetTeamId);
    if (!assignment.technicianId) {
      setToast({ msg: getTeamAssignmentErrorMessage(eventContextMenu.targetTeamId, true) ?? 'Squadra non valida', type: 'error' });
      return;
    }

    setIsDuplicatingIntervention(true);
    try {
      const res = await apiFetch(`/api/interventions/${eventContextMenu.interventionId}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(assignment)
      });
      const payload = await res.json().catch(() => null);

      if (!res.ok) {
        setToast({
          msg: getApiErrorMessage(res, payload, 'Errore duplicazione intervento'),
          type: 'error'
        });
        setEventContextMenu(null);
        return;
      }

      await fetchData();
      setToast({ msg: 'Intervento duplicato', type: 'success' });
      setEventContextMenu(null);
    } catch (error) {
      setToast({ msg: 'Errore di rete', type: 'error' });
      setEventContextMenu(null);
    } finally {
      setIsDuplicatingIntervention(false);
    }
  };

  const handleEventMouseEnter = (info: any) => {
    if (isDraggingEvent) return;
    const { event, jsEvent } = info;
    const id = Number(event.id);
    const item = interventionsById.get(id);
    const teamLabel = item ? getTeamLabel(item.technicianId) : null;
    const start = event.start;
    const end = event.end;
    const time = start
      ? `${format(start, 'dd MMM HH:mm', { locale: it })}${end ? ` - ${format(end, 'HH:mm', { locale: it })}` : ''}`
      : undefined;

    setHoverCard({
      x: jsEvent.clientX,
      y: jsEvent.clientY,
      title: item?.title || event.title,
      address: item?.address,
      team: teamLabel || undefined,
      time,
      status: item?.status || event.extendedProps.status,
      priority: item?.priority
    });
  };

  const handleEventMouseLeave = () => {
    setHoverCard(null);
  };

  const handleDateClick = (info: any) => {
    if (info?.jsEvent?.target?.closest?.('.fc-event')) return;
    const teamIdFromResource = info.resource ? Number(info.resource.id) : null;
    const filteredSingleTeamId =
      selectedTeamIds !== 'ALL' && selectedTeamIds.length === 1 ? selectedTeamIds[0] : null;
    const teamId = Number.isFinite(teamIdFromResource) ? teamIdFromResource : filteredSingleTeamId;
    setSlotConfirm({ date: info.date, teamId });
  };

  const filteredResources = useMemo(
    () => teamMaps.teams.filter((team) => selectedTeamIds === 'ALL' || selectedTeamIds.includes(team.id)),
    [selectedTeamIds, teamMaps.teams]
  );

  const filteredInterventions = useMemo(() => interventions.filter(i => {
    if (selectedTeamIds !== 'ALL') {
      const resolvedTeamId = getResolvedPlannerTeamId(i);
      if (!resolvedTeamId || !selectedTeamIds.includes(resolvedTeamId)) return false;
    }
    if (filterStatus === 'DONE' && i.status !== 'COMPLETED') return false;
    const isToDoStatus = i.status === 'SCHEDULED' || i.status === 'IN_PROGRESS';
    if (filterStatus === 'TO_DO' && !isToDoStatus) return false;
    if (filterStatus === 'TO_BILL') {
      if (i.status !== 'COMPLETED') return false;
      if (i.workReport && i.workReport.emailedAt) return false;
    }
    return true;
  }), [filterStatus, interventions, selectedTeamIds]);
  const plannerConflictIds = useMemo(() => {
    const grouped = new Map<number, Array<{ id: number; startMs: number; endMs: number }>>();
    for (const intervention of interventions) {
      if (!intervention.startAt || !intervention.endAt || !intervention.technicianId) continue;
      const resolvedTeamId = getResolvedPlannerTeamId(intervention);
      if (!resolvedTeamId) continue;
      const startMs = new Date(intervention.startAt).getTime();
      const endMs = new Date(intervention.endAt).getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
      const arr = grouped.get(resolvedTeamId) ?? [];
      arr.push({ id: intervention.id, startMs, endMs });
      grouped.set(resolvedTeamId, arr);
    }

    const conflicts = new Set<number>();
    for (const entries of grouped.values()) {
      entries.sort((a, b) => a.startMs - b.startMs);
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          if (entries[j].startMs >= entries[i].endMs) break;
          if (entries[i].startMs < entries[j].endMs && entries[i].endMs > entries[j].startMs) {
            conflicts.add(entries[i].id);
            conflicts.add(entries[j].id);
          }
        }
      }
    }

    return conflicts;
  }, [interventions, teamMaps]);

  const filteredBacklog = useMemo(() => backlog.filter(i => {
    if (selectedTeamIds !== 'ALL') {
      const hasAssignedTeam = Boolean(i.technicianId || i.secondaryTechnicianId);
      // Keep unassigned backlog visible to allow quick dispatch from any filtered view.
      if (hasAssignedTeam) {
        const resolvedTeamId = getResolvedPlannerTeamId(i);
        if (!resolvedTeamId || !selectedTeamIds.includes(resolvedTeamId)) return false;
      }
    }
    if (filterStatus === 'DONE' && i.status !== 'COMPLETED') return false;
    const isToDoStatus = i.status === 'SCHEDULED' || i.status === 'IN_PROGRESS';
    if (filterStatus === 'TO_DO' && !isToDoStatus) return false;
    if (filterStatus === 'TO_BILL') {
      if (i.status !== 'COMPLETED') return false;
      if (i.workReport && i.workReport.emailedAt) return false;
    }
    return true;
  }), [backlog, filterStatus, selectedTeamIds]);
  const plannerResultCount = filteredInterventions.length + filteredBacklog.length;
  const hasActivePlannerFilters = Boolean(
    filterStatus !== 'ALL' || selectedTeamIds !== 'ALL'
  );
  const resetPlannerFilters = () => {
    setFilterStatus('ALL');
    setSelectedTeamIds('ALL');
  };
  const visibleCalendarEvents = useMemo(() => filteredInterventions.flatMap(i => {
    const resolvedTeamId = getResolvedPlannerTeamId(i);
    if (!i.startAt || !i.endAt || !resolvedTeamId) return [];
    const bgColor = getTeamColorById(resolvedTeamId) || '#3b82f6';

    return [{
      id: String(i.id),
      title: i.title,
      start: i.startAt,
      end: i.endAt,
      resourceId: String(resolvedTeamId),
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      classNames: ['glass-event'],
      extendedProps: {
        teamId: resolvedTeamId,
        techColor: bgColor,
        status: i.status,
        priority: i.priority,
        address: i.address,
        version: i.version,
        hasConflict: plannerConflictIds.has(i.id)
      }
    }];
  }), [filteredInterventions, getResolvedPlannerTeamId, plannerConflictIds, getTeamColorById]);
  const plannerResourceAreaWidth = isMobile ? 120 : 210;
  const plannerDayColumns = viewMode === 'week' ? 7 : Math.max(1, filteredResources.length);
  const plannerColumnMinWidth = viewMode === 'week' ? (isMobile ? 184 : 256) : (isMobile ? 84 : 160);
  const plannerMinWidth = Math.max(
    isMobile ? 640 : 860,
    (viewMode === 'day'
      ? plannerResourceAreaWidth + plannerDayColumns * plannerColumnMinWidth
      : plannerDayColumns * plannerColumnMinWidth + (isMobile ? 60 : 80))
  );
  const statusFilterLabels = {
    ALL: 'Tutti',
    TO_DO: 'Da concludere',
    DONE: 'Conclusi',
    TO_BILL: 'Da contabilizzare'
  } as const;
  const plannerHeaderFilterButtonClass =
    'motion-premium inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[11px] font-semibold border border-slate-200 bg-slate-50 text-slate-700 whitespace-nowrap transition-[border-color,background-color,color,box-shadow] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:border-orange-400 hover:bg-white hover:text-slate-900 hover:shadow-[0_0_0_1px_rgba(249,115,22,0.14)]';

  return (
    <AppLayout
      title="Planner"
      hideHeaderSearch
      contentClassName="space-y-6"
      headerInlineContent={
        <div className="min-w-0 w-full flex items-center gap-2">
          <button
            type="button"
            onClick={(event) => toggleTeamFilterMenu(event.currentTarget)}
            className={plannerHeaderFilterButtonClass}
            aria-haspopup="listbox"
            aria-expanded={isTeamFilterOpen}
          >
            Squadre: {selectedTeamsLabel}
            <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
          </button>
          {selectedTeamIds !== 'ALL' && (
            <span className="rounded-md px-2 py-1 text-[10px] font-semibold border border-slate-200 bg-white text-slate-600 whitespace-nowrap">
              {selectedTeamIds.length}
            </span>
          )}
          <button
            type="button"
            onClick={(event) => toggleStatusFilterMenu(event.currentTarget)}
            className={plannerHeaderFilterButtonClass}
            aria-haspopup="listbox"
            aria-expanded={isStatusFilterOpen}
          >
            Stato: {statusFilterLabels[filterStatus]}
            <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
          </button>
          <button
            type="button"
            onClick={() => setIsColorsModalOpen(true)}
            className={cn(plannerHeaderFilterButtonClass, 'text-slate-600 hover:text-slate-800')}
          >
            <div className="w-2.5 h-2.5 rounded-full bg-slate-400" />
            Colori Squadre
          </button>
          <div className="rounded-md px-2.5 py-1.5 text-[11px] font-semibold border border-slate-200 bg-slate-50 text-slate-600 whitespace-nowrap">
            Schedulati visibili: {visibleCalendarEvents.length}
          </div>
        </div>
      }
    >
      <div className="lg:hidden bg-white border border-slate-200 rounded-lg px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={(event) => toggleTeamFilterMenu(event.currentTarget)}
            className={plannerHeaderFilterButtonClass}
            aria-haspopup="listbox"
            aria-expanded={isTeamFilterOpen}
          >
            Squadre
            <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
          </button>
          <button
            type="button"
            onClick={(event) => toggleStatusFilterMenu(event.currentTarget)}
            className={plannerHeaderFilterButtonClass}
            aria-haspopup="listbox"
            aria-expanded={isStatusFilterOpen}
          >
            Stato: {statusFilterLabels[filterStatus]}
            <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
          </button>
          <button
            type="button"
            onClick={() => setIsColorsModalOpen(true)}
            className={cn(plannerHeaderFilterButtonClass, 'text-slate-600 hover:text-slate-800')}
          >
            <div className="w-2.5 h-2.5 rounded-full bg-slate-400" />
            Colori Squadre
          </button>
          <div className="rounded-md px-2.5 py-1.5 text-[11px] font-semibold border border-slate-200 bg-slate-50 text-slate-600 whitespace-nowrap">
            Schedulati visibili: {visibleCalendarEvents.length}
          </div>
        </div>
      </div>

      <div
        ref={plannerShellRef}
        className={cn(
          "grid grid-cols-1 gap-4 items-start lg:transition-[grid-template-columns] lg:duration-150 lg:ease-out",
          shouldShowCollapsedBacklogRail
            ? "lg:grid-cols-[3.5rem_minmax(0,1fr)]"
            : "lg:grid-cols-[17.5rem_minmax(0,1fr)]"
        )}
      >
        <div
          ref={backlogColumnRef}
          className={cn(
            "order-2 lg:order-1 w-full overflow-hidden",
            shouldShowCollapsedBacklogRail ? "lg:w-14" : "lg:w-[280px]"
          )}
        >
          <aside
            ref={backlogRef}
            className={cn(
              "relative bg-white border border-slate-200 rounded-lg overflow-visible flex flex-col h-full shadow-sm",
              isDraggingEvent ? "ring-2 ring-[var(--brand)]/30" : ""
            )}
          >
            <div
              className={cn(
                "hidden lg:flex absolute left-0 top-0 bottom-0 w-14 min-h-[560px] flex-col items-center justify-between py-4 transition-all duration-150 ease-out",
                shouldShowCollapsedBacklogRail
                  ? "opacity-100 translate-x-0 pointer-events-auto"
                  : "opacity-0 -translate-x-1 pointer-events-none"
              )}
              aria-hidden={!shouldShowCollapsedBacklogRail}
            >
              <div className="flex flex-col items-center gap-3">
                <button
                  type="button"
                  onClick={() => setBacklogCollapsed(false)}
                  aria-label="Apri backlog"
                  title="Apri backlog"
                  className="backlog-shell-action-btn motion-premium rounded-md p-2 border border-slate-200 bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-600">
                  <List className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="flex flex-col items-center gap-2 pb-1">
                <div
                  className="backlog-kpi-unscheduled rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700"
                  title={`Non pianificati: ${filteredBacklog.length}`}
                >
                  {filteredBacklog.length}
                </div>
                <div
                  className="backlog-kpi-scheduled rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700"
                  title={`Schedulati: ${visibleCalendarEvents.length}`}
                >
                  {visibleCalendarEvents.length}
                </div>
              </div>
            </div>

            <div
              className={cn(
                "flex h-full flex-col transition-opacity duration-150",
                shouldShowCollapsedBacklogRail
                  ? "opacity-0 pointer-events-none select-none lg:invisible"
                  : "opacity-100 pointer-events-auto"
              )}
              aria-hidden={shouldShowCollapsedBacklogRail}
            >
          <div className="backlog-team-filter-shell px-4 py-3 border-b border-slate-200 bg-slate-50/50 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
              <p className="backlog-team-filter-title text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Squadre</p>
              <p className="backlog-team-filter-subtitle mt-1 text-[11px] text-slate-500">Seleziona cosa vedere</p>
              </div>
              {!isMobile && (
                <button
                  type="button"
                  onClick={() => setBacklogCollapsed(true)}
                  aria-label="Chiudi backlog"
                  title="Chiudi backlog"
                  className="backlog-shell-action-btn motion-premium rounded-md p-2 border border-slate-200 bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={(event) => toggleTeamFilterMenu(event.currentTarget)}
              className="backlog-team-select-btn motion-premium rounded-md border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-700 w-full text-left"
              aria-haspopup="listbox"
              aria-expanded={isTeamFilterOpen}
            >
              {selectedTeamsLabel}
            </button>
          </div>

          <div className="px-4 py-3 border-b border-slate-200 bg-white space-y-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="backlog-kpi-unscheduled rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-700">
                Non pianificati: {filteredBacklog.length}
              </span>
              <span className="backlog-kpi-scheduled rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                Schedulati: {visibleCalendarEvents.length}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-slate-200 pt-2">
              <h2 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Backlog
              </h2>
              <div className="text-[11px] text-slate-400">Drag & drop</div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5 custom-scrollbar min-h-[280px]">
            {filteredBacklog.map(item => {
              const primaryTeamId = teamIdFromTechId(item.technicianId);
              const secondaryTeamId = teamIdFromTechId(item.secondaryTechnicianId);
              const backlogTeamId = primaryTeamId ?? secondaryTeamId;
              const backlogTeamColor = getTeamColorById(backlogTeamId);
              const backlogEdgeColor = backlogTeamColor ?? '#94a3b8';
              const isUnscheduledBacklog = !item.startAt && !item.technicianId;
              const backlogDurationMs = item.startAt && item.endAt
                ? new Date(item.endAt).getTime() - new Date(item.startAt).getTime()
                : (lastDurationMsRef.current[item.id] ?? DEFAULT_EVENT_DURATION_MS);
              const backlogDurationMinutes = Math.max(
                1,
                Math.round(clampDurationMs(backlogDurationMs) / 60000)
              );
              return (
                <div
                  key={item.id}
                  onClick={() => setSelectedIntervention(item)}
                  className={cn(
                    "fc-event motion-premium bg-white border border-slate-200 border-l-4 rounded-lg px-2.5 py-2 shadow-sm hover:-translate-y-[1px] hover:shadow-md hover:border-slate-300",
                    !backlogTeamColor ? "border-l-slate-300" : "",
                    isUnscheduledBacklog ? "backlog-unscheduled-card" : "",
                    isDraggingEvent ? "cursor-grabbing ring-2 ring-[var(--brand)]/30" : "cursor-grab"
                  )}
                  style={backlogTeamColor ? { borderLeftColor: backlogTeamColor } : undefined}
                  data-id={item.id}
                  data-title={item.title}
                  data-color={backlogEdgeColor}
                  data-duration-minutes={backlogDurationMinutes}
                >
                  <div className="flex justify-between items-start gap-2 mb-1.5">
                    <h3 className="text-sm font-semibold leading-tight text-slate-900 truncate">{item.title}</h3>
                    <div className="flex flex-col gap-1 items-end">
                      <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 whitespace-nowrap text-[10px] font-medium uppercase tracking-wide', getPriorityBadge(item.priority))}>
                        {getPriorityIcon(item.priority)}
                        {item.priority}
                      </span>
                      <span className={cn('inline-flex items-center rounded-md border px-1.5 py-0.5 whitespace-nowrap text-[10px] font-medium uppercase tracking-wide', getPlannerStatusBadge(item.status))}>
                        {getBacklogStatusLabel(item)}
                      </span>
                    </div>
                  </div>
                  {item.address ? <p className="text-[12px] text-slate-600 truncate">{item.address}</p> : null}
                </div>
              );
            })}
            {filteredBacklog.length === 0 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center space-y-3">
                <p className="text-sm font-semibold text-slate-700">
                  {hasActivePlannerFilters
                    ? 'Nessun intervento nel backlog con i filtri attuali'
                    : 'Nessun intervento in attesa nel backlog'}
                </p>
                {hasActivePlannerFilters ? (
                  <button
                    type="button"
                    onClick={resetPlannerFilters}
                    className="motion-premium rounded-md px-3 py-1.5 text-[11px] font-semibold border border-slate-200 bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-100"
                  >
                    Reset filtri
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setCreatePrefill(null);
                      setEditingIntervention(null);
                      setIsModalOpen(true);
                    }}
                    className="motion-premium rounded-md px-3 py-1.5 text-[11px] font-semibold border border-slate-200 bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-100"
                  >
                    Nuovo intervento
                  </button>
                )}
              </div>
            )}
          </div>
            </div>
          </aside>
        </div>

        <section className="order-1 lg:order-2 space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 space-y-2.5">
            <div className="grid grid-cols-1 lg:grid-cols-[auto_minmax(0,1fr)_auto] gap-4 items-center">
              <div className="justify-self-start">
                <div className="inline-flex items-center gap-1 rounded-md bg-slate-100 p-1">
                  <button
                    onClick={() => handleViewChange('day')}
                    className={cn(
                      'motion-premium px-4 py-2 rounded-md text-xs font-semibold',
                      viewMode === 'day' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                    )}
                  >
                    Day
                  </button>
                  {!isMobile && (
                    <button
                      onClick={() => handleViewChange('week')}
                      className={cn(
                        'motion-premium px-4 py-2 rounded-md text-xs font-semibold',
                        viewMode === 'week' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                      )}
                    >
                      Week
                    </button>
                  )}
                </div>
              </div>

              <div className="min-w-0 flex flex-col items-start lg:items-center gap-2">
                <button
                  type="button"
                  ref={datePickerAnchorElRef}
                  onClick={(event) => toggleDatePickerMenu(event.currentTarget)}
                  className="inline-flex items-center gap-2 rounded-md border border-transparent px-2 py-1 text-2xl font-semibold tracking-wide text-slate-900 hover:border-slate-200 hover:bg-slate-50"
                  aria-haspopup="dialog"
                  aria-expanded={isDatePickerOpen}
                >
                  <CalendarDays className="w-5 h-5 text-slate-500" />
                  <span className="truncate max-w-full">{plannerDateLabel}</span>
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleCalendarNavigation('prev')}
                    className="motion-premium rounded-md p-2 border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                    aria-label="Periodo precedente"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleCalendarNavigation('today')}
                    className="motion-premium rounded-md px-3 py-1.5 text-xs font-semibold border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                  >
                    Oggi
                  </button>
                  <button
                    onClick={() => handleCalendarNavigation('next')}
                    className="motion-premium rounded-md p-2 border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                    aria-label="Periodo successivo"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="justify-self-start lg:justify-self-end flex items-center flex-wrap gap-2">
                <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
                  <Link to="/customers" className="motion-premium inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 lg:hidden whitespace-nowrap">
                    <Users className="w-4 h-4" />
                    Clienti
                  </Link>
                  <button
                    onClick={() => setIsListModalOpen(true)}
                    className="motion-premium inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    <List className="w-4 h-4" />
                    Cerca
                  </button>
                </div>
                <button
                  onClick={() => {
                    setCreatePrefill(null);
                    setEditingIntervention(null);
                    setIsModalOpen(true);
                  }}
                  className="motion-premium inline-flex items-center gap-2 rounded-md bg-[var(--brand)] px-5 py-2.5 text-sm font-semibold text-white whitespace-nowrap shadow-md hover:brightness-95"
                >
                  <Plus className="w-4 h-4" />
                  Nuovo Intervento
                </button>
              </div>
            </div>
          </div>

          {(dataLoadError || isDataLoading) && (
            <div className="flex flex-wrap items-center gap-2">
              {isDataLoading && (
                <div className="rounded-md px-3 py-1.5 text-[11px] font-semibold border border-slate-200 bg-slate-50 text-slate-600">
                  Caricamento...
                </div>
              )}
              {dataLoadError && (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 flex flex-wrap items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500" />
                  <span>{dataLoadError}</span>
                  <button
                    type="button"
                    onClick={() => void fetchData(true)}
                    className="motion-premium rounded-md px-3 py-1 text-[11px] font-semibold border border-slate-200 bg-white text-slate-600 hover:text-slate-800"
                  >
                    Riprova
                  </button>
                </div>
              )}
            </div>
          )}

          {plannerResultCount === 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {hasActivePlannerFilters
                      ? 'Nessun risultato con i filtri attuali'
                      : 'Planner vuoto: nessun intervento disponibile'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {hasActivePlannerFilters
                      ? 'Prova a rimuovere qualche filtro per rivedere gli interventi.'
                      : 'Crea un nuovo intervento oppure aggiorna i dati.'}
                  </p>
                </div>
                {hasActivePlannerFilters ? (
                  <button
                    type="button"
                    onClick={resetPlannerFilters}
                    className="motion-premium rounded-md px-3 py-1.5 text-[11px] font-semibold border border-slate-200 bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-100"
                  >
                    Reset filtri
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setCreatePrefill(null);
                      setEditingIntervention(null);
                      setIsModalOpen(true);
                    }}
                    className="motion-premium rounded-md px-3 py-1.5 text-[11px] font-semibold border border-slate-200 bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-100"
                  >
                    Nuovo intervento
                  </button>
                )}
              </div>
            </div>
          )}

          <main
            ref={plannerMainRef}
            className="relative w-full bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col h-[calc(100vh-260px)] min-h-[640px] overflow-x-auto overflow-y-hidden"
          >
            <div
              className={cn('h-full', isAnyModalOpen && 'pointer-events-none opacity-90')}
              style={{ minWidth: `${plannerMinWidth}px` }}
              aria-disabled={isAnyModalOpen}
            >
              <FullCalendar
              ref={calendarRef}
              plugins={[resourceTimeGridPlugin, timeGridPlugin, interactionPlugin]}
              schedulerLicenseKey={schedulerLicenseKey}
              initialView={viewMode === 'week' && !isMobile ? 'timeGridWeek' : 'resourceTimeGridDay'}
              views={{
                resourceTimeGridDay: {
                  duration: { days: 1 }
                },
                timeGridWeek: {
                  duration: { days: 7 },
                  dateIncrement: { weeks: 1 }
                }
              }}
              resources={filteredResources.map((team) => ({ id: String(team.id), title: team.name }))}
              resourceAreaHeaderContent="Squadre"
              resourceAreaWidth={`${plannerResourceAreaWidth}px`}
              events={visibleCalendarEvents}
              eventContent={(arg) => {
              const { event } = arg;
              const id = Number(event.id);
              const item = interventionsById.get(id);
              const status = item?.status || event.extendedProps.status;
              const priority = item?.priority;
              const resolvedTeamColor = getEventTeamColor(event);
              const teamColor = resolvedTeamColor ?? '#94a3b8';
              const hasConflict = Boolean(event.extendedProps.hasConflict);
              const start = event.start ? format(event.start, 'HH:mm') : '';
              const end = event.end ? format(event.end, 'HH:mm') : '';
              return (
                <div
                  className={cn(
                    "motion-premium h-full w-full bg-white rounded-lg border border-slate-200 border-l-4 px-2.5 py-2 flex flex-col justify-between shadow-sm hover:-translate-y-[1px] hover:shadow-md hover:border-slate-300",
                    !resolvedTeamColor ? "border-l-slate-300" : "",
                    hasConflict ? "ring-2 ring-amber-300 border-amber-300" : ""
                  )}
                  style={{ borderLeftColor: teamColor }}
                >
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-semibold leading-tight text-slate-900 truncate">{item?.title || event.title}</div>
                      {hasConflict && (
                        <span className="text-[9px] font-semibold text-amber-700 whitespace-nowrap">⚠ Sovrapposto</span>
                      )}
                    </div>
                    <div className="text-[12px] text-slate-600 truncate">{item?.address}</div>
                  </div>
                  <div className="flex flex-col items-start gap-1 mt-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {priority && (
                        <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide', getPriorityBadge(priority))}>
                          {getPriorityIcon(priority)}
                          {priority}
                        </span>
                      )}
                      {status && (
                        <span className={cn('inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide', getPlannerStatusBadge(status))}>
                          {getStatusLabel(status)}
                        </span>
                      )}
                    </div>
                    <span className="text-[12px] font-medium text-slate-700">{start && end ? `${start} - ${end}` : ''}</span>
                  </div>
                </div>
              );
            }}
            editable={!isAnyModalOpen}
            eventStartEditable={!isAnyModalOpen}
            eventDurationEditable={!isAnyModalOpen}
            eventResizableFromStart={!isAnyModalOpen}
            droppable={!isAnyModalOpen}
            dragRevertDuration={120}
            eventDragMinDistance={3}
            longPressDelay={160}
            eventLongPressDelay={160}
            fixedMirrorParent={dragMirrorParent}
            dragScroll={true}
            slotMinTime={formatHourToSlot(plannerPrefs.dayStartHour)}
            slotMaxTime={formatHourToSlot(plannerPrefs.dayEndHour)}
            slotDuration="00:15:00"
            snapDuration="00:15:00"
            slotLabelFormat={{
              hour: '2-digit',
              minute: '2-digit',
              hour12: false
            }}
            headerToolbar={false}
            allDaySlot={false}
            height="100%"
            expandRows={true}
            datesSet={(arg: any) => {
              syncCalendarDate(arg?.start ? new Date(arg.start) : undefined);
              const start = arg?.startStr;
              const end = arg?.endStr;
              if (typeof start === 'string' && typeof end === 'string') {
                setVisibleRange({ start, end });
              }
            }}
            eventReceive={handleEventReceive}
            eventDrop={handleEventDrop}
            eventDragStop={handleEventDragStop}
            eventDragStart={handleEventDragStart}
            eventResizeStart={handleEventResizeStart}
            eventResizeStop={handleEventResizeStop}
            eventResize={handleEventResize}
            eventClick={handleEventClick}
            eventMouseEnter={handleEventMouseEnter}
            eventMouseLeave={handleEventMouseLeave}
            eventDidMount={(arg: any) => {
              const preventContextMenuHandler = (event: MouseEvent) => {
                event.preventDefault();
              };
              (arg.el as any).__dispatcherContextMenuPreventDefaultHandler = preventContextMenuHandler;
              arg.el.addEventListener('contextmenu', preventContextMenuHandler);
            }}
            eventWillUnmount={(arg: any) => {
              const preventContextMenuHandler = (arg.el as any).__dispatcherContextMenuPreventDefaultHandler as ((event: MouseEvent) => void) | undefined;
              if (preventContextMenuHandler) {
                arg.el.removeEventListener('contextmenu', preventContextMenuHandler);
                delete (arg.el as any).__dispatcherContextMenuPreventDefaultHandler;
              }
            }}
            dateClick={handleDateClick}
            />
            </div>
          </main>
        </section>

      </div>

      {isTeamFilterOpen && teamFilterMenuPos && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={teamFilterMenuRef}
              className="fixed z-[9999] max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white p-3 shadow-md space-y-2 custom-scrollbar motion-premium"
              style={{ left: teamFilterMenuPos.left, top: teamFilterMenuPos.top, width: teamFilterMenuPos.width }}
              role="listbox"
              aria-label="Filtro squadre planner"
              tabIndex={-1}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  setIsTeamFilterOpen(false);
                }
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={selectAllTeams}
                  className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                >
                  Tutte le squadre
                </button>
                <button
                  type="button"
                  onClick={clearTeams}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-700"
                >
                  Pulisci
                </button>
              </div>
              <div className="space-y-1">
                {teamMaps.teams.map(team => (
                  <label
                    key={team.id}
                    role="option"
                    aria-selected={isTeamSelected(team.id)}
                    className="w-full flex items-center gap-2 rounded-md border border-transparent px-2 py-2 hover:bg-slate-50 hover:border-slate-200 text-left cursor-pointer motion-premium"
                  >
                    <input
                      type="checkbox"
                      checked={isTeamSelected(team.id)}
                      onChange={() => toggleTeam(team.id)}
                      className="h-4 w-4 rounded border-white/70 accent-brand-500"
                    />
                    <span className="text-sm text-slate-700">{team.name}</span>
                  </label>
                ))}
              </div>
            </div>,
            document.body
          )
        : null}

      {isStatusFilterOpen && statusFilterMenuPos && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={statusFilterMenuRef}
              className="fixed z-[9999] max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white p-2 shadow-md space-y-1 custom-scrollbar motion-premium"
              style={{ left: statusFilterMenuPos.left, top: statusFilterMenuPos.top, width: Math.max(statusFilterMenuPos.width, 190) }}
              role="listbox"
              aria-label="Filtro stato planner"
              tabIndex={-1}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  setIsStatusFilterOpen(false);
                }
              }}
            >
              {(['ALL', 'TO_DO', 'DONE', 'TO_BILL'] as const).map((statusKey) => (
                <button
                  key={statusKey}
                  type="button"
                  role="option"
                  aria-selected={filterStatus === statusKey}
                  onClick={() => {
                    setFilterStatus(statusKey);
                    setIsStatusFilterOpen(false);
                  }}
                  className={cn(
                    'w-full text-left motion-premium rounded-md px-3 py-2 text-sm border',
                    filterStatus === statusKey
                      ? 'bg-white text-slate-900 border-slate-200 shadow-sm'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:text-slate-800 hover:bg-white'
                  )}
                >
                  {statusFilterLabels[statusKey]}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}

      {isDatePickerOpen && datePickerMenuPos && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={datePickerMenuRef}
              className="fixed z-[9999] rounded-lg border border-slate-200 bg-white p-3 shadow-md space-y-2"
              style={{ left: datePickerMenuPos.left, top: datePickerMenuPos.top, width: datePickerMenuPos.width }}
              role="dialog"
              aria-label="Selettore data planner"
              tabIndex={-1}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  setIsDatePickerOpen(false);
                }
              }}
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Vai al giorno
              </div>
              <input
                type="date"
                value={calendarDatePickerValue}
                onChange={(event) => handleCalendarDatePick(event.target.value)}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-brand-400/40"
              />
            </div>,
            document.body
          )
        : null}

      {eventContextMenu && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={eventContextMenuPopoverRef}
              className="fixed z-[9999] glass-card border border-white/70 shadow-xl rounded-2xl p-3 w-80"
              style={{ left: eventContextMenu.x, top: eventContextMenu.y }}
            >
              <div className="space-y-3">
                <div className="text-xs font-semibold text-slate-700">
                  Duplica su un'altra squadra
                </div>
                <select
                  value={eventContextMenu.targetTeamId ?? ''}
                  onChange={(e) => setEventContextMenu(prev => prev ? {
                    ...prev,
                    targetTeamId: e.target.value ? Number(e.target.value) : null
                  } : prev)}
                  className="glass-input rounded-xl px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-brand-400/40 w-full"
                >
                  <option value="">Seleziona squadra...</option>
                  {teamMaps.teams.map(team => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => setEventContextMenu(null)}
                    className="btn-secondary glass-chip text-xs"
                  >
                    Annulla
                  </button>
                  <button
                    onClick={handleDuplicateInterventionToTeam}
                    className="btn-primary text-xs px-3 py-2"
                    disabled={!eventContextMenu.targetTeamId || isDuplicatingIntervention}
                  >
                    {isDuplicatingIntervention ? 'Duplicazione...' : 'Crea duplicato'}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {hoverCard && (
        <div
          className="fixed z-[120] glass-card border border-white/70 shadow-lg rounded-2xl p-3 text-xs text-slate-700 pointer-events-none w-56"
          style={{ left: hoverCard.x + 12, top: hoverCard.y + 12 }}
        >
          <div className="font-bold text-slate-800 truncate">{hoverCard.title}</div>
          {hoverCard.team && <div className="text-slate-500 mt-1">Squadra: {hoverCard.team}</div>}
          {hoverCard.time && <div className="text-slate-500 mt-1">{hoverCard.time}</div>}
          {hoverCard.address && <div className="text-slate-500 mt-1 truncate">{hoverCard.address}</div>}
          {hoverCard.status && (
            <div className="text-slate-500 mt-1">Stato: {getStatusLabel(hoverCard.status)}</div>
          )}
        </div>
      )}

      {slotConfirm && (
        <div className="fixed inset-0 bg-black/30 z-[130] flex items-center justify-center p-4 backdrop-blur-md">
          <div className="glass-modal rounded-3xl shadow-2xl max-w-sm w-full p-5 space-y-4 border border-white/70">
            <h3 className="font-bold text-slate-800 text-lg">Nuovo intervento</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Vuoi creare un nuovo intervento
              {slotConfirm.teamId ? (
                <>
                  {' '}per{' '}
                  <span className="font-semibold">
                    {teamMaps.teams.find(t => t.id === slotConfirm.teamId)?.name || 'Squadra'}
                  </span>
                </>
              ) : null}
              {' '}il{' '}
              <span className="font-semibold">{format(slotConfirm.date, 'dd MMM yyyy', { locale: it })}</span>{' '}
              alle{' '}
              <span className="font-semibold">{format(slotConfirm.date, 'HH:mm')}</span>?
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setSlotConfirm(null)}
                className="btn-secondary glass-chip text-sm"
              >
                Annulla
              </button>
              <button
                onClick={() => {
                  if (!slotConfirm) return;
                  const assignmentError = getTeamAssignmentErrorMessage(slotConfirm.teamId, false);
                  if (assignmentError) {
                    setToast({ msg: assignmentError, type: 'error' });
                    return;
                  }
                  const assignment = getTeamAssignmentFromTeamId(slotConfirm.teamId);
                  const pad = (v: number) => String(v).padStart(2, '0');
                  const start = slotConfirm.date;
                  const end = new Date(start.getTime() + 60 * 60 * 1000);
                  const scheduledDate = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
                  const startTime = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
                  const endTime = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
                  setCreatePrefill({
                    scheduledDate,
                    startTime,
                    endTime,
                    technicianId: assignment.technicianId ?? undefined,
                    secondaryTechnicianId: assignment.secondaryTechnicianId ?? undefined
                  });
                  setSlotConfirm(null);
                  setEditingIntervention(null);
                  setIsModalOpen(true);
                }}
                className="btn-primary text-sm px-4 py-2"
              >
                Crea
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={cn(
          "fixed bottom-6 right-6 px-4 py-3 rounded-lg shadow-lg text-white flex items-center gap-2 animate-in slide-in-from-bottom-5 fade-in duration-300 z-50",
          toast.type === 'error' ? "bg-red-600" : toast.type === 'info' ? "bg-slate-900" : "bg-emerald-600"
        )}>
          {toast.type === 'error' && <AlertCircle className="w-5 h-5" />}
          {toast.type === 'info' && <Info className="w-5 h-5" />}
          {toast.msg}
          <button onClick={() => setToast(null)} className="ml-2 opacity-70 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <CreateInterventionModal
          mode={editingIntervention ? 'edit' : 'create'}
          initialData={editingIntervention || undefined}
          prefill={createPrefill ?? undefined}
          onClose={closeCreateInterventionModal}
          onSuccess={() => {
            closeCreateInterventionModal();
            fetchData();
            setToast({ msg: editingIntervention ? 'Intervento aggiornato' : 'Intervento creato', type: 'success' });
          }}
          technicians={technicians}
        />
      )}

      {isListModalOpen && (
        <InterventionListModal onClose={() => setIsListModalOpen(false)} getTeamLabel={getTeamLabel} />
      )}

      {selectedIntervention && (
        <InterventionDetailModal
          intervention={selectedIntervention}
          onClose={() => setSelectedIntervention(null)}
          getTeamLabel={getTeamLabel}
          onEdit={() => {
            setEditingIntervention(selectedIntervention);
            setIsModalOpen(true);
            setSelectedIntervention(null);
          }}
          onOpenReport={() => {
            setReportIntervention(selectedIntervention);
            setSelectedIntervention(null);
          }}
          onDuplicateAssign={(anchorRect) => {
            openDuplicateAssignForIntervention(selectedIntervention.id, anchorRect);
            setSelectedIntervention(null);
          }}
          isDuplicating={isDuplicatingIntervention}
          onDelete={async () => {
            const deletedId = selectedIntervention.id;
            try {
              const res = await apiFetch(`/api/interventions/${deletedId}`, { method: 'DELETE' });
              if (!res.ok) throw new Error();
              markDeleted(deletedId);
              removeCalendarEventById(deletedId);
              calendarRef.current?.getApi().refetchEvents();
              setInterventions(prev => prev.filter(i => i.id !== deletedId));
              setBacklog(prev => prev.filter(i => i.id !== deletedId));
              setToast({ msg: 'Intervento eliminato', type: 'success' });
              setSelectedIntervention(null);
              await fetchData(true);
            } catch (e) {
              setToast({ msg: 'Errore eliminazione', type: 'error' });
            }
          }}
        />
      )}

      {reportIntervention && (
        <WorkReportModal
          intervention={reportIntervention}
          onClose={() => setReportIntervention(null)}
          onRefresh={fetchData}
        />
      )}

      {isColorsModalOpen && (
        <TeamColorsModal
          teams={teamMaps.teams}
          onClose={() => setIsColorsModalOpen(false)}
          onRefresh={refreshTeamsData}
        />
      )}
    </AppLayout>
  );
}

function getPriorityBadge(p: string) {
  switch (p) {
    case 'URGENT': return 'bg-red-50 text-red-700 border-red-200';
    case 'HIGH': return 'bg-orange-50 text-orange-700 border-orange-200';
    case 'MEDIUM': return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'LOW': return 'bg-green-50 text-green-700 border-green-200';
    default: return 'bg-slate-50 text-slate-500 border-slate-200';
  }
}

function getPlannerStatusBadge(status?: string) {
  switch (status) {
    case 'COMPLETED':
      return 'bg-green-50 text-green-700 border-green-200';
    case 'SCHEDULED':
      return 'bg-slate-50 text-slate-700 border-slate-200';
    case 'IN_PROGRESS':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'CANCELED':
      return 'bg-red-50 text-red-700 border-red-200';
    default:
      return 'bg-slate-50 text-slate-600 border-slate-200';
  }
}

function getPriorityIcon(p: string) {
  switch (p) {
    case 'URGENT': return <Flame className="w-3 h-3" />;
    case 'HIGH': return <ArrowUpCircle className="w-3 h-3" />;
    case 'MEDIUM': return <ArrowRightCircle className="w-3 h-3" />;
    case 'LOW': return <ArrowDownCircle className="w-3 h-3" />;
    default: return null;
  }
}
