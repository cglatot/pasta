import type { PlexResource, PlexUser } from '../../../src/shared/types/plex.ts';
import { syncAllMonitoredServerListeners } from '../daemon/serverManager.ts';
import { getPlexResources, raceServerConnections } from '../plex/client.ts';
import {
    getServerUsers,
    getUserRoleForServer,
    getUserTokenForServer,
    syncServerUsersFromPlex,
} from '../plex/userManager.ts';
import { decryptToken, encryptToken } from '../storage/crypto.ts';
import { getDatabase } from '../storage/db.ts';
import { requiresAdminPinForSession } from './authRoutes.ts';
import { type ApiRouter, sendError, sendJson } from './httpServer.ts';
import {
    getOrClaimInstanceOwner,
    getPrimaryToken,
    isInstanceOwner,
    setSessionCookie,
    type SessionPayload,
} from './session.ts';

export interface MonitoredServerRow {
    machine_identifier: string;
    server_name: string;
    server_url: string;
    custom_url_override: string | null;
    owner_plex_user_id: number;
    encrypted_owner_token: string;
    auth_status: string;
    last_event_timestamp: number;
    is_monitoring_enabled: number;
    debounce_seconds: number;
    update_level: 'show' | 'season';
    update_strategy: 'next' | 'all';
    auto_forced_subtitles: number;
    trigger_on_play: number;
    trigger_on_scan: number;
    trigger_on_activity: number;
    retention_days: number;
    updated_at: number;
}

export const getMonitoredServer = (machineId: string): MonitoredServerRow | undefined => {
    const db = getDatabase();
    return db
        .prepare('SELECT * FROM monitored_servers WHERE machine_identifier = ?')
        .get(machineId) as MonitoredServerRow | undefined;
};

export const resolveEffectiveServerUrl = (
    machineId: string,
    session?: SessionPayload | null
): string | null => {
    const monitored = getMonitoredServer(machineId);
    if (monitored?.custom_url_override && monitored.custom_url_override.trim() !== '') {
        return monitored.custom_url_override.trim().replace(/\/+$/, '');
    }
    if (session?.activeMachineId === machineId && session.activeServerUrl) {
        return session.activeServerUrl;
    }
    if (monitored?.server_url) {
        return monitored.server_url;
    }
    return null;
};

export const resolveEffectiveUserToken = (
    machineId: string,
    session: SessionPayload
): string => {
    const storedUserToken = getUserTokenForServer(machineId, session.plexUserId);
    if (storedUserToken) {
        return storedUserToken;
    }
    return decryptToken(session.encryptedActiveToken);
};

/**
 * If the logged-in user is the Instance Owner (or claims instance ownership on first login),
 * registers/updates all Plex Media Servers they own into `monitored_servers` and syncs users.
 */
export const syncOwnedServersIfInstanceOwner = async (
    user: PlexUser,
    primaryToken: string,
    clientIdentifier: string,
    resources?: PlexResource[]
): Promise<PlexResource[]> => {
    const allResources =
        resources || (await getPlexResources(clientIdentifier, primaryToken).catch(() => []));
    const pmsResources = allResources.filter(r => r.product === 'Plex Media Server');
    const ownedServers = pmsResources.filter(r => r.owned);

    const instanceOwnerId = getOrClaimInstanceOwner(user.id, ownedServers.length > 0);
    if (instanceOwnerId !== user.id) {
        return pmsResources;
    }

    const db = getDatabase();
    const now = Date.now();
    const upsertServerStmt = db.prepare(`
        INSERT INTO monitored_servers (
            machine_identifier,
            server_name,
            server_url,
            owner_plex_user_id,
            encrypted_owner_token,
            auth_status,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, 'OK', ?)
        ON CONFLICT(machine_identifier) DO UPDATE SET
            server_name = excluded.server_name,
            server_url = CASE
                WHEN monitored_servers.server_url LIKE '%.plex.direct%' THEN excluded.server_url
                ELSE monitored_servers.server_url
            END,
            owner_plex_user_id = excluded.owner_plex_user_id,
            encrypted_owner_token = excluded.encrypted_owner_token,
            auth_status = 'OK',
            updated_at = excluded.updated_at
    `);

    for (const srv of ownedServers) {
        const localConn = srv.connections.find(c => c.local);
        const defaultConn =
            localConn?.address && localConn?.port
                ? `http://${localConn.address}:${localConn.port}`
                : localConn?.uri || srv.connections[0]?.uri || '';
        const serverOwnerToken = srv.accessToken || primaryToken;

        upsertServerStmt.run(
            srv.clientIdentifier,
            srv.name,
            defaultConn,
            user.id,
            encryptToken(serverOwnerToken),
            now
        );

        await syncServerUsersFromPlex(
            srv.clientIdentifier,
            user,
            serverOwnerToken,
            clientIdentifier
        ).catch(err => {
            console.warn(`Failed to sync users for owned server ${srv.name}:`, err);
        });
    }

    return pmsResources;
};

export const registerServerRoutes = (router: ApiRouter): void => {
    /**
     * GET /api/servers
     * Returns all Plex Media Servers accessible to the logged-in user, stripped of raw tokens,
     * and annotated with `isMonitored` and `pastaRole` for THIS PASTA instance.
     */
    router.get('/api/servers', async ({ req, res, query, session }) => {
        if (!session) {
            sendError(res, 401, 'Not authenticated');
            return;
        }

        const clientIdentifier =
            query.clientIdentifier ||
            (req.headers['x-plex-client-identifier'] as string) ||
            'PASTA-Server';
        const primaryToken = getPrimaryToken(session);

        const pmsResources = await syncOwnedServersIfInstanceOwner(
            {
                id: session.primaryPlexUserId,
                uuid: session.primaryUuid || (!session.isManagedUser ? session.uuid : ''),
                username: session.primaryUsername,
                title: session.primaryUsername,
                email: session.email,
                thumb: session.primaryThumb || (!session.isManagedUser ? session.thumb : ''),
            },
            primaryToken,
            clientIdentifier
        );

        const filteredResources = session.isManagedUser
            ? pmsResources.filter(srv => {
                  // Managed users can never access external shared servers owned by other Plex accounts
                  if (!srv.owned) return false;
                  const users = getServerUsers(srv.clientIdentifier);
                  return users.some(u => u.plexUserId === session.plexUserId);
              })
            : requiresAdminPinForSession(session)
              ? pmsResources.filter(srv => srv.owned)
              : pmsResources;

        const sanitized: PlexResource[] = filteredResources.map(srv => {
            const monitored = getMonitoredServer(srv.clientIdentifier);
            const role = monitored
                ? getUserRoleForServer(srv.clientIdentifier, session.plexUserId)
                : null;

            return {
                ...srv,
                // Never expose raw Plex tokens to the thin-client browser
                accessToken: '',
                isMonitored: Boolean(monitored),
                pastaRole: role,
            };
        });

        sendJson(res, 200, sanitized);
    });

    /**
     * POST /api/servers/connect
     * Races server connections on the backend (respecting custom_url_override if set)
     * and persists the active server in the user's session cookie.
     */
    router.post('/api/servers/connect', async ({ res, body, session }) => {
        if (!session) {
            sendError(res, 401, 'Not authenticated');
            return;
        }

        const payload = (body || {}) as {
            machineIdentifier?: string;
            useLocalAddress?: boolean;
            clientIdentifier?: string;
            timeoutMs?: number;
        };

        if (!payload.machineIdentifier) {
            sendError(res, 400, 'machineIdentifier is required');
            return;
        }

        const clientIdentifier = payload.clientIdentifier || 'PASTA-Server';
        const primaryToken = getPrimaryToken(session);
        const resources = await getPlexResources(clientIdentifier, primaryToken);
        const targetServer = resources.find(
            r =>
                r.product === 'Plex Media Server' &&
                r.clientIdentifier === payload.machineIdentifier
        );

        const monitored = getMonitoredServer(payload.machineIdentifier);
        if (!targetServer && !monitored) {
            sendError(res, 404, 'Server not found in your Plex resources');
            return;
        }

        const isShared = targetServer ? !targetServer.owned : false;
        if (session.isManagedUser && isShared) {
            sendError(res, 403, 'Managed users cannot connect to external shared servers');
            return;
        }

        const userSpecificToken = getUserTokenForServer(
            payload.machineIdentifier,
            session.plexUserId
        );
        if (session.isManagedUser && !userSpecificToken) {
            sendError(res, 403, 'This managed user does not have access to this server');
            return;
        }

        const serverToken = session.isManagedUser
            ? userSpecificToken!
            : targetServer?.accessToken || userSpecificToken || primaryToken;

        const syntheticResource: PlexResource = targetServer || {
            name: monitored!.server_name,
            product: 'Plex Media Server',
            productVersion: '',
            platform: '',
            platformVersion: '',
            device: '',
            clientIdentifier: monitored!.machine_identifier,
            createdAt: '',
            lastSeenAt: '',
            provides: 'server',
            ownerId: String(monitored!.owner_plex_user_id),
            sourceTitle: '',
            publicAddress: '',
            accessToken: serverToken,
            owned: monitored!.owner_plex_user_id === session.primaryPlexUserId,
            home: false,
            synced: false,
            relay: false,
            presence: true,
            httpsRequired: false,
            publicAddressMatches: false,
            dnsRebindingProtection: false,
            natLoopbackSupported: false,
            connections: monitored?.server_url
                ? [
                      {
                          protocol: monitored.server_url.startsWith('https') ? 'https' : 'http',
                          address: '',
                          port: 32400,
                          uri: monitored.server_url,
                          local: true,
                          relay: false,
                          IPv6: false,
                      },
                  ]
                : [],
        };

        const raceResult = await raceServerConnections(syntheticResource, {
            preferLocal: payload.useLocalAddress ?? true,
            customUrlOverride: monitored?.custom_url_override,
            clientIdentifier,
            token: serverToken,
            timeoutMs: payload.timeoutMs || 5000,
        });

        if (!raceResult.success || !raceResult.uri) {
            sendJson(res, 200, {
                success: false,
                errorMessage: raceResult.errorMessage || 'Could not connect to Plex server',
            });
            return;
        }

        const resolvedMachineId = raceResult.machineId || payload.machineIdentifier;
        const resolvedName = raceResult.friendlyName || syntheticResource.name;

        // If this is a monitored server on this instance, keep its latest working server_url updated
        if (monitored) {
            const db = getDatabase();
            db.prepare(
                'UPDATE monitored_servers SET server_url = ?, server_name = ?, updated_at = ? WHERE machine_identifier = ?'
            ).run(raceResult.uri, resolvedName, Date.now(), resolvedMachineId);
        } else if (isInstanceOwner(session.primaryPlexUserId) && syntheticResource.owned) {
            const db = getDatabase();
            db.prepare(`
                INSERT INTO monitored_servers (
                    machine_identifier, server_name, server_url, owner_plex_user_id, encrypted_owner_token, auth_status, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'OK', ?)
                ON CONFLICT(machine_identifier) DO UPDATE SET
                    server_url = excluded.server_url,
                    server_name = excluded.server_name,
                    updated_at = excluded.updated_at
            `).run(
                resolvedMachineId,
                resolvedName,
                raceResult.uri,
                session.primaryPlexUserId,
                encryptToken(serverToken),
                Date.now()
            );
        }

        const updatedSession: SessionPayload = {
            ...session,
            activeMachineId: resolvedMachineId,
            activeServerUrl: raceResult.uri,
            activeServerName: resolvedName,
            isSharedServer: !syntheticResource.owned,
            encryptedActiveToken: encryptToken(serverToken),
        };
        setSessionCookie(res, updatedSession);

        const role = getMonitoredServer(resolvedMachineId)
            ? getUserRoleForServer(resolvedMachineId, session.plexUserId)
            : null;

        syncAllMonitoredServerListeners();

        sendJson(res, 200, {
            success: true,
            machineId: resolvedMachineId,
            serverName: resolvedName,
            pastaRole: role,
        });
    });

    /**
     * POST /api/servers/disconnect
     * Clears the active server in the session cookie while preserving the currently selected user profile.
     */
    router.post('/api/servers/disconnect', ({ res, session }) => {
        if (!session) {
            sendError(res, 401, 'Not authenticated');
            return;
        }

        const updatedSession: SessionPayload = {
            ...session,
            activeMachineId: null,
            activeServerUrl: null,
            activeServerName: null,
            isSharedServer: false,
        };
        setSessionCookie(res, updatedSession);
        sendJson(res, 200, { ok: true });
    });
};
