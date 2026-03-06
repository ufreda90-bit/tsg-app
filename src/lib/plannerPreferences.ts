export type PlannerDefaultView = 'day' | 'week';
export type PlannerSlotMinutes = 15 | 30 | 60;
export type PlannerAutoRefreshSeconds = 0 | 30 | 60 | 120;
export type PlannerUiDensity = 'comfortable' | 'compact';

export type PlannerPreferences = {
  defaultView: PlannerDefaultView;
  dayStartHour: number;
  dayEndHour: number;
  slotMinutes: PlannerSlotMinutes;
  autoRefreshSeconds: PlannerAutoRefreshSeconds;
  showConflictToasts: boolean;
  showUrgentToasts: boolean;
  uiDensity: PlannerUiDensity;
};

export const PLANNER_PREFERENCES_STORAGE_KEY = 'planner.preferences.v1';

export const DEFAULT_PLANNER_PREFERENCES: PlannerPreferences = {
  defaultView: 'day',
  dayStartHour: 8,
  dayEndHour: 20,
  slotMinutes: 30,
  autoRefreshSeconds: 60,
  showConflictToasts: true,
  showUrgentToasts: true,
  uiDensity: 'comfortable'
};

function parseNumber(value: unknown, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return value;
}

export function sanitizePlannerPreferences(input: Partial<PlannerPreferences> | null | undefined): PlannerPreferences {
  const source = input || {};
  const rawStart = parseNumber(source.dayStartHour, DEFAULT_PLANNER_PREFERENCES.dayStartHour);
  const rawEnd = parseNumber(source.dayEndHour, DEFAULT_PLANNER_PREFERENCES.dayEndHour);
  const dayStartHour = Math.min(12, Math.max(0, Math.floor(rawStart)));
  const dayEndHour = Math.min(23, Math.max(dayStartHour + 1, Math.floor(rawEnd)));

  const slotMinutes: PlannerSlotMinutes =
    source.slotMinutes === 15 || source.slotMinutes === 30 || source.slotMinutes === 60
      ? source.slotMinutes
      : DEFAULT_PLANNER_PREFERENCES.slotMinutes;

  const autoRefreshSeconds: PlannerAutoRefreshSeconds =
    source.autoRefreshSeconds === 0 ||
    source.autoRefreshSeconds === 30 ||
    source.autoRefreshSeconds === 60 ||
    source.autoRefreshSeconds === 120
      ? source.autoRefreshSeconds
      : DEFAULT_PLANNER_PREFERENCES.autoRefreshSeconds;

  return {
    defaultView: source.defaultView === 'week' ? 'week' : 'day',
    dayStartHour,
    dayEndHour,
    slotMinutes,
    autoRefreshSeconds,
    showConflictToasts:
      typeof source.showConflictToasts === 'boolean'
        ? source.showConflictToasts
        : DEFAULT_PLANNER_PREFERENCES.showConflictToasts,
    showUrgentToasts:
      typeof source.showUrgentToasts === 'boolean'
        ? source.showUrgentToasts
        : DEFAULT_PLANNER_PREFERENCES.showUrgentToasts,
    uiDensity: source.uiDensity === 'compact' ? 'compact' : 'comfortable'
  };
}

export function loadPlannerPreferences(): PlannerPreferences {
  if (typeof window === 'undefined') return DEFAULT_PLANNER_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(PLANNER_PREFERENCES_STORAGE_KEY);
    if (!raw) return DEFAULT_PLANNER_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<PlannerPreferences>;
    return sanitizePlannerPreferences(parsed);
  } catch {
    return DEFAULT_PLANNER_PREFERENCES;
  }
}

export function savePlannerPreferences(next: PlannerPreferences) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    PLANNER_PREFERENCES_STORAGE_KEY,
    JSON.stringify(sanitizePlannerPreferences(next))
  );
}

export function formatHourToSlot(value: number) {
  const safe = Math.max(0, Math.min(23, Math.floor(value)));
  return `${String(safe).padStart(2, '0')}:00:00`;
}

export function formatMinutesToSlotDuration(value: PlannerSlotMinutes) {
  return `00:${String(value).padStart(2, '0')}:00`;
}
