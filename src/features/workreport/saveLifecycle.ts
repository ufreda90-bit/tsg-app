export type SaveState =
  | 'DIRTY'
  | 'LOCAL_SAVED'
  | 'QUEUED'
  | 'SYNCING'
  | 'SYNCED'
  | 'FAILED'
  | 'CONFLICT';

export type SaveErrorKind = 'NETWORK' | 'SERVER' | 'VALIDATION' | 'UNKNOWN' | 'CONFLICT';
type SaveFailureKind = Exclude<SaveErrorKind, 'CONFLICT'>;

export type SaveErrorInfo = {
  kind: SaveErrorKind;
  message: string;
};

export type SaveLifecycleState = {
  state: SaveState;
  reportId: string | null;
  interventionId: string;
  version: number | null;
  lastLocalSavedAt: number | null;
  lastServerSavedAt: number | null;
  lastError: SaveErrorInfo | null;
  draftPersistFailed: boolean;
  draftPersistErrorMessage: string | null;
  pendingOutboxDedupKey: string | null;
  dirtyFieldsCount: number;
  dirtySince: number | null;
};

export type SaveEvent =
  | {
      type: 'INIT_FROM_SERVER';
      reportId: string | null;
      interventionId: string;
      version: number | null;
      serverUpdatedAt?: number | null;
    }
  | {
      type: 'LOAD_DRAFT';
      hasDraft: boolean;
      draftUpdatedAt?: number;
    }
  | {
      type: 'EDIT';
      fieldsChangedCountDelta?: number;
      at?: number;
    }
  | {
      type: 'LOCAL_PERSIST_OK';
      at: number;
    }
  | {
      type: 'LOCAL_PERSIST_FAIL';
      at: number;
      message: string;
    }
  | {
      type: 'QUEUE_OK';
      dedupKey: string;
      at: number;
    }
  | {
      type: 'SYNC_START';
      at: number;
    }
  | {
      type: 'SYNC_OK';
      at: number;
      version?: number | null;
    }
  | {
      type: 'SYNC_FAIL';
      at: number;
      kind: SaveFailureKind;
      message: string;
    }
  | {
      type: 'CONFLICT_DETECTED';
      at: number;
      message: string;
    }
  | {
      type: 'CONFLICT_RESOLVED';
      at: number;
      version?: number | null;
    }
  | {
      type: 'RESET_ERROR';
    };

export const saveStateLabelIt: Record<SaveState, string> = {
  DIRTY: 'Modifiche non salvate',
  LOCAL_SAVED: 'Salvato in locale',
  QUEUED: 'In coda sincronizzazione',
  SYNCING: 'Sincronizzazione in corso',
  SYNCED: 'Sincronizzato',
  FAILED: 'Errore di sincronizzazione',
  CONFLICT: 'Conflitto dati'
};

function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${String(x)}`);
}

function normalizeDelta(delta?: number) {
  if (typeof delta !== 'number' || !Number.isFinite(delta)) return 1;
  return Math.max(0, Math.floor(delta));
}

function bumpDirtyMetadata(prev: SaveLifecycleState, delta?: number, at?: number) {
  const increment = normalizeDelta(delta);
  return {
    dirtyFieldsCount: prev.dirtyFieldsCount + increment,
    dirtySince: prev.dirtySince ?? at ?? null
  } as const;
}

export function createInitialSaveLifecycleState(interventionId: string): SaveLifecycleState {
  return {
    state: 'DIRTY',
    reportId: null,
    interventionId,
    version: null,
    lastLocalSavedAt: null,
    lastServerSavedAt: null,
    lastError: null,
    draftPersistFailed: false,
    draftPersistErrorMessage: null,
    pendingOutboxDedupKey: null,
    dirtyFieldsCount: 0,
    dirtySince: null
  };
}

export function transition(prev: SaveLifecycleState, event: SaveEvent): SaveLifecycleState {
  switch (event.type) {
    case 'INIT_FROM_SERVER':
      return {
        ...prev,
        state: 'SYNCED',
        reportId: event.reportId,
        interventionId: event.interventionId,
        version: event.version,
        lastServerSavedAt: event.serverUpdatedAt ?? prev.lastServerSavedAt,
        lastError: null,
        draftPersistFailed: false,
        draftPersistErrorMessage: null,
        pendingOutboxDedupKey: null,
        dirtyFieldsCount: 0,
        dirtySince: null
      };

    case 'LOAD_DRAFT': {
      if (!event.hasDraft) return prev;

      const dirtyMeta = bumpDirtyMetadata(prev, 1, event.draftUpdatedAt);
      switch (prev.state) {
        case 'SYNCING':
          return {
            ...prev,
            ...dirtyMeta
          };
        case 'DIRTY':
        case 'LOCAL_SAVED':
        case 'QUEUED':
        case 'SYNCED':
        case 'FAILED':
        case 'CONFLICT':
          return {
            ...prev,
            state: 'DIRTY',
            ...dirtyMeta
          };
        default:
          return assertNever(prev.state);
      }
    }

    case 'EDIT': {
      const dirtyMeta = bumpDirtyMetadata(prev, event.fieldsChangedCountDelta, event.at);
      switch (prev.state) {
        case 'SYNCING':
          return {
            ...prev,
            ...dirtyMeta
          };
        case 'QUEUED':
          return {
            ...prev,
            ...dirtyMeta
          };
        case 'CONFLICT':
          return {
            ...prev,
            ...dirtyMeta
          };
        case 'DIRTY':
        case 'LOCAL_SAVED':
        case 'SYNCED':
        case 'FAILED':
          return {
            ...prev,
            state: 'DIRTY',
            lastError: null,
            ...dirtyMeta
          };
        default:
          return assertNever(prev.state);
      }
    }

    case 'LOCAL_PERSIST_OK':
      switch (prev.state) {
        case 'DIRTY':
          return {
            ...prev,
            state: 'LOCAL_SAVED',
            lastLocalSavedAt: event.at,
            lastError: null,
            draftPersistFailed: false,
            draftPersistErrorMessage: null
          };
        case 'LOCAL_SAVED':
        case 'QUEUED':
        case 'SYNCING':
        case 'SYNCED':
        case 'FAILED':
        case 'CONFLICT':
          return {
            ...prev,
            lastLocalSavedAt: event.at,
            draftPersistFailed: false,
            draftPersistErrorMessage: null
          };
        default:
          return assertNever(prev.state);
      }

    case 'LOCAL_PERSIST_FAIL':
      switch (prev.state) {
        case 'LOCAL_SAVED':
          return {
            ...prev,
            state: 'DIRTY',
            draftPersistFailed: true,
            draftPersistErrorMessage: event.message
          };
        case 'DIRTY':
        case 'QUEUED':
        case 'SYNCING':
        case 'SYNCED':
        case 'FAILED':
        case 'CONFLICT':
          return {
            ...prev,
            draftPersistFailed: true,
            draftPersistErrorMessage: event.message
          };
        default:
          return assertNever(prev.state);
      }

    case 'QUEUE_OK':
      switch (prev.state) {
        case 'DIRTY':
        case 'LOCAL_SAVED':
          return {
            ...prev,
            state: 'QUEUED',
            pendingOutboxDedupKey: event.dedupKey,
            lastLocalSavedAt: prev.lastLocalSavedAt ?? event.at,
            lastError: null
          };
        case 'QUEUED':
        case 'SYNCING':
        case 'SYNCED':
        case 'FAILED':
        case 'CONFLICT':
          return {
            ...prev,
            pendingOutboxDedupKey: prev.pendingOutboxDedupKey ?? event.dedupKey
          };
        default:
          return assertNever(prev.state);
      }

    case 'SYNC_START':
      switch (prev.state) {
        case 'QUEUED':
        case 'LOCAL_SAVED':
          return {
            ...prev,
            state: 'SYNCING',
            lastError: null
          };
        case 'DIRTY':
        case 'SYNCING':
        case 'SYNCED':
        case 'FAILED':
        case 'CONFLICT':
          return prev;
        default:
          return assertNever(prev.state);
      }

    case 'SYNC_OK':
      return {
        ...prev,
        state: 'SYNCED',
        version: event.version ?? prev.version,
        lastServerSavedAt: event.at,
        lastError: null,
        draftPersistFailed: false,
        draftPersistErrorMessage: null,
        pendingOutboxDedupKey: null,
        dirtyFieldsCount: 0,
        dirtySince: null
      };

    case 'SYNC_FAIL': {
      const error: SaveErrorInfo = {
        kind: event.kind,
        message: event.message
      };

      switch (prev.state) {
        case 'CONFLICT':
          return prev;
        case 'DIRTY':
        case 'LOCAL_SAVED':
        case 'QUEUED':
        case 'SYNCING':
        case 'SYNCED':
        case 'FAILED':
          return {
            ...prev,
            state: 'FAILED',
            lastError: error
          };
        default:
          return assertNever(prev.state);
      }
    }

    case 'CONFLICT_DETECTED':
      return {
        ...prev,
        state: 'CONFLICT',
        lastError: {
          kind: 'CONFLICT',
          message: event.message
        }
      };

    case 'CONFLICT_RESOLVED':
      switch (prev.state) {
        case 'CONFLICT':
          return {
            ...prev,
            state: 'LOCAL_SAVED',
            version: event.version ?? prev.version,
            lastLocalSavedAt: event.at,
            lastError: null,
            draftPersistFailed: false,
            draftPersistErrorMessage: null
          };
        case 'DIRTY':
        case 'LOCAL_SAVED':
        case 'QUEUED':
        case 'SYNCING':
        case 'SYNCED':
        case 'FAILED':
          return {
            ...prev,
            version: event.version ?? prev.version,
            lastError: null,
            draftPersistFailed: false,
            draftPersistErrorMessage: null
          };
        default:
          return assertNever(prev.state);
      }

    case 'RESET_ERROR':
      switch (prev.state) {
        case 'FAILED':
          return {
            ...prev,
            state: prev.lastLocalSavedAt ? 'LOCAL_SAVED' : 'DIRTY',
            lastError: null
          };
        case 'DIRTY':
        case 'LOCAL_SAVED':
        case 'QUEUED':
        case 'SYNCING':
        case 'SYNCED':
        case 'CONFLICT':
          return {
            ...prev,
            lastError: null
          };
        default:
          return assertNever(prev.state);
      }

    default:
      return assertNever(event);
  }
}
