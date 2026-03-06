export type WorkReportDraftValues = {
  workPerformed: string;
  extraWork: string;
  materials: string;
  customerName: string;
  customerEmail: string;
};

export type WorkReportDraftPayload = {
  updatedAt: number;
  values: WorkReportDraftValues;
  reportUpdatedAt?: number | null;
  reportVersion?: number | null;
  snapshotHash?: string;
};

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const EMPTY_WORK_REPORT_DRAFT_VALUES: WorkReportDraftValues = {
  workPerformed: '',
  extraWork: '',
  materials: '',
  customerName: '',
  customerEmail: ''
};

function getStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function buildWorkReportDraftKey(interventionId: number, userId?: number | null) {
  return `workReportDraft:${userId ?? 'anon'}:${interventionId}`;
}

export function serializeWorkReportDraftValues(values: WorkReportDraftValues) {
  return JSON.stringify({
    workPerformed: values.workPerformed,
    extraWork: values.extraWork,
    materials: values.materials,
    customerName: values.customerName,
    customerEmail: values.customerEmail
  });
}

function toSafeString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function toSafeDraftValues(input: unknown): WorkReportDraftValues {
  if (!input || typeof input !== 'object') {
    return { ...EMPTY_WORK_REPORT_DRAFT_VALUES };
  }
  const values = input as Partial<WorkReportDraftValues>;
  return {
    workPerformed: toSafeString(values.workPerformed),
    extraWork: toSafeString(values.extraWork),
    materials: toSafeString(values.materials),
    customerName: toSafeString(values.customerName),
    customerEmail: toSafeString(values.customerEmail)
  };
}

export function createWorkReportDraftPayload(
  values: WorkReportDraftValues,
  options?: {
    updatedAt?: number;
    reportUpdatedAt?: number | null;
    reportVersion?: number | null;
    snapshotHash?: string;
  }
): WorkReportDraftPayload {
  return {
    updatedAt: options?.updatedAt ?? Date.now(),
    values: toSafeDraftValues(values),
    reportUpdatedAt: typeof options?.reportUpdatedAt === 'number' ? options.reportUpdatedAt : null,
    reportVersion: typeof options?.reportVersion === 'number' && Number.isInteger(options.reportVersion)
      ? options.reportVersion
      : null,
    snapshotHash: options?.snapshotHash
  };
}

export function readWorkReportDraft(
  key: string,
  storage?: StorageLike | null
): WorkReportDraftPayload | null {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return null;
  try {
    const raw = resolvedStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WorkReportDraftPayload>;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
      values: toSafeDraftValues(parsed.values),
      reportUpdatedAt: typeof parsed.reportUpdatedAt === 'number' ? parsed.reportUpdatedAt : null,
      reportVersion: typeof parsed.reportVersion === 'number' && Number.isInteger(parsed.reportVersion)
        ? parsed.reportVersion
        : null,
      snapshotHash: typeof parsed.snapshotHash === 'string' ? parsed.snapshotHash : undefined
    };
  } catch {
    return null;
  }
}

export function writeWorkReportDraft(
  key: string,
  payload: WorkReportDraftPayload,
  storage?: StorageLike | null
) {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return false;
  try {
    resolvedStorage.setItem(key, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function clearWorkReportDraft(key: string, storage?: StorageLike | null) {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return false;
  try {
    resolvedStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
