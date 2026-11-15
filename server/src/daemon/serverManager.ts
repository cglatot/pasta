import { syncServerUsersFromPlex } from '../plex/userManager.ts';
import { decryptToken } from '../storage/crypto.ts';
import { getDatabase } from '../storage/db.ts';
import { PlexAlertListener } from './alertListener.ts';
import { cancelPendingDebounceForShow, flushAllPendingEvents } from './eventBuffer.ts';

const activeListeners = new Map<string, PlexAlertListener>();

/**
 * Starts, updates, or stops per-PMS WebSocket listeners according to `monitored_servers`.
 */
export const syncAllMonitoredServerListeners = (): void => {
    const db = getDatabase();
    const rows = db
        .prepare(
            'SELECT machine_identifier, is_monitoring_enabled, server_url, custom_url_override, owner_plex_user_id, encrypted_owner_token FROM monitored_servers'
        )
        .all() as Array<{
        machine_identifier: string;
        is_monitoring_enabled: number;
        server_url: string;
        custom_url_override: string | null;
        owner_plex_user_id: number;
        encrypted_owner_token: string;
    }>;

    const enabledIds = new Set<string>();

    for (const row of rows) {
        if (row.owner_plex_user_id && row.encrypted_owner_token) {
            const ownerToken = decryptToken(row.encrypted_owner_token);
            if (ownerToken) {
                const ownerRow = db
                    .prepare(
                        'SELECT username, email FROM server_users WHERE machine_identifier = ? AND plex_user_id = ? LIMIT 1'
                    )
                    .get(row.machine_identifier, row.owner_plex_user_id) as
                    | { username: string; email: string }
                    | undefined;
                void syncServerUsersFromPlex(
                    row.machine_identifier,
                    {
                        id: row.owner_plex_user_id,
                        uuid: '',
                        username: ownerRow?.username || 'Owner',
                        title: ownerRow?.username || 'Owner',
                        email: ownerRow?.email || '',
                        thumb: '',
                    },
                    ownerToken,
                    'PASTA-Server'
                ).catch(() => {
                    // Ignore transient network errors on startup user sync
                });
            }
        }

        const hasUrl = Boolean(
            (row.custom_url_override && row.custom_url_override.trim()) ||
                (row.server_url && row.server_url.trim())
        );

        if (row.is_monitoring_enabled && hasUrl) {
            enabledIds.add(row.machine_identifier);
            if (!activeListeners.has(row.machine_identifier)) {
                const listener = new PlexAlertListener(row.machine_identifier);
                activeListeners.set(row.machine_identifier, listener);
                listener.start();
            }
        }
    }

    for (const [machineId, listener] of activeListeners.entries()) {
        if (!enabledIds.has(machineId)) {
            cancelPendingDebounceForShow(machineId);
            listener.stop();
            activeListeners.delete(machineId);
        }
    }
};

export const restartServerListener = (machineIdentifier: string): void => {
    const existing = activeListeners.get(machineIdentifier);
    if (existing) {
        existing.stop();
        activeListeners.delete(machineIdentifier);
    }
    syncAllMonitoredServerListeners();
};

export const stopAllMonitoredServerListeners = async (): Promise<void> => {
    await flushAllPendingEvents();
    for (const [, listener] of activeListeners.entries()) {
        listener.stop();
    }
    activeListeners.clear();
};
