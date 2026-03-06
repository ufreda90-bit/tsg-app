import { openDB, DBSchema, IDBPDatabase } from 'idb';

export type OutboxAction =
    | 'START_SESSION'
    | 'STOP_SESSION'
    | 'PAUSE_START'
    | 'PAUSE_STOP'
    | 'CREATE_INTERVENTION'
    | 'UPDATE_INTERVENTION'
    | 'SUBMIT_REPORT'
    | 'SUBMIT_SIGNATURE';

export interface OutboxItem {
    id?: number; // Auto-incremented
    action: OutboxAction;
    payload: any;
    createdAt: number;
    updatedAt?: number;
    dedupKey?: string;
    retryCount: number;
    status: 'pending' | 'sent' | 'failed' | 'conflict';
}

interface AppDB extends DBSchema {
    outbox: {
        key: number;
        value: OutboxItem;
        indexes: { 'by-date': number };
    };
    interventions: {
        key: number;
        value: any; // Cache complete dell'intervento
    };
    customers: {
        key: string;
        value: any; // Cache per i clienti
    };
}

let dbPromise: Promise<IDBPDatabase<AppDB>> | null = null;

export async function initDB() {
    if (typeof window === 'undefined') return null; // SSR safety

    if (!dbPromise) {
        dbPromise = openDB<AppDB>('pwa-app-db', 1, {
            upgrade(db) {
                if (!db.objectStoreNames.contains('outbox')) {
                    const outboxStore = db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
                    outboxStore.createIndex('by-date', 'createdAt');
                }
                if (!db.objectStoreNames.contains('interventions')) {
                    db.createObjectStore('interventions', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('customers')) {
                    db.createObjectStore('customers', { keyPath: 'id' });
                }
            },
        });
    }
    return dbPromise;
}

// ------ OUTBOX HELPERS ------

type AddToOutboxOptions = {
    dedupKey?: string;
};

function getDefaultOutboxDedupKey(action: OutboxAction, payload: any) {
    if (action !== 'SUBMIT_REPORT') return undefined;
    const interventionId = payload?.interventionId;
    if (interventionId === undefined || interventionId === null) return undefined;
    return `SUBMIT_REPORT:${String(interventionId)}`;
}

export async function addToOutbox(action: OutboxAction, payload: any, options?: AddToOutboxOptions) {
    const db = await initDB();
    if (!db) return;
    const now = Date.now();
    const dedupKey = options?.dedupKey ?? getDefaultOutboxDedupKey(action, payload);

    if (!dedupKey) {
        await db.add('outbox', {
            action,
            payload,
            createdAt: now,
            updatedAt: now,
            retryCount: 0,
            status: 'pending'
        });
        return;
    }

    const tx = db.transaction('outbox', 'readwrite');
    let existingPending: OutboxItem | undefined;
    let cursor = await tx.store.index('by-date').openCursor(null, 'prev');
    while (cursor) {
        const item = cursor.value;
        if (item.status === 'pending' && item.dedupKey === dedupKey) {
            existingPending = item;
            break; // bounded scan: stop at first match
        }
        cursor = await cursor.continue();
    }

    if (existingPending) {
        await tx.store.put({
            ...existingPending,
            action,
            payload,
            dedupKey,
            updatedAt: now,
            retryCount: 0,
            status: 'pending'
        });
    } else {
        await tx.store.add({
            action,
            payload,
            dedupKey,
            createdAt: now,
            updatedAt: now,
            retryCount: 0,
            status: 'pending'
        });
    }

    await tx.done;
}

export async function updateOutboxItem(item: OutboxItem) {
    const db = await initDB();
    if (!db) return;
    await db.put('outbox', item);
}

export async function getOutboxItems() {
    const db = await initDB();
    if (!db) return [];
    return db.getAllFromIndex('outbox', 'by-date');
}

export async function removeOutboxItem(id: number) {
    const db = await initDB();
    if (!db) return;
    await db.delete('outbox', id);
}

export async function clearOutbox() {
    const db = await initDB();
    if (!db) return;
    await db.clear('outbox');
}

// ------ CACHE HELPERS ------

export async function cacheInterventions(items: any[]) {
    const db = await initDB();
    if (!db) return;
    const tx = db.transaction('interventions', 'readwrite');
    await tx.store.clear();
    for (const item of items) {
        await tx.store.put(item);
    }
    await tx.done;
}

export async function getCachedInterventions() {
    const db = await initDB();
    if (!db) return [];
    return db.getAll('interventions');
}

export async function cacheCustomers(items: any[]) {
    const db = await initDB();
    if (!db) return;
    const tx = db.transaction('customers', 'readwrite');
    await tx.store.clear();
    for (const item of items) {
        await tx.store.put(item);
    }
    await tx.done;
}

export async function getCachedCustomers() {
    const db = await initDB();
    if (!db) return [];
    return db.getAll('customers');
}
