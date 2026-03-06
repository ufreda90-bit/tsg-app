import type { SaveErrorKind } from '../features/workreport/saveLifecycle';

const WORK_REPORT_OUTBOX_EVENT_NAME = 'outbox:workreport';

export type WorkReportOutboxEventDetail = {
  interventionId: number;
  outcome: 'SYNC_OK' | 'SYNC_FAIL' | 'CONFLICT';
  at: number;
  version?: number | null;
  kind?: SaveErrorKind;
  message?: string;
};

export function emitWorkReportOutboxEvent(detail: WorkReportOutboxEventDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<WorkReportOutboxEventDetail>(WORK_REPORT_OUTBOX_EVENT_NAME, {
      detail
    })
  );
}

export function subscribeWorkReportOutboxEvent(
  handler: (detail: WorkReportOutboxEventDetail) => void
) {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const listener = (event: Event) => {
    const detail = (event as CustomEvent<WorkReportOutboxEventDetail>).detail;
    if (!detail || typeof detail !== 'object') return;
    handler(detail);
  };

  window.addEventListener(WORK_REPORT_OUTBOX_EVENT_NAME, listener as EventListener);
  return () => {
    window.removeEventListener(WORK_REPORT_OUTBOX_EVENT_NAME, listener as EventListener);
  };
}
