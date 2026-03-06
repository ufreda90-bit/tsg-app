import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkReport } from '../../types';
import {
  buildWorkReportDraftKey,
  clearWorkReportDraft,
  createWorkReportDraftPayload,
  readWorkReportDraft,
  serializeWorkReportDraftValues,
  writeWorkReportDraft
} from './draftStorage';
import type { WorkReportDraftPayload, WorkReportDraftValues } from './draftStorage';
import { enqueueWorkReportSubmission, subscribeWorkReportOutboxUpdates } from './outboxBridge';
import {
  fetchWorkReport,
  getWorkReportUpdatedAt,
  getWorkReportVersion,
  patchWorkReport,
  resolveWorkReportVersion,
  toLifecycleError
} from './workReportApi';
import { createInitialSaveLifecycleState, saveStateLabelIt, transition } from './saveLifecycle';
import type { SaveErrorKind, SaveLifecycleState } from './saveLifecycle';

type PendingDraftOffer = {
  exists: boolean;
  draftUpdatedAt?: number;
};

type UseWorkReportSaveArgs = {
  interventionId: number;
  userId?: number | null;
  draftDebounceMs?: number;
};

type SaveActionResult = {
  outcome: 'SYNCED' | 'QUEUED' | 'FAILED' | 'CONFLICT';
  message?: string;
  kind?: SaveErrorKind;
};

type RefreshOptions = {
  syncValues?: boolean;
};

type BeforeCloseResult = {
  canClose: boolean;
  reason?: string;
};

const DEFAULT_DRAFT_DEBOUNCE_MS = 650;
export const LOCAL_DRAFT_PERSIST_FAILURE_MESSAGE =
  'Bozza non salvata sul dispositivo. Non chiudere questa schermata finché non completi il salvataggio.';

const EMPTY_VALUES: WorkReportDraftValues = {
  workPerformed: '',
  extraWork: '',
  materials: '',
  customerName: '',
  customerEmail: ''
};

function toDraftValuesFromReport(report: WorkReport | null): WorkReportDraftValues {
  return {
    workPerformed: report?.workPerformed || '',
    extraWork: report?.extraWork || '',
    materials: report?.materials || '',
    customerName: report?.customerName || '',
    customerEmail: report?.customerEmail || ''
  };
}

function shouldOfferDraftRestore(draft: WorkReportDraftPayload, report: WorkReport | null) {
  if (!report) return true;
  const serverValues = toDraftValuesFromReport(report);
  const serverSnapshot = serializeWorkReportDraftValues(serverValues);
  const draftSnapshot = serializeWorkReportDraftValues(draft.values);
  if (serverSnapshot === draftSnapshot) return false;

  const serverUpdatedAt = getWorkReportUpdatedAt(report) ?? 0;
  const serverVersion = getWorkReportVersion(report);
  const draftBaseUpdatedAt = typeof draft.reportUpdatedAt === 'number' ? draft.reportUpdatedAt : null;
  const draftBaseVersion = typeof draft.reportVersion === 'number' ? draft.reportVersion : null;

  const serverMovedAhead =
    (draftBaseUpdatedAt !== null && serverUpdatedAt > draftBaseUpdatedAt) ||
    (draftBaseVersion !== null && serverVersion !== null && serverVersion > draftBaseVersion);

  if (serverMovedAhead && draft.updatedAt <= serverUpdatedAt) return false;
  if (serverUpdatedAt > 0 && draft.updatedAt <= serverUpdatedAt) return false;
  return true;
}

function toDirtyDelta(prev: WorkReportDraftValues, patch: Partial<WorkReportDraftValues>) {
  let changed = 0;
  for (const key of Object.keys(patch) as Array<keyof WorkReportDraftValues>) {
    if (patch[key] !== undefined && patch[key] !== prev[key]) {
      changed += 1;
    }
  }
  return changed;
}

export function applyLocalDraftPersistResult(
  prev: SaveLifecycleState,
  payloadUpdatedAt: number,
  persisted: boolean
) {
  if (persisted) {
    return transition(prev, { type: 'LOCAL_PERSIST_OK', at: payloadUpdatedAt });
  }
  return transition(prev, {
    type: 'LOCAL_PERSIST_FAIL',
    at: payloadUpdatedAt,
    message: LOCAL_DRAFT_PERSIST_FAILURE_MESSAGE
  });
}

export function useWorkReportSave({
  interventionId,
  userId,
  draftDebounceMs = DEFAULT_DRAFT_DEBOUNCE_MS
}: UseWorkReportSaveArgs) {
  const [report, setReport] = useState<WorkReport | null>(null);
  const [values, setValues] = useState<WorkReportDraftValues>(EMPTY_VALUES);
  const [isLoadingReport, setIsLoadingReport] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [lastActionMessage, setLastActionMessage] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<WorkReportDraftPayload | null>(null);
  const [saveLifecycle, setSaveLifecycle] = useState<SaveLifecycleState>(() =>
    createInitialSaveLifecycleState(String(interventionId))
  );

  const draftKey = useMemo(
    () => buildWorkReportDraftKey(interventionId, userId),
    [interventionId, userId]
  );

  const reportRef = useRef<WorkReport | null>(null);
  const valuesRef = useRef<WorkReportDraftValues>(EMPTY_VALUES);
  const lifecycleRef = useRef<SaveLifecycleState>(saveLifecycle);
  const timerRef = useRef<number | null>(null);
  const lastSyncedSnapshotRef = useRef<string>(serializeWorkReportDraftValues(EMPTY_VALUES));
  const inFlightSaveRef = useRef(false);

  useEffect(() => {
    reportRef.current = report;
  }, [report]);

  useEffect(() => {
    valuesRef.current = values;
  }, [values]);

  useEffect(() => {
    lifecycleRef.current = saveLifecycle;
  }, [saveLifecycle]);

  const dispatchTransition = useCallback((event: Parameters<typeof transition>[1]) => {
    setSaveLifecycle((prev) => transition(prev, event));
  }, []);

  const clearPersistTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const updateReportMetadata = useCallback((nextReport: WorkReport | null) => {
    setReport(nextReport);
    reportRef.current = nextReport;
    setSaveLifecycle((prev) => ({
      ...prev,
      reportId: nextReport?.id ?? prev.reportId,
      version: getWorkReportVersion(nextReport) ?? prev.version
    }));
  }, []);

  const persistDraft = useCallback(() => {
    const currentValues = valuesRef.current;
    const currentSnapshot = serializeWorkReportDraftValues(currentValues);
    const reportUpdatedAt = getWorkReportUpdatedAt(reportRef.current);
    const reportVersion = getWorkReportVersion(reportRef.current);

    const payload = createWorkReportDraftPayload(currentValues, {
      reportUpdatedAt,
      reportVersion,
      snapshotHash: currentSnapshot
    });

    const ok = writeWorkReportDraft(draftKey, payload);
    setSaveLifecycle((prev) => applyLocalDraftPersistResult(prev, payload.updatedAt, ok));
    return ok;
  }, [draftKey]);

  const maybeClearDraftAfterSync = useCallback((snapshotAtSave: string) => {
    const latestSnapshot = serializeWorkReportDraftValues(valuesRef.current);
    if (latestSnapshot !== snapshotAtSave) return false;
    const cleared = clearWorkReportDraft(draftKey);
    if (cleared) {
      setPendingDraft(null);
    }
    return cleared;
  }, [draftKey]);

  const flushDraft = useCallback(() => {
    clearPersistTimer();

    const currentSnapshot = serializeWorkReportDraftValues(valuesRef.current);
    if (
      lifecycleRef.current.state === 'SYNCED' &&
      currentSnapshot === lastSyncedSnapshotRef.current
    ) {
      clearWorkReportDraft(draftKey);
      return true;
    }

    return persistDraft();
  }, [clearPersistTimer, draftKey, persistDraft]);
  const flushDraftRef = useRef<() => boolean>(flushDraft);

  useEffect(() => {
    flushDraftRef.current = flushDraft;
  }, [flushDraft]);

  const schedulePersist = useCallback(() => {
    clearPersistTimer();
    timerRef.current = window.setTimeout(() => {
      persistDraft();
    }, draftDebounceMs);
  }, [clearPersistTimer, draftDebounceMs, persistDraft]);

  const applyServerReport = useCallback((nextReport: WorkReport, options?: RefreshOptions) => {
    updateReportMetadata(nextReport);

    if (!options?.syncValues) return;

    const serverValues = toDraftValuesFromReport(nextReport);
    setValues(serverValues);
    valuesRef.current = serverValues;
    const serverSnapshot = serializeWorkReportDraftValues(serverValues);
    lastSyncedSnapshotRef.current = serverSnapshot;

    dispatchTransition({
      type: 'INIT_FROM_SERVER',
      reportId: nextReport.id,
      interventionId: String(interventionId),
      version: getWorkReportVersion(nextReport),
      serverUpdatedAt: getWorkReportUpdatedAt(nextReport)
    });
  }, [dispatchTransition, interventionId, updateReportMetadata]);

  const refreshFromServer = useCallback(async (options?: RefreshOptions) => {
    const syncValues = options?.syncValues ?? false;
    try {
      const latest = await fetchWorkReport(interventionId);
      applyServerReport(latest, { syncValues });
      return latest;
    } catch (error) {
      const lifecycleError = toLifecycleError(error);
      setLastActionMessage(lifecycleError.message);
      return null;
    }
  }, [applyServerReport, interventionId]);

  const loadInitialReport = useCallback(async () => {
    setIsLoadingReport(true);
    try {
      const latest = await fetchWorkReport(interventionId);
      applyServerReport(latest, { syncValues: true });

      const draft = readWorkReportDraft(draftKey);
      if (draft && shouldOfferDraftRestore(draft, latest)) {
        setPendingDraft(draft);
        dispatchTransition({
          type: 'LOAD_DRAFT',
          hasDraft: true,
          draftUpdatedAt: draft.updatedAt
        });
      } else {
        clearWorkReportDraft(draftKey);
        setPendingDraft(null);
      }
    } catch (error) {
      const lifecycleError = toLifecycleError(error);
      dispatchTransition({
        type: 'SYNC_FAIL',
        at: Date.now(),
        kind: lifecycleError.kind === 'CONFLICT' ? 'SERVER' : lifecycleError.kind,
        message: lifecycleError.message
      });
      setLastActionMessage(lifecycleError.message);
    } finally {
      setIsLoadingReport(false);
    }
  }, [applyServerReport, dispatchTransition, draftKey, interventionId]);

  useEffect(() => {
    void loadInitialReport();
  }, [loadInitialReport]);

  useEffect(() => {
    const unsubscribe = subscribeWorkReportOutboxUpdates((detail) => {
      if (detail.interventionId !== interventionId) return;
      setSaveLifecycle((prev) => {
        if (prev.state !== 'QUEUED' && prev.state !== 'SYNCING') return prev;
        if (detail.outcome === 'SYNC_OK') {
          return transition(prev, {
            type: 'SYNC_OK',
            at: detail.at,
            version: detail.version
          });
        }
        if (detail.outcome === 'CONFLICT') {
          return transition(prev, {
            type: 'CONFLICT_DETECTED',
            at: detail.at,
            message: detail.message || 'Conflitto versione durante sincronizzazione'
          });
        }
        return transition(prev, {
          type: 'SYNC_FAIL',
          at: detail.at,
          kind: detail.kind === 'CONFLICT' ? 'UNKNOWN' : (detail.kind ?? 'UNKNOWN'),
          message: detail.message || 'Sincronizzazione outbox non riuscita'
        });
      });
      if (detail.outcome === 'SYNC_OK') {
        setLastActionMessage('Sincronizzazione completata');
      }
    });
    return unsubscribe;
  }, [interventionId]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return () => undefined;
    }

    const handleBeforeUnload = () => {
      flushDraftRef.current();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushDraftRef.current();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    return () => {
      clearPersistTimer();
      flushDraft();
    };
  }, [clearPersistTimer, flushDraft]);

  const setField = useCallback(<K extends keyof WorkReportDraftValues>(field: K, value: WorkReportDraftValues[K]) => {
    setValues((prev) => {
      if (prev[field] === value) return prev;
      const next = { ...prev, [field]: value };
      valuesRef.current = next;
      dispatchTransition({
        type: 'EDIT',
        fieldsChangedCountDelta: 1,
        at: Date.now()
      });
      schedulePersist();
      return next;
    });
  }, [dispatchTransition, schedulePersist]);

  const patchFields = useCallback((patch: Partial<WorkReportDraftValues>) => {
    setValues((prev) => {
      const changed = toDirtyDelta(prev, patch);
      if (changed === 0) return prev;
      const next = { ...prev, ...patch };
      valuesRef.current = next;
      dispatchTransition({
        type: 'EDIT',
        fieldsChangedCountDelta: changed,
        at: Date.now()
      });
      schedulePersist();
      return next;
    });
  }, [dispatchTransition, schedulePersist]);

  const acceptDraft = useCallback(() => {
    if (!pendingDraft) return;
    setValues(pendingDraft.values);
    valuesRef.current = pendingDraft.values;
    setPendingDraft(null);
    dispatchTransition({
      type: 'EDIT',
      fieldsChangedCountDelta: 1,
      at: Date.now()
    });
    schedulePersist();
  }, [dispatchTransition, pendingDraft, schedulePersist]);

  const discardDraft = useCallback(() => {
    clearWorkReportDraft(draftKey);
    setPendingDraft(null);
  }, [draftKey]);

  const queueNow = useCallback(async (): Promise<SaveActionResult> => {
    const persisted = flushDraft();
    if (!persisted) {
      return {
        outcome: 'FAILED',
        kind: 'UNKNOWN',
        message: LOCAL_DRAFT_PERSIST_FAILURE_MESSAGE
      };
    }

    const currentValues = valuesRef.current;
    const currentVersion = getWorkReportVersion(reportRef.current);
    try {
      const { dedupKey } = await enqueueWorkReportSubmission({
        interventionId,
        ...currentValues,
        version: currentVersion
      });
      dispatchTransition({
        type: 'QUEUE_OK',
        dedupKey,
        at: Date.now()
      });
      setLastActionMessage('Salvataggio messo in coda');
      return { outcome: 'QUEUED', message: 'Salvataggio messo in coda' };
    } catch (error) {
      const lifecycleError = toLifecycleError(error);
      dispatchTransition({
        type: 'SYNC_FAIL',
        at: Date.now(),
        kind: lifecycleError.kind === 'CONFLICT' ? 'SERVER' : lifecycleError.kind,
        message: lifecycleError.message
      });
      return {
        outcome: 'FAILED',
        kind: lifecycleError.kind,
        message: lifecycleError.message
      };
    }
  }, [dispatchTransition, flushDraft, interventionId]);

  const saveNow = useCallback(async (): Promise<SaveActionResult> => {
    if (inFlightSaveRef.current) {
      return { outcome: 'FAILED', kind: 'UNKNOWN', message: 'Salvataggio già in corso' };
    }
    inFlightSaveRef.current = true;
    setIsSaving(true);
    setLastActionMessage(null);

    try {
      const persisted = flushDraft();
      if (!persisted) {
        return {
          outcome: 'FAILED',
          kind: 'UNKNOWN',
          message: LOCAL_DRAFT_PERSIST_FAILURE_MESSAGE
        };
      }

      const valuesToSave = valuesRef.current;
      const snapshotAtSave = serializeWorkReportDraftValues(valuesToSave);

      let version = getWorkReportVersion(reportRef.current);
      if (!(typeof version === 'number' && Number.isInteger(version))) {
        version = await resolveWorkReportVersion(interventionId);
      }
      if (!(typeof version === 'number' && Number.isInteger(version))) {
        const message = 'Impossibile recuperare la versione della bolla';
        dispatchTransition({
          type: 'SYNC_FAIL',
          at: Date.now(),
          kind: 'VALIDATION',
          message
        });
        return { outcome: 'FAILED', kind: 'VALIDATION', message };
      }

      dispatchTransition({ type: 'SYNC_START', at: Date.now() });

      try {
        const saved = await patchWorkReport(interventionId, {
          version,
          ...valuesToSave
        });

        applyServerReport(saved, { syncValues: false });
        dispatchTransition({
          type: 'SYNC_OK',
          at: Date.now(),
          version: getWorkReportVersion(saved)
        });
        lastSyncedSnapshotRef.current = serializeWorkReportDraftValues(toDraftValuesFromReport(saved));
        maybeClearDraftAfterSync(snapshotAtSave);
        setPendingDraft(null);
        setLastActionMessage('Salvataggio completato');
        return { outcome: 'SYNCED', message: 'Salvataggio completato' };
      } catch (error) {
        const lifecycleError = toLifecycleError(error);
        if (lifecycleError.kind === 'CONFLICT') {
          dispatchTransition({
            type: 'CONFLICT_DETECTED',
            at: Date.now(),
            message: lifecycleError.message
          });
          return { outcome: 'CONFLICT', kind: 'CONFLICT', message: lifecycleError.message };
        }

        if (lifecycleError.kind === 'NETWORK') {
          try {
            const { dedupKey } = await enqueueWorkReportSubmission({
              interventionId,
              ...valuesToSave,
              version
            });
            dispatchTransition({
              type: 'QUEUE_OK',
              dedupKey,
              at: Date.now()
            });
            setLastActionMessage('Rete non disponibile: salvataggio messo in coda');
            return {
              outcome: 'QUEUED',
              kind: 'NETWORK',
              message: 'Rete non disponibile: salvataggio messo in coda'
            };
          } catch (queueError) {
            const queueLifecycleError = toLifecycleError(queueError);
            dispatchTransition({
              type: 'SYNC_FAIL',
              at: Date.now(),
              kind: queueLifecycleError.kind === 'CONFLICT' ? 'UNKNOWN' : queueLifecycleError.kind,
              message: queueLifecycleError.message
            });
            return {
              outcome: 'FAILED',
              kind: queueLifecycleError.kind,
              message: queueLifecycleError.message
            };
          }
        }

        dispatchTransition({
          type: 'SYNC_FAIL',
          at: Date.now(),
          kind: lifecycleError.kind,
          message: lifecycleError.message
        });
        return {
          outcome: 'FAILED',
          kind: lifecycleError.kind,
          message: lifecycleError.message
        };
      }
    } finally {
      inFlightSaveRef.current = false;
      setIsSaving(false);
    }
  }, [applyServerReport, dispatchTransition, flushDraft, interventionId, maybeClearDraftAfterSync]);

  const retry = useCallback(async (): Promise<SaveActionResult> => {
    if (lifecycleRef.current.state === 'CONFLICT') {
      const latest = await refreshFromServer({ syncValues: false });
      dispatchTransition({
        type: 'CONFLICT_RESOLVED',
        at: Date.now(),
        version: getWorkReportVersion(latest)
      });
    }
    return saveNow();
  }, [dispatchTransition, refreshFromServer, saveNow]);

  const beforeClose = useCallback((): BeforeCloseResult => {
    const ok = flushDraft();
    if (!ok) {
      return {
        canClose: false,
        reason: 'DRAFT_PERSIST_FAILED'
      };
    }
    return { canClose: true };
  }, [flushDraft]);

  const pendingDraftOffer: PendingDraftOffer = useMemo(() => (
    pendingDraft
      ? { exists: true, draftUpdatedAt: pendingDraft.updatedAt }
      : { exists: false }
  ), [pendingDraft]);

  return {
    values,
    setField,
    patchFields,
    isLoadingReport,
    isSaving,
    report,
    pendingDraftOffer,
    acceptDraft,
    discardDraft,
    saveLifecycle,
    statusLabel: saveStateLabelIt[saveLifecycle.state],
    lastActionMessage,
    saveNow,
    queueNow,
    retry,
    refreshFromServer,
    beforeClose
  };
}
