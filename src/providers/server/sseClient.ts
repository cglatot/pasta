import type { DetailedProgressState } from '../../shared/types/batchTypes';
import { apiFetch } from './ServerProvider';

export interface ServerBatchProgressEvent {
    jobId: string;
    machineIdentifier: string;
    initiatedByUserId: number;
    initiatedByUsername: string;
    scope: 'season' | 'show' | 'collection' | 'library';
    targetTitle: string;
    progress: DetailedProgressState;
    dismissed: boolean;
}

type ProgressListener = (event: ServerBatchProgressEvent | null) => void;

const listeners = new Set<ProgressListener>();
let eventSource: EventSource | null = null;
let latestEvent: ServerBatchProgressEvent | null = null;

const notifyListeners = (evt: ServerBatchProgressEvent | null) => {
    latestEvent = evt;
    for (const listener of listeners) {
        listener(evt);
    }
};

export const fetchActiveServerBatch = async (
    machineIdentifier?: string | null
): Promise<ServerBatchProgressEvent | null> => {
    try {
        const res = await apiFetch<{ activeJob: ServerBatchProgressEvent | null }>(
            '/api/batch/active',
            {
                params: {
                    machineIdentifier: machineIdentifier || undefined,
                },
            }
        );
        notifyListeners(res.activeJob || null);
        return res.activeJob || null;
    } catch {
        return null;
    }
};

export const cancelServerBatchJob = async (jobId: string): Promise<void> => {
    await apiFetch(`/api/batch/${encodeURIComponent(jobId)}/cancel`, {
        method: 'POST',
    });
};

export const dismissServerBatchJob = async (jobId: string): Promise<void> => {
    notifyListeners(null);
    await apiFetch(`/api/batch/${encodeURIComponent(jobId)}/dismiss`, {
        method: 'POST',
    });
};

export const resetServerBatchEventStream = (): void => {
    notifyListeners(null);
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }
    if (listeners.size > 0 && typeof window !== 'undefined' && typeof EventSource !== 'undefined') {
        openEventSource();
    }
};

const openEventSource = (): void => {
    if (eventSource || typeof window === 'undefined' || typeof EventSource === 'undefined') {
        return;
    }
    eventSource = new EventSource('/api/events', { withCredentials: true });
    eventSource.addEventListener('batch_progress', (msg: MessageEvent) => {
        try {
            const parsed = JSON.parse(msg.data) as ServerBatchProgressEvent;
            if (parsed.dismissed) {
                notifyListeners(null);
            } else {
                notifyListeners(parsed);
            }
        } catch {
            // Ignore malformed SSE payload
        }
    });
    eventSource.onerror = () => {
        // EventSource reconnects automatically in the browser
    };
};

export const subscribeToServerBatchEvents = (
    listener: ProgressListener
): (() => void) => {
    listeners.add(listener);
    if (latestEvent) {
        listener(latestEvent);
    }

    openEventSource();

    return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && eventSource) {
            eventSource.close();
            eventSource = null;
        }
    };
};
