export const STATUS_LABELS = {
  SCHEDULED: 'Pianificato',
  IN_PROGRESS: 'In lavorazione',
  COMPLETED: 'Completato',
  FAILED: 'Non riuscito',
  CANCELLED: 'Annullato',
  NO_SHOW: 'Cliente assente'
} as const;

export type StatusKey = keyof typeof STATUS_LABELS;

export const STATUS_BADGE_CLASSES: Record<StatusKey, string> = {
  SCHEDULED: 'bg-sky-50 text-sky-600 border-sky-100',
  IN_PROGRESS: 'bg-amber-50 text-amber-600 border-amber-100',
  COMPLETED: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  FAILED: 'bg-rose-50 text-rose-600 border-rose-100',
  CANCELLED: 'bg-slate-100 text-slate-600 border-slate-200',
  NO_SHOW: 'bg-purple-50 text-purple-600 border-purple-100'
};

export function getStatusLabel(status?: string) {
  if (!status) return '';
  return STATUS_LABELS[status as StatusKey] || status;
}

export function getStatusBadgeClasses(status?: string) {
  if (!status) return 'bg-slate-50 text-slate-500 border-slate-200';
  return STATUS_BADGE_CLASSES[status as StatusKey] || 'bg-slate-50 text-slate-500 border-slate-200';
}
