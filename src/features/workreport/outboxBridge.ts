import { addToOutbox } from '../../lib/db';
import { subscribeWorkReportOutboxEvent } from '../../lib/events';
import type { WorkReportOutboxEventDetail } from '../../lib/events';
import type { WorkReportDraftValues } from './draftStorage';

export type WorkReportOutboxPayload = WorkReportDraftValues & {
  interventionId: number;
  version?: number | null;
};

type AddToOutboxFn = (
  action: 'SUBMIT_REPORT',
  payload: WorkReportOutboxPayload,
  options?: { dedupKey?: string }
) => Promise<void>;

export type WorkReportOutboxBridgeDeps = {
  addToOutbox: AddToOutboxFn;
};

const defaultDeps: WorkReportOutboxBridgeDeps = {
  addToOutbox: (action, payload, options) =>
    addToOutbox(action, payload, options)
};

export function buildWorkReportOutboxDedupKey(interventionId: number) {
  return `SUBMIT_REPORT:${interventionId}`;
}

export async function enqueueWorkReportSubmission(
  payload: WorkReportOutboxPayload,
  deps: WorkReportOutboxBridgeDeps = defaultDeps
) {
  const dedupKey = buildWorkReportOutboxDedupKey(payload.interventionId);
  await deps.addToOutbox('SUBMIT_REPORT', payload, { dedupKey });
  return { dedupKey };
}

export function subscribeWorkReportOutboxUpdates(
  handler: (detail: WorkReportOutboxEventDetail) => void
) {
  return subscribeWorkReportOutboxEvent(handler);
}
