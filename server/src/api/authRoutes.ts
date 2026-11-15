import type { PlexHomeUser, PlexUser } from '../../../src/shared/types/plex.ts';
import {
    checkPlexPin,
    createPlexPin,
    getPlexAccountUser,
    getPlexHomeUsers,
    probeServerIdentity,
    switchPlexHomeUser,
} from '../plex/client.ts';
import {
    getServerUsers,
    getUserRoleForServer,
    getUserTokenForServer,
    syncServerUsersFromPlex,
} from '../plex/userManager.ts';
import { decryptToken, encryptToken } from '../storage/crypto.ts';
import { getDatabase } from '../storage/db.ts';
import { type ApiRouter, sendError, sendJson } from './httpServer.ts';
import {
    getMonitoredServer,
    syncOwnedServersIfInstanceOwner,
} from './serverRoutes.ts';
import {
    clearSessionCookie,
    createSessionPayload,
    getPrimaryToken,
    isInstanceOwner,
    setSessionCookie,
    type SessionPayload,
} from './session.ts';

export interface ManagedServerSummary {
    machineIdentifier: string;
    serverName: string;
    role: 'owner' | 'admin';
    authStatus: string;
}

export const getManagedServersForUser = (plexUserId: number): ManagedServerSummary[] => {
    const db = getDatabase();
    const allMonitored = db
        .prepare(
            'SELECT machine_identifier, server_name, owner_plex_user_id, auth_status FROM monitored_servers ORDER BY server_name COLLATE NOCASE ASC'
        )
        .all() as Array<{
        machine_identifier: string;
        server_name: string;
        owner_plex_user_id: number;
        auth_status: string;
    }>;

    const result: ManagedServerSummary[] = [];
    for (const srv of allMonitored) {
        const role = getUserRoleForServer(srv.machine_identifier, plexUserId);
        if (role === 'owner' || role === 'admin') {
            result.push({
                machineIdentifier: srv.machine_identifier,
                serverName: srv.server_name,
                role,
                authStatus: srv.auth_status,
            });
        }
    }
    return result;
};

export const isPrimaryUserPinProtected = (session: SessionPayload): boolean => {
    if (session.isAdminPinProtected === true) {
        return true;
    }
    const db = getDatabase();
    const row = db
        .prepare(
            'SELECT is_protected FROM server_users WHERE plex_user_id = ? AND is_protected = 1 LIMIT 1'
        )
        .get(session.primaryPlexUserId) as { is_protected: number } | undefined;
    if (row?.is_protected) {
        return true;
    }
    return Boolean(session.isAdminPinProtected);
};

export const requiresAdminPinForSession = (session: SessionPayload | null): boolean => {
    if (!session || session.isManagedUser) {
        return false;
    }
    if (!isPrimaryUserPinProtected(session)) {
        return false;
    }
    return !session.adminPinVerified;
};

export const buildSessionResponse = (session: SessionPayload | null) => {
    if (!session) {
        return {
            authenticated: false,
            user: null,
            machineIdentifier: null,
            serverName: null,
            isSharedServer: false,
            isManagedUser: false,
            requiresAdminPin: false,
            pastaRole: null,
            isInstanceOwner: false,
            managedServers: [] as ManagedServerSummary[],
        };
    }

    let resolvedUsername = session.username;
    let resolvedTitle = session.title;
    let resolvedEmail = session.email;
    let resolvedThumb = session.thumb;

    if (!session.isManagedUser && session.plexUserId === session.primaryPlexUserId) {
        const db = getDatabase();
        const ownerRow = db
            .prepare(
                'SELECT username, title, email, thumb FROM server_users WHERE plex_user_id = ? AND is_server_owner = 1 LIMIT 1'
            )
            .get(session.primaryPlexUserId) as
            | { username: string; title: string; email: string; thumb: string }
            | undefined;
        resolvedUsername = ownerRow?.username || session.primaryUsername || session.username;
        resolvedTitle =
            ownerRow?.username || ownerRow?.title || session.primaryUsername || session.title;
        resolvedEmail = ownerRow?.email || session.email;
        resolvedThumb = ownerRow?.thumb || session.primaryThumb || session.thumb;
    }

    const userObj: PlexUser = {
        id: session.plexUserId,
        uuid: session.uuid,
        username: resolvedUsername,
        title: resolvedTitle,
        email: resolvedEmail,
        thumb: resolvedThumb,
    };

    const managedServers = getManagedServersForUser(session.plexUserId);
    let activeRole: 'owner' | 'admin' | 'user' | null = null;
    if (session.activeMachineId) {
        const monitored = getMonitoredServer(session.activeMachineId);
        if (monitored) {
            activeRole =
                getUserRoleForServer(session.activeMachineId, session.plexUserId) || 'user';
        }
    } else if (managedServers.length > 0) {
        activeRole = managedServers[0].role;
    }

    return {
        authenticated: true,
        user: userObj,
        machineIdentifier: session.activeMachineId,
        serverName: session.activeServerName,
        isSharedServer: session.isSharedServer,
        isManagedUser: session.isManagedUser,
        requiresAdminPin: requiresAdminPinForSession(session),
        pastaRole: activeRole,
        isInstanceOwner: isInstanceOwner(session.plexUserId),
        managedServers,
    };
};

export const registerAuthRoutes = (router: ApiRouter): void => {
    router.get('/api/auth/session', ({ res, session }) => {
        if (session && session.isManagedUser) {
            const db = getDatabase();
            const exists = db
                .prepare('SELECT 1 FROM server_users WHERE plex_user_id = ? LIMIT 1')
                .get(session.plexUserId);
            if (!exists) {
                // The managed user no longer exists on any server - auto-revert to primary owner account!
                session.plexUserId = session.primaryPlexUserId;
                session.isManagedUser = false;
                session.username = session.primaryUsername;
                session.title = session.primaryUsername;
                session.thumb = session.primaryThumb || '';
                session.encryptedActiveToken = session.encryptedPrimaryToken;
                setSessionCookie(res, session);
            }
        }
        sendJson(res, 200, buildSessionResponse(session));
    });

    router.post('/api/auth/pin', async ({ res, body }) => {
        const payload = (body || {}) as { clientIdentifier?: string };
        const clientIdentifier = payload.clientIdentifier || 'PASTA-Server';
        const pin = await createPlexPin(clientIdentifier);
        sendJson(res, 200, pin);
    });

    router.get('/api/auth/pin/:id', async ({ res, params, query }) => {
        const pinId = Number.parseInt(params.id, 10);
        const code = query.code || '';
        const clientIdentifier = query.clientIdentifier || 'PASTA-Server';

        if (Number.isNaN(pinId) || !code) {
            sendError(res, 400, 'Valid pinId and code are required');
            return;
        }

        const pinStatus = await checkPlexPin(pinId, clientIdentifier, code);
        if (!pinStatus.authToken) {
            sendJson(res, 200, { authToken: null, loggedIn: false });
            return;
        }

        const plexUser = await getPlexAccountUser(clientIdentifier, pinStatus.authToken);
        await syncOwnedServersIfInstanceOwner(plexUser, pinStatus.authToken, clientIdentifier);

        const db = getDatabase();
        const protectedRow = db
            .prepare(
                'SELECT is_protected FROM server_users WHERE plex_user_id = ? AND is_protected = 1 LIMIT 1'
            )
            .get(plexUser.id) as { is_protected: number } | undefined;
        const isProtected = Boolean(plexUser.protected || protectedRow?.is_protected);

        const session = createSessionPayload({
            primaryUser: plexUser,
            primaryToken: pinStatus.authToken,
            isAdminPinProtected: isProtected,
            adminPinVerified: !isProtected,
        });
        setSessionCookie(res, session);

        sendJson(res, 200, {
            authToken: 'SERVER_MANAGED_SESSION',
            loggedIn: true,
            session: buildSessionResponse(session),
        });
    });

    router.post('/api/auth/manual', async ({ res, body }) => {
        const payload = (body || {}) as {
            url?: string;
            token?: string;
            clientIdentifier?: string;
        };

        const cleanToken = payload.token?.trim() || '';
        const cleanUrl = payload.url?.trim().replace(/\/+$/, '') || '';
        const clientIdentifier = payload.clientIdentifier || 'PASTA-Server';

        if (!cleanToken) {
            sendError(res, 400, 'Plex token is required');
            return;
        }

        const plexUser = await getPlexAccountUser(clientIdentifier, cleanToken);
        await syncOwnedServersIfInstanceOwner(plexUser, cleanToken, clientIdentifier);

        const db = getDatabase();
        const protectedRow = db
            .prepare(
                'SELECT is_protected FROM server_users WHERE plex_user_id = ? AND is_protected = 1 LIMIT 1'
            )
            .get(plexUser.id) as { is_protected: number } | undefined;
        const isProtected = Boolean(plexUser.protected || protectedRow?.is_protected);

        let activeMachineId: string | null = null;
        let activeServerUrl: string | null = null;
        let activeServerName: string | null = null;

        if (cleanUrl) {
            try {
                const identity = await probeServerIdentity(cleanUrl, clientIdentifier, cleanToken);
                activeMachineId = identity.machineIdentifier || null;
                activeServerUrl = cleanUrl;
                activeServerName = identity.friendlyName || 'Plex Server';
            } catch {
                activeServerUrl = cleanUrl;
                activeServerName = 'Plex Server';
            }
        }

        const session = createSessionPayload({
            primaryUser: plexUser,
            primaryToken: cleanToken,
            activeMachineId,
            activeServerUrl,
            activeServerName,
            isAdminPinProtected: isProtected,
            adminPinVerified: !isProtected,
        });
        setSessionCookie(res, session);

        sendJson(res, 200, {
            loggedIn: true,
            session: buildSessionResponse(session),
        });
    });

    router.post('/api/auth/logout', ({ res }) => {
        clearSessionCookie(res);
        sendJson(res, 200, { ok: true });
    });

    /**
     * GET /api/auth/users
     * Returns switchable Plex Home Users for the active server.
     * Scoped strictly to Server Owners and Delegated PASTA Admins on monitored servers,
     * or the account owner on their own Plex Home.
     */
    router.get('/api/auth/users', async ({ res, query, session }) => {
        if (!session) {
            sendError(res, 401, 'Not authenticated');
            return;
        }

        let effectiveMachineId = query.machineIdentifier || session.activeMachineId;
        const clientIdentifier = query.clientIdentifier || 'PASTA-Server';

        if (!effectiveMachineId) {
            const db = getDatabase();
            const ownedRow = db
                .prepare(
                    'SELECT machine_identifier FROM monitored_servers WHERE owner_plex_user_id = ? LIMIT 1'
                )
                .get(session.primaryPlexUserId) as { machine_identifier: string } | undefined;
            if (ownedRow) {
                effectiveMachineId = ownedRow.machine_identifier;
            } else {
                const anyMonitored = db
                    .prepare('SELECT machine_identifier FROM monitored_servers LIMIT 1')
                    .get() as { machine_identifier: string } | undefined;
                if (anyMonitored) {
                    // External shared users do not have switchable Plex Home profiles on this PASTA instance
                    sendJson(res, 200, []);
                    return;
                }
            }
        }

        let tokenForHome = getPrimaryToken(session);
        let ownerPlexUserId = session.primaryPlexUserId;

        if (effectiveMachineId) {
            const monitored = getMonitoredServer(effectiveMachineId);
            if (monitored) {
                const role = getUserRoleForServer(effectiveMachineId, session.primaryPlexUserId);
                if (role !== 'owner' && role !== 'admin') {
                    // Standard users cannot switch into other users' profiles
                    sendJson(res, 200, []);
                    return;
                }
                const ownerToken = decryptToken(monitored.encrypted_owner_token);
                if (ownerToken) {
                    tokenForHome = ownerToken;
                    ownerPlexUserId = monitored.owner_plex_user_id;
                }
            }
        }

        // Always query Plex for the live authoritative list of Plex Home Users
        let liveHomeUsers: PlexHomeUser[] | null = null;
        if (tokenForHome) {
            liveHomeUsers = await getPlexHomeUsers(clientIdentifier, tokenForHome).catch(() => null);
        }

        // Sync and prune server_users in SQLite if a monitored server is known
        if (effectiveMachineId && tokenForHome) {
            const monitored = getMonitoredServer(effectiveMachineId);
            if (monitored) {
                const syncPromise = syncServerUsersFromPlex(
                    effectiveMachineId,
                    {
                        id: ownerPlexUserId,
                        uuid: session.primaryUuid || session.uuid,
                        username: session.primaryUsername || 'Owner',
                    },
                    tokenForHome,
                    clientIdentifier,
                    {
                        preloadedHomeUsers: liveHomeUsers || undefined,
                    }
                ).catch(() => {});

                if (!liveHomeUsers) {
                    await syncPromise;
                }
            }
        }

        if (liveHomeUsers && Array.isArray(liveHomeUsers)) {
            sendJson(res, 200, liveHomeUsers);
            return;
        }

        // Offline fallback if plex.tv could not be reached
        if (effectiveMachineId) {
            const dbUsers = getServerUsers(effectiveMachineId).filter(u => u.isHomeUser);
            if (dbUsers.length > 0) {
                const homeUsers: PlexHomeUser[] = dbUsers.map(u => ({
                    id: u.plexUserId,
                    uuid: u.uuid,
                    title: u.isServerOwner ? u.username || u.title : u.title,
                    username: u.isServerOwner ? u.username : '',
                    email: u.email,
                    thumb: u.thumb,
                    protected: u.isProtected,
                    admin: u.isServerOwner,
                }));
                sendJson(res, 200, homeUsers);
                return;
            }
        }

        sendJson(res, 200, []);
    });

    /**
     * POST /api/auth/switch-user
     * Verifies optional PIN and switches the active user inside the server-side session cookie.
     * Supports switching both BEFORE connecting to a server (initial Plex Home user selection)
     * and WHILE connected to a server.
     */
    router.post('/api/auth/switch-user', async ({ res, body, session }) => {
        if (!session) {
            sendError(res, 401, 'Not authenticated');
            return;
        }

        const payload = (body || {}) as {
            targetUser?: PlexHomeUser;
            pin?: string;
            machineIdentifier?: string;
            clientIdentifier?: string;
        };

        const targetUser = payload.targetUser;
        const machineId = payload.machineIdentifier || session.activeMachineId || null;
        const clientIdentifier = payload.clientIdentifier || 'PASTA-Server';

        if (!targetUser) {
            sendError(res, 400, 'targetUser is required');
            return;
        }

        const monitored = machineId ? getMonitoredServer(machineId) : undefined;
        if (monitored && machineId) {
            const role = getUserRoleForServer(machineId, session.primaryPlexUserId);
            if (role !== 'owner' && role !== 'admin') {
                sendError(res, 403, 'Only Server Owners and PASTA Admins can switch user profiles');
                return;
            }
        }

        const primaryToken = getPrimaryToken(session);
        const isSwitchingToAdmin =
            targetUser.id === session.primaryPlexUserId || Boolean(targetUser.admin);

        // Verify PIN with plex.tv if user is PIN-protected
        let switchedHomeToken = '';
        if (targetUser.protected || (isSwitchingToAdmin && isPrimaryUserPinProtected(session))) {
            switchedHomeToken = await switchPlexHomeUser(
                targetUser.uuid || session.primaryUuid || session.uuid,
                clientIdentifier,
                primaryToken,
                payload.pin || ''
            );
        }

        let resolvedToken = '';
        let isManaged: boolean;

        if (isSwitchingToAdmin) {
            resolvedToken =
                (machineId ? getUserTokenForServer(machineId, targetUser.id) : null) ||
                primaryToken;
            isManaged = false;
        } else {
            isManaged = true;
            if (machineId && !session.isSharedServer) {
                let cachedToken = getUserTokenForServer(machineId, targetUser.id);
                if (!cachedToken && monitored) {
                    await syncServerUsersFromPlex(
                        machineId,
                        {
                            id: session.primaryPlexUserId,
                            uuid: session.primaryUuid || session.uuid,
                            username: session.primaryUsername,
                        },
                        primaryToken,
                        clientIdentifier
                    );
                    cachedToken = getUserTokenForServer(machineId, targetUser.id);
                }

                if (cachedToken) {
                    resolvedToken = cachedToken;
                }
            }

            if (!resolvedToken) {
                // Find any stored server token for this Managed User across owned servers
                const db = getDatabase();
                const ownedServers = db
                    .prepare(
                        'SELECT machine_identifier FROM monitored_servers WHERE owner_plex_user_id = ?'
                    )
                    .all(session.primaryPlexUserId) as Array<{ machine_identifier: string }>;
                for (const srv of ownedServers) {
                    const tok = getUserTokenForServer(srv.machine_identifier, targetUser.id);
                    if (tok) {
                        resolvedToken = tok;
                        break;
                    }
                }
                if (!resolvedToken) {
                    // Verify that the target managed user actually exists in Plex Home
                    const liveUsers = await getPlexHomeUsers(clientIdentifier, primaryToken).catch(
                        (): PlexHomeUser[] => []
                    );
                    const userExistsInHome = liveUsers.some(u => u.id === targetUser.id);
                    if (!userExistsInHome) {
                        sendError(res, 404, 'User profile no longer exists in Plex Home');
                        return;
                    }
                    resolvedToken = switchedHomeToken || primaryToken;
                }
            }
        }

        const db = getDatabase();
        const ownerRow = db
            .prepare(
                'SELECT uuid, username, title, email, thumb FROM server_users WHERE plex_user_id = ? AND is_server_owner = 1 LIMIT 1'
            )
            .get(session.primaryPlexUserId) as
            | { uuid: string; username: string; title: string; email: string; thumb: string }
            | undefined;

        const authoritativePrimaryThumb =
            ownerRow?.thumb ||
            session.primaryThumb ||
            (session.plexUserId === session.primaryPlexUserId ? session.thumb : '');
        const authoritativePrimaryUuid =
            ownerRow?.uuid ||
            session.primaryUuid ||
            (session.plexUserId === session.primaryPlexUserId ? session.uuid : '');

        const updatedSession: SessionPayload = {
            ...session,
            primaryThumb: authoritativePrimaryThumb,
            primaryUuid: authoritativePrimaryUuid,
            plexUserId: targetUser.id,
            uuid: isSwitchingToAdmin
                ? authoritativePrimaryUuid || targetUser.uuid || ''
                : targetUser.uuid || '',
            username: isSwitchingToAdmin
                ? ownerRow?.username ||
                  session.primaryUsername ||
                  targetUser.username ||
                  targetUser.title
                : targetUser.username || targetUser.title,
            title: isSwitchingToAdmin
                ? ownerRow?.username ||
                  ownerRow?.title ||
                  session.primaryUsername ||
                  targetUser.title
                : targetUser.title || targetUser.username,
            email: isSwitchingToAdmin
                ? ownerRow?.email || targetUser.email || session.email || ''
                : targetUser.email || '',
            thumb: isSwitchingToAdmin
                ? authoritativePrimaryThumb || targetUser.thumb || ''
                : targetUser.thumb || '',
            encryptedActiveToken: encryptToken(resolvedToken),
            activeMachineId: null,
            activeServerUrl: null,
            activeServerName: null,
            isSharedServer: false,
            isManagedUser: isManaged,
            adminPinVerified: isSwitchingToAdmin ? true : false,
        };

        setSessionCookie(res, updatedSession);
        sendJson(res, 200, {
            ok: true,
            session: buildSessionResponse(updatedSession),
        });
    });

    /**
     * POST /api/auth/verify-admin-pin
     * Verifies the primary Admin account's 4-digit Plex Home PIN before granting access to Admin Settings
     * (e.g. when opening Admin Settings directly from the Server Selection screen before selecting a user).
     */
    router.post('/api/auth/verify-admin-pin', async ({ res, body, session }) => {
        if (!session) {
            sendError(res, 401, 'Not authenticated');
            return;
        }
        if (session.isManagedUser) {
            sendError(res, 403, 'Managed users cannot access Admin Settings');
            return;
        }

        const payload = (body || {}) as {
            pin?: string;
            clientIdentifier?: string;
        };
        const pin = payload.pin?.trim() || '';
        const clientIdentifier = payload.clientIdentifier || 'PASTA-Server';

        if (!pin) {
            sendError(res, 400, 'PIN is required');
            return;
        }

        const primaryToken = getPrimaryToken(session);
        let adminUuid = session.primaryUuid || session.uuid;
        if (!adminUuid) {
            const db = getDatabase();
            const row = db
                .prepare('SELECT uuid FROM server_users WHERE plex_user_id = ? AND uuid != \'\' LIMIT 1')
                .get(session.primaryPlexUserId) as { uuid: string } | undefined;
            adminUuid = row?.uuid || '';
        }

        if (!adminUuid) {
            const homeUsers = await getPlexHomeUsers(clientIdentifier, primaryToken).catch(
                (): PlexHomeUser[] => []
            );
            const ownerEntry = homeUsers.find(
                u => u.id === session.primaryPlexUserId || u.admin
            );
            adminUuid = ownerEntry?.uuid || '';
        }

        if (!adminUuid) {
            sendError(res, 400, 'Could not determine Admin account UUID for PIN verification');
            return;
        }

        await switchPlexHomeUser(adminUuid, clientIdentifier, primaryToken, pin);

        const updatedSession: SessionPayload = {
            ...session,
            primaryUuid: adminUuid,
            isAdminPinProtected: true,
            adminPinVerified: true,
        };

        setSessionCookie(res, updatedSession);
        sendJson(res, 200, {
            ok: true,
            session: buildSessionResponse(updatedSession),
        });
    });
};
