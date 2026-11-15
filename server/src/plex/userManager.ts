import type { PlexHomeUser, PlexUser } from '../../../src/shared/types/plex.ts';
import { decryptToken, encryptToken } from '../storage/crypto.ts';
import { getDatabase, withTransaction } from '../storage/db.ts';
import {
    getPlexAccountUser,
    getPlexHomeUsers,
    getPlexSharedServersXml,
} from './client.ts';

export interface ServerUserRecord {
    machineIdentifier: string;
    plexUserId: number;
    uuid: string;
    username: string;
    title: string;
    email: string;
    thumb: string;
    isHomeUser: boolean;
    isProtected: boolean;
    isServerOwner: boolean;
    isPastaAdmin: boolean;
}

interface ParsedSharedServerUser {
    userId: number;
    username: string;
    email: string;
    thumb: string;
    accessToken: string;
}

const extractXmlAttr = (tagContent: string, attrName: string): string => {
    const regex = new RegExp(`\\b${attrName}\\s*=\\s*"([^"]*)"`, 'i');
    const match = regex.exec(tagContent);
    return match ? match[1] : '';
};

/**
 * Parses `<SharedServer ... />` elements from `plex.tv/api/servers/{machineId}/shared_servers` XML.
 */
export const parseSharedServersXml = (xmlString: string): ParsedSharedServerUser[] => {
    const results: ParsedSharedServerUser[] = [];
    if (!xmlString) return results;

    const tagRegex = /<SharedServer\b([^>]*?)\/?>/gi;
    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(xmlString)) !== null) {
        const attrs = match[1];
        const userIdRaw = extractXmlAttr(attrs, 'userID');
        const accessToken = extractXmlAttr(attrs, 'accessToken');
        const userId = Number.parseInt(userIdRaw, 10);

        if (!Number.isNaN(userId) && userId > 0 && accessToken) {
            const username =
                extractXmlAttr(attrs, 'username') ||
                extractXmlAttr(attrs, 'title') ||
                `User ${userId}`;
            const email = extractXmlAttr(attrs, 'email');
            const thumb = extractXmlAttr(attrs, 'thumb');

            results.push({
                userId,
                username,
                email,
                thumb,
                accessToken,
            });
        }
    }

    return results;
};

const lastServerUserSyncAt = new Map<string, number>();
const USER_SYNC_COOLDOWN_MS = 30_000;

/**
 * Syncs the Owner, Plex Home Managed Users, and Shared External Users for an owned server
 * into `server_users` in SQLite (preserving existing `is_pasta_admin` delegations).
 */
export const syncServerUsersFromPlex = async (
    machineIdentifier: string,
    ownerUser: PlexUser,
    ownerToken: string,
    clientIdentifier: string,
    options?: { preloadedHomeUsers?: PlexHomeUser[]; force?: boolean }
): Promise<ServerUserRecord[]> => {
    const lastSync = lastServerUserSyncAt.get(machineIdentifier) || 0;
    if (!options?.force && Date.now() - lastSync < USER_SYNC_COOLDOWN_MS) {
        const cached = getServerUsers(machineIdentifier);
        if (cached.length > 0) {
            return cached;
        }
    }

    const [homeUsers, sharedXml, accountUser] = await Promise.all([
        options?.preloadedHomeUsers
            ? Promise.resolve(options.preloadedHomeUsers)
            : getPlexHomeUsers(clientIdentifier, ownerToken).catch((): PlexHomeUser[] => []),
        getPlexSharedServersXml(machineIdentifier, clientIdentifier, ownerToken).catch(() => ''),
        getPlexAccountUser(clientIdentifier, ownerToken).catch(() => null),
    ]);

    lastServerUserSyncAt.set(machineIdentifier, Date.now());

    const sharedXmlSuccess = Boolean(sharedXml && sharedXml.includes('<MediaContainer'));

    const sharedUsers = parseSharedServersXml(sharedXml);
    const sharedByUserId = new Map<number, ParsedSharedServerUser>();
    for (const su of sharedUsers) {
        sharedByUserId.set(su.userId, su);
    }

    const homeByUserId = new Map<number, PlexHomeUser>();
    for (const hu of homeUsers) {
        homeByUserId.set(hu.id, hu);
    }

    const now = Date.now();
    const isOwnerAccountMatch = accountUser?.id === ownerUser.id;
    const ownerDisplayName =
        (isOwnerAccountMatch ? accountUser?.username : '') ||
        ownerUser.username ||
        ownerUser.title ||
        'Owner';

    const validUserIds = new Set<number>();
    validUserIds.add(ownerUser.id);
    for (const su of sharedUsers) {
        validUserIds.add(su.userId);
    }

    withTransaction(db => {
        const upsertStmt = db.prepare(`
            INSERT INTO server_users (
                machine_identifier,
                plex_user_id,
                uuid,
                username,
                title,
                email,
                thumb,
                is_home_user,
                is_protected,
                is_server_owner,
                is_pasta_admin,
                encrypted_access_token,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(machine_identifier, plex_user_id) DO UPDATE SET
                uuid = excluded.uuid,
                username = excluded.username,
                title = excluded.title,
                email = excluded.email,
                thumb = excluded.thumb,
                is_home_user = excluded.is_home_user,
                is_protected = excluded.is_protected,
                is_server_owner = excluded.is_server_owner,
                is_pasta_admin = CASE
                    WHEN excluded.is_server_owner = 1 THEN 1
                    ELSE server_users.is_pasta_admin
                END,
                encrypted_access_token = excluded.encrypted_access_token,
                updated_at = excluded.updated_at
        `);

        // 1. Upsert Server Owner (always prefer authoritative Plex Home / Account metadata for the Owner)
        const ownerHomeEntry = homeByUserId.get(ownerUser.id);
        const ownerTitle =
            (isOwnerAccountMatch ? accountUser?.username || accountUser?.title : '') ||
            ownerHomeEntry?.username ||
            ownerHomeEntry?.title ||
            ownerUser.username ||
            ownerDisplayName;
        const ownerThumb =
            ownerHomeEntry?.thumb ||
            (isOwnerAccountMatch ? accountUser?.thumb : '') ||
            ownerUser.thumb ||
            '';
        const ownerUuid =
            ownerHomeEntry?.uuid ||
            (isOwnerAccountMatch ? accountUser?.uuid : '') ||
            ownerUser.uuid ||
            '';
        const ownerEmail =
            ownerHomeEntry?.email ||
            (isOwnerAccountMatch ? accountUser?.email : '') ||
            ownerUser.email ||
            '';
        upsertStmt.run(
            machineIdentifier,
            ownerUser.id,
            ownerUuid,
            ownerDisplayName,
            ownerTitle,
            ownerEmail,
            ownerThumb,
            1,
            ownerHomeEntry?.protected || ownerUser.protected ? 1 : 0,
            1,
            1,
            encryptToken(ownerToken),
            now
        );

        // 2. Upsert all Shared / Managed Users who have an accessToken for this server
        for (const su of sharedUsers) {
            if (su.userId === ownerUser.id) continue;
            const homeEntry = homeByUserId.get(su.userId);
            const title = homeEntry?.title || homeEntry?.username || su.username;
            const username = homeEntry?.username || su.username || title;

            upsertStmt.run(
                machineIdentifier,
                su.userId,
                homeEntry?.uuid || '',
                username,
                title,
                homeEntry?.email || su.email || '',
                homeEntry?.thumb || su.thumb || '',
                homeEntry ? 1 : 0,
                homeEntry?.protected ? 1 : 0,
                0,
                0,
                encryptToken(su.accessToken),
                now
            );
        }

        // 3. Prune users who are no longer shared with this server or were deleted from Plex
        if (sharedXmlSuccess) {
            const validIds = Array.from(validUserIds);
            if (validIds.length > 0) {
                const placeholders = validIds.map(() => '?').join(',');
                db.prepare(`
                    DELETE FROM server_users
                    WHERE machine_identifier = ?
                      AND plex_user_id NOT IN (${placeholders})
                `).run(machineIdentifier, ...validIds);

                db.prepare(`
                    DELETE FROM episode_baselines
                    WHERE machine_identifier = ?
                      AND plex_user_id NOT IN (${placeholders})
                `).run(machineIdentifier, ...validIds);
            }
        }
    });

    return getServerUsers(machineIdentifier);
};

interface RawServerUserRow {
    machine_identifier: string;
    plex_user_id: number;
    uuid: string;
    username: string;
    title: string;
    email: string;
    thumb: string;
    is_home_user: number;
    is_protected: number;
    is_server_owner: number;
    is_pasta_admin: number;
    encrypted_access_token: string;
}

export const getServerUsers = (machineIdentifier: string): ServerUserRecord[] => {
    const db = getDatabase();
    const stmt = db.prepare(`
        SELECT
            machine_identifier,
            plex_user_id,
            uuid,
            username,
            title,
            email,
            thumb,
            is_home_user,
            is_protected,
            is_server_owner,
            is_pasta_admin
        FROM server_users
        WHERE machine_identifier = ?
        ORDER BY is_server_owner DESC, is_home_user DESC, title COLLATE NOCASE ASC
    `);
    const rows = stmt.all(machineIdentifier) as unknown as RawServerUserRow[];

    return rows.map(r => ({
        machineIdentifier: r.machine_identifier,
        plexUserId: r.plex_user_id,
        uuid: r.uuid,
        username: r.username,
        title: r.title,
        email: r.email,
        thumb: r.thumb,
        isHomeUser: Boolean(r.is_home_user),
        isProtected: Boolean(r.is_protected),
        isServerOwner: Boolean(r.is_server_owner),
        isPastaAdmin: Boolean(r.is_pasta_admin || r.is_server_owner),
    }));
};

/**
 * Normalizes a PMS-local account ID (as reported by `/status/sessions` `User.id` and
 * `ActivityNotification.userID`) to the plex.tv user ID stored in `server_users`.
 *
 * PMS always reports the Server Owner as local account `1` (not their plex.tv ID), so
 * `1` is mapped to the `is_server_owner = 1` row. Unknown IDs fall back to a
 * case-insensitive username/title match when a session title is available.
 */
export const resolvePmsAccountId = (
    machineIdentifier: string,
    pmsUserId: number,
    pmsUserTitle?: string
): number => {
    const db = getDatabase();

    if (pmsUserId === 1) {
        const owner = db
            .prepare(
                'SELECT plex_user_id FROM server_users WHERE machine_identifier = ? AND is_server_owner = 1 LIMIT 1'
            )
            .get(machineIdentifier) as { plex_user_id: number } | undefined;
        if (owner) return owner.plex_user_id;
    }

    const direct = db
        .prepare(
            'SELECT plex_user_id FROM server_users WHERE machine_identifier = ? AND plex_user_id = ?'
        )
        .get(machineIdentifier, pmsUserId) as { plex_user_id: number } | undefined;
    if (direct) return direct.plex_user_id;

    const title = pmsUserTitle?.trim();
    if (title) {
        const byName = db
            .prepare(
                'SELECT plex_user_id FROM server_users WHERE machine_identifier = ? AND (LOWER(username) = LOWER(?) OR LOWER(title) = LOWER(?)) LIMIT 1'
            )
            .get(machineIdentifier, title, title) as { plex_user_id: number } | undefined;
        if (byName) return byName.plex_user_id;
    }

    return pmsUserId;
};

export const getUserTokenForServer = (
    machineIdentifier: string,
    plexUserId: number
): string | null => {
    const db = getDatabase();
    const row = db
        .prepare(
            'SELECT encrypted_access_token FROM server_users WHERE machine_identifier = ? AND plex_user_id = ?'
        )
        .get(machineIdentifier, plexUserId) as { encrypted_access_token: string } | undefined;

    if (!row?.encrypted_access_token) return null;
    try {
        return decryptToken(row.encrypted_access_token);
    } catch {
        return null;
    }
};

export const getAllUserTokensForServer = (
    machineIdentifier: string,
    filterUserIds?: number[]
): Array<{ plexUserId: number; username: string; token: string }> => {
    const db = getDatabase();
    const rows = db
        .prepare(
            'SELECT plex_user_id, username, title, encrypted_access_token FROM server_users WHERE machine_identifier = ? ORDER BY is_server_owner DESC, plex_user_id ASC'
        )
        .all(machineIdentifier) as Array<{
        plex_user_id: number;
        username: string;
        title: string;
        encrypted_access_token: string;
    }>;

    const filterSet = filterUserIds && filterUserIds.length > 0 ? new Set(filterUserIds) : null;
    const result: Array<{ plexUserId: number; username: string; token: string }> = [];

    for (const r of rows) {
        if (filterSet && !filterSet.has(r.plex_user_id)) continue;
        try {
            const token = decryptToken(r.encrypted_access_token);
            result.push({
                plexUserId: r.plex_user_id,
                username: r.title || r.username,
                token,
            });
        } catch {
            // Skip undecryptable token
        }
    }

    return result;
};

export const getUserRoleForServer = (
    machineIdentifier: string,
    plexUserId: number
): 'owner' | 'admin' | 'user' | null => {
    const db = getDatabase();
    const serverRow = db
        .prepare('SELECT owner_plex_user_id FROM monitored_servers WHERE machine_identifier = ?')
        .get(machineIdentifier) as { owner_plex_user_id: number } | undefined;

    if (serverRow && serverRow.owner_plex_user_id === plexUserId) {
        return 'owner';
    }

    const userRow = db
        .prepare(
            'SELECT is_server_owner, is_pasta_admin FROM server_users WHERE machine_identifier = ? AND plex_user_id = ?'
        )
        .get(machineIdentifier, plexUserId) as
        | { is_server_owner: number; is_pasta_admin: number }
        | undefined;

    if (!userRow) return null;
    if (userRow.is_server_owner) return 'owner';
    if (userRow.is_pasta_admin) return 'admin';
    return 'user';
};

export const setDelegatedPastaAdmin = (
    machineIdentifier: string,
    targetPlexUserId: number,
    isPastaAdmin: boolean
): void => {
    const db = getDatabase();
    db.prepare(
        `UPDATE server_users
         SET is_pasta_admin = CASE WHEN is_server_owner = 1 THEN 1 ELSE ? END,
             updated_at = ?
         WHERE machine_identifier = ? AND plex_user_id = ?`
    ).run(isPastaAdmin ? 1 : 0, Date.now(), machineIdentifier, targetPlexUserId);
};
