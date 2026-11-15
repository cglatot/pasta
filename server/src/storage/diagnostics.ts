import { getDatabase } from './db.ts';

export type DiagnosticCategory = 'SYSTEM' | 'DAEMON' | 'SCANNER' | 'RULE' | 'AUTH' | 'API';

export interface DiagnosticEvent {
    id: number;
    timestamp: string;
    category: DiagnosticCategory;
    machineIdentifier?: string;
    message: string;
    details?: Record<string, unknown>;
    repeatCount?: number;
}

const MAX_NORMAL_EVENTS = 400;
const MAX_DEBUG_EVENTS = 2500;
const MAX_EVENT_MESSAGE_CHARS = 2000;
const MAX_EVENT_DETAILS_BYTES = 32 * 1024; // 32 KB per-event details cap
const MAX_BUFFER_BYTES = 4 * 1024 * 1024; // 4 MB hard RAM ceiling

interface StoredDiagnosticEntry {
    event: DiagnosticEvent;
    byteSize: number;
}

const ringBuffer: StoredDiagnosticEntry[] = [];
let currentBufferBytes = 0;
let nextEventId = 1;
let uiDebugEnabled = false;

const getActiveMaxEvents = (): number => {
    return isDebugLoggingEnabled() ? MAX_DEBUG_EVENTS : MAX_NORMAL_EVENTS;
};

const enforceBufferCaps = (maxEvents: number = getActiveMaxEvents()): void => {
    while (
        ringBuffer.length > maxEvents ||
        (ringBuffer.length > 1 && currentBufferBytes > MAX_BUFFER_BYTES)
    ) {
        const removed = ringBuffer.shift();
        if (removed) {
            currentBufferBytes = Math.max(0, currentBufferBytes - removed.byteSize);
        }
    }
};

/**
 * Returns true ONLY if the PASTA_DEBUG environment variable is explicitly set to a truthy string
 * ('true', '1', 'yes'). Explicitly setting PASTA_DEBUG=false (or leaving it unset) returns false
 * so the in-UI toggle remains unlocked and user-controllable.
 */
export const isDebugForcedByEnv = (): boolean => {
    const val = (process.env.PASTA_DEBUG || '').trim().toLowerCase();
    return val === 'true' || val === '1' || val === 'yes';
};

export const isUiDebugLoggingEnabled = (): boolean => {
    return uiDebugEnabled;
};

export const isDebugLoggingEnabled = (): boolean => {
    return isDebugForcedByEnv() || uiDebugEnabled;
};

/**
 * Loads the persisted UI debug logging toggle from the SQLite instance_settings table.
 */
export const initDebugLoggingFromDb = (): void => {
    try {
        const db = getDatabase();
        const row = db
            .prepare("SELECT value FROM instance_settings WHERE key = 'debug_logging'")
            .get() as { value: string } | undefined;
        uiDebugEnabled = row?.value === 'true';
    } catch {
        uiDebugEnabled = false;
    }
};

/**
 * Updates the UI debug logging toggle in memory and persists it to SQLite instance_settings.
 */
export const setUiDebugLoggingEnabled = (enabled: boolean): void => {
    uiDebugEnabled = enabled;
    enforceBufferCaps();
    try {
        const db = getDatabase();
        db.prepare(
            `INSERT INTO instance_settings (key, value, updated_at)
             VALUES ('debug_logging', ?, ?)
             ON CONFLICT(key) DO UPDATE SET
                 value = excluded.value,
                 updated_at = excluded.updated_at`
        ).run(enabled ? 'true' : 'false', Date.now());
    } catch {
        // Ignore DB persistence errors if called in a test without initialized schema
    }
};

/**
 * Redacts any URLs, IP addresses, or token-like strings from diagnostic details before storing.
 */
const sanitizeValue = (key: string, val: unknown): unknown => {
    const lowerKey = key.toLowerCase();
    if (
        lowerKey.includes('token') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('password') ||
        lowerKey.includes('pin') ||
        lowerKey.includes('email')
    ) {
        return '[REDACTED]';
    }
    if (lowerKey.includes('url') && typeof val === 'string' && val.trim().length > 0) {
        try {
            const parsed = new URL(val);
            return `${parsed.protocol}//[REDACTED_HOST]:${parsed.port || (parsed.protocol === 'https:' ? '443' : '80')}`;
        } catch {
            return '[REDACTED_URL]';
        }
    }
    return val;
};

const sanitizeDetails = (
    details?: Record<string, unknown>
): Record<string, unknown> | undefined => {
    if (!details) return undefined;
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(details)) {
        clean[k] = sanitizeValue(k, v);
    }
    try {
        const serialized = JSON.stringify(clean);
        if (Buffer.byteLength(serialized, 'utf8') > MAX_EVENT_DETAILS_BYTES) {
            return {
                _truncated: true,
                preview: `${serialized.slice(0, MAX_EVENT_DETAILS_BYTES)}...`,
            };
        }
    } catch {
        return { _truncated: true };
    }
    return clean;
};

export const recordDiagnosticEvent = (
    category: DiagnosticCategory,
    message: string,
    details?: Record<string, unknown>,
    machineIdentifier?: string
): void => {
    const safeMessage =
        message.length > MAX_EVENT_MESSAGE_CHARS
            ? `${message.slice(0, MAX_EVENT_MESSAGE_CHARS)}...`
            : message;
    const sanitized = sanitizeDetails(details);
    const shortMachineId = machineIdentifier ? `${machineIdentifier.slice(0, 8)}...` : undefined;
    const nowIso = new Date().toISOString();

    const prevWrapper = ringBuffer[ringBuffer.length - 1];
    const prev = prevWrapper?.event;
    if (
        prev &&
        prev.category === category &&
        prev.machineIdentifier === shortMachineId &&
        prev.message === safeMessage &&
        JSON.stringify(prev.details) === JSON.stringify(sanitized)
    ) {
        prev.timestamp = nowIso;
        prev.repeatCount = (prev.repeatCount || 1) + 1;
    } else {
        const entry: DiagnosticEvent = {
            id: nextEventId++,
            timestamp: nowIso,
            category,
            ...(shortMachineId ? { machineIdentifier: shortMachineId } : {}),
            message: safeMessage,
            ...(sanitized ? { details: sanitized } : {}),
        };

        const byteSize = Buffer.byteLength(JSON.stringify(entry), 'utf8');
        ringBuffer.push({ event: entry, byteSize });
        currentBufferBytes += byteSize;
        enforceBufferCaps();
    }

    if (isDebugLoggingEnabled()) {
        const prefix = `[PASTA Debug][${category}]${
            shortMachineId ? `[${shortMachineId}]` : ''
        }`;
        if (sanitized) {
            console.log(prefix, safeMessage, JSON.stringify(sanitized));
        } else {
            console.log(prefix, safeMessage);
        }
    }
};

export const getDiagnosticEvents = (
    limit: number = getActiveMaxEvents(),
    sinceMs?: number
): DiagnosticEvent[] => {
    let entries = ringBuffer.map(item => item.event);
    if (typeof sinceMs === 'number' && sinceMs > 0) {
        entries = entries.filter(ev => {
            const ts = Date.parse(ev.timestamp);
            return !Number.isNaN(ts) && ts >= sinceMs;
        });
    }
    return entries.slice(-limit).reverse();
};

export const getDiagnosticBufferStats = (): {
    bufferedEvents: number;
    maxEvents: number;
    bufferBytes: number;
    maxBufferBytes: number;
} => ({
    bufferedEvents: ringBuffer.length,
    maxEvents: getActiveMaxEvents(),
    bufferBytes: currentBufferBytes,
    maxBufferBytes: MAX_BUFFER_BYTES,
});
