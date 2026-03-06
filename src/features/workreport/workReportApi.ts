import { apiFetch } from '../../lib/apiFetch';
import type { WorkReport } from '../../types';
import type { SaveErrorKind } from './saveLifecycle';
import type { WorkReportDraftValues } from './draftStorage';

export type PatchWorkReportInput = WorkReportDraftValues & {
  version: number;
};

export class WorkReportApiError extends Error {
  status: number | null;
  kind: SaveErrorKind;

  constructor(message: string, options?: { status?: number | null; kind?: SaveErrorKind }) {
    super(message);
    this.name = 'WorkReportApiError';
    this.status = typeof options?.status === 'number' ? options.status : null;
    this.kind = options?.kind ?? 'UNKNOWN';
  }
}

function toErrorKindFromStatus(status: number): SaveErrorKind {
  if (status === 409) return 'CONFLICT';
  if (status === 400 || status === 422) return 'VALIDATION';
  if (status >= 500) return 'SERVER';
  return 'UNKNOWN';
}

async function parseJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function getResponseErrorMessage(
  res: Response,
  payload: unknown,
  fallback = 'Unexpected server error'
) {
  if ((res as Response & { apiErrorMessage?: string }).apiErrorMessage) {
    return (res as Response & { apiErrorMessage: string }).apiErrorMessage;
  }
  if (payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string') {
    const value = (payload as { error: string }).error.trim();
    if (value) return value;
  }
  return fallback;
}

function toWorkReportApiError(error: unknown): WorkReportApiError {
  if (error instanceof WorkReportApiError) return error;
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new WorkReportApiError('Request aborted', { kind: 'NETWORK' });
  }
  if (error instanceof TypeError) {
    return new WorkReportApiError(error.message || 'Network error', { kind: 'NETWORK' });
  }
  if (error instanceof Error) {
    return new WorkReportApiError(error.message || 'Unexpected error', { kind: 'UNKNOWN' });
  }
  return new WorkReportApiError('Unexpected error', { kind: 'UNKNOWN' });
}

function getServerUpdatedAt(report: WorkReport | null) {
  if (!report?.updatedAt) return null;
  const ts = new Date(report.updatedAt).getTime();
  return Number.isFinite(ts) ? ts : null;
}

export async function fetchWorkReport(interventionId: number): Promise<WorkReport> {
  try {
    const res = await apiFetch(`/api/interventions/${interventionId}/work-report`);
    const payload = await parseJson<WorkReport & { error?: string }>(res);
    if (!res.ok) {
      throw new WorkReportApiError(
        getResponseErrorMessage(res, payload, `Failed to load work report (${res.status})`),
        { status: res.status, kind: toErrorKindFromStatus(res.status) }
      );
    }
    if (!payload || typeof payload !== 'object') {
      throw new WorkReportApiError('Work report payload missing', { kind: 'UNKNOWN' });
    }
    return payload as WorkReport;
  } catch (error) {
    throw toWorkReportApiError(error);
  }
}

export async function fetchIntervention(interventionId: number): Promise<any | null> {
  try {
    const res = await apiFetch(`/api/interventions/${interventionId}`);
    if (!res.ok) return null;
    return await parseJson<any>(res);
  } catch {
    return null;
  }
}

export async function resolveWorkReportVersion(interventionId: number): Promise<number | null> {
  const interventionData = await fetchIntervention(interventionId);
  const interventionVersion = interventionData?.workReport?.version;
  if (typeof interventionVersion === 'number' && Number.isInteger(interventionVersion)) {
    return interventionVersion;
  }

  try {
    const report = await fetchWorkReport(interventionId);
    if (typeof report?.version === 'number' && Number.isInteger(report.version)) {
      return report.version;
    }
  } catch {
    return null;
  }
  return null;
}

export async function patchWorkReport(
  interventionId: number,
  payload: PatchWorkReportInput
): Promise<WorkReport> {
  try {
    const res = await apiFetch(`/api/interventions/${interventionId}/work-report`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const responsePayload = await parseJson<WorkReport & { error?: string }>(res);
    if (!res.ok) {
      throw new WorkReportApiError(
        getResponseErrorMessage(res, responsePayload, `Failed to save work report (${res.status})`),
        { status: res.status, kind: toErrorKindFromStatus(res.status) }
      );
    }
    if (!responsePayload || typeof responsePayload !== 'object') {
      throw new WorkReportApiError('Invalid work report response payload', { kind: 'UNKNOWN' });
    }
    return responsePayload as WorkReport;
  } catch (error) {
    throw toWorkReportApiError(error);
  }
}

export function isWorkReportConflictError(error: unknown) {
  const normalized = toWorkReportApiError(error);
  return normalized.kind === 'CONFLICT' || normalized.status === 409;
}

export function toLifecycleError(error: unknown): { kind: SaveErrorKind; message: string; status: number | null } {
  const normalized = toWorkReportApiError(error);
  return {
    kind: normalized.kind,
    message: normalized.message || 'Unexpected error',
    status: normalized.status
  };
}

export function getWorkReportVersion(report: WorkReport | null) {
  if (!report) return null;
  return typeof report.version === 'number' && Number.isInteger(report.version) ? report.version : null;
}

export function getWorkReportUpdatedAt(report: WorkReport | null) {
  return getServerUpdatedAt(report);
}
