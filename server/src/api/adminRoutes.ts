import {
    getServerUsers,
    getUserRoleForServer,
    setDelegatedPastaAdmin,
    syncServerUsersFromPlex,
} from '../plex/userManager.ts';
import { probeServerIdentity } from '../plex/client.ts';
import { catchUpMissedEpisodesSince } from '../daemon/scanner.ts';
import { restartServerListener } from '../daemon/serverManager.ts';
import { decryptToken } from '../storage/crypto.ts';
import { getDatabase } from '../storage/db.ts';
import {
    getDiagnosticBufferStats,
    getDiagnosticEvents,
    isDebugForcedByEnv,
    isDebugLoggingEnabled,
    isUiDebugLoggingEnabled,
    recordDiagnosticEvent,
    setUiDebugLoggingEnabled,
} from '../storage/diagnostics.ts';
import { getManagedServersForUser, requiresAdminPinForSession } from './authRoutes.ts';
import { type ApiRouter, sendError, sendJson } from './httpServer.ts';
import { getMonitoredServer } from './serverRoutes.ts';
import type { SessionPayload } from './session.ts';

/**
 * Normalizes a user-provided custom Plex URL or bare IP address:
 * - Prepends `http://` if no scheme (`http://` or `https://`) is specified
 * - Defaults port to `:32400` if no port is specified on a bare IPv4 address or `localhost`
 * - Strips trailing slashes
 */
export const normalizeCustomPlexUrl = (raw: string | undefined | null): string | null => {
    const trimmed = raw?.trim().replace(/\/+$/, '') || '';
    if (!trimmed) return null;

    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    try {
        const parsed = new URL(withScheme);
        const isBareIpv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(parsed.hostname);
        if (!parsed.port && (isBareIpv4 || parsed.hostname === 'localhost')) {
            parsed.port = '32400';
        }
        const pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
        return `${parsed.origin}${pathname}`;
    } catch {
        return withScheme;
    }
};

const requireAdminAccess = (
    machineId: string,
    session: SessionPayload | null
): { allowed: boolean; role: 'owner' | 'admin' | null; errorStatus?: number; errorMessage?: string } => {
    if (!session) {
        return { allowed: false, role: null, errorStatus: 401, errorMessage: 'Not authenticated' };
    }
    const monitored = getMonitoredServer(machineId);
    if (!monitored) {
        return {
            allowed: false,
            role: null,
            errorStatus: 404,
            errorMessage: 'Server is not registered on this PASTA Server instance',
        };
    }

    const role = getUserRoleForServer(machineId, session.plexUserId);
    if (role !== 'owner' && role !== 'admin') {
        return {
            allowed: false,
            role: null,
            errorStatus: 403,
            errorMessage: 'Admin privileges required for this Plex server',
        };
    }

    if (requiresAdminPinForSession(session)) {
        return {
            allowed: false,
            role: null,
            errorStatus: 403,
            errorMessage: 'Admin PIN verification required',
        };
    }

    return { allowed: true, role };
};

export const registerAdminRoutes = (router: ApiRouter): void => {
    /**
     * GET /api/admin/servers
     * Returns ONLY the monitored servers on THIS PASTA instance where the user is Owner or Delegated PASTA Admin.
     */
    router.get('/api/admin/servers', ({ res, session }) => {
        if (!session) {
            sendError(res, 401, 'Not authenticated');
            return;
        }
        const servers = getManagedServersForUser(session.plexUserId);
        sendJson(res, 200, servers);
    });

    /**
     * GET /api/admin/:machineId/config
     * Returns server automation settings for the Admin Settings -> Server Configuration tab.
     */
    router.get('/api/admin/:machineId/config', ({ res, params, session }) => {
        const check = requireAdminAccess(params.machineId, session);
        if (!check.allowed) {
            sendError(res, check.errorStatus!, check.errorMessage!);
            return;
        }

        const srv = getMonitoredServer(params.machineId)!;
        sendJson(res, 200, {
            machineIdentifier: srv.machine_identifier,
            serverName: srv.server_name,
            serverUrl: srv.server_url,
            customUrlOverride: srv.custom_url_override || '',
            authStatus: srv.auth_status,
            isMonitoringEnabled: Boolean(srv.is_monitoring_enabled),
            debounceSeconds: srv.debounce_seconds,
            updateLevel: srv.update_level,
            updateStrategy: srv.update_strategy,
            autoForcedSubtitles: Boolean(srv.auto_forced_subtitles),
            triggerOnPlay: Boolean(srv.trigger_on_play),
            triggerOnScan: Boolean(srv.trigger_on_scan),
            triggerOnActivity: Boolean(srv.trigger_on_activity),
            retentionDays: srv.retention_days,
            debugLogging: isDebugLoggingEnabled(),
            debugForcedByEnv: isDebugForcedByEnv(),
        });
    });

    /**
     * PUT /api/admin/:machineId/debug-logging
     * Toggles runtime debug logging (persisted in SQLite instance_settings unless forced ON by PASTA_DEBUG=true).
     */
    router.put('/api/admin/:machineId/debug-logging', ({ res, params, body, session }) => {
        const check = requireAdminAccess(params.machineId, session);
        if (!check.allowed) {
            sendError(res, check.errorStatus!, check.errorMessage!);
            return;
        }

        const payload = (body || {}) as { enabled?: boolean };
        if (!isDebugForcedByEnv() && typeof payload.enabled === 'boolean') {
            setUiDebugLoggingEnabled(payload.enabled);
            recordDiagnosticEvent(
                'SYSTEM',
                `Debug logging ${payload.enabled ? 'enabled' : 'disabled'} via Admin Settings`,
                undefined,
                params.machineId
            );
        }

        sendJson(res, 200, {
            ok: true,
            debugLogging: isDebugLoggingEnabled(),
            debugForcedByEnv: isDebugForcedByEnv(),
        });
    });

    /**
     * PUT /api/admin/:machineId/config
     * Updates server automation settings.
     */
    router.put('/api/admin/:machineId/config', ({ res, params, body, session }) => {
        const check = requireAdminAccess(params.machineId, session);
        if (!check.allowed) {
            sendError(res, check.errorStatus!, check.errorMessage!);
            return;
        }

        const srv = getMonitoredServer(params.machineId)!;
        const payload = (body || {}) as {
            customUrlOverride?: string;
            isMonitoringEnabled?: boolean;
            debounceSeconds?: number;
            updateLevel?: 'show' | 'season';
            updateStrategy?: 'next' | 'all';
            autoForcedSubtitles?: boolean;
            triggerOnPlay?: boolean;
            triggerOnScan?: boolean;
            triggerOnActivity?: boolean;
            retentionDays?: number;
        };

        const customUrlOverride =
            payload.customUrlOverride !== undefined
                ? normalizeCustomPlexUrl(payload.customUrlOverride)
                : srv.custom_url_override;
        const isMonitoringEnabled =
            payload.isMonitoringEnabled !== undefined
                ? payload.isMonitoringEnabled
                    ? 1
                    : 0
                : srv.is_monitoring_enabled;
        const debounceSeconds =
            payload.debounceSeconds !== undefined
                ? Math.max(5, Math.min(300, Math.round(payload.debounceSeconds)))
                : srv.debounce_seconds;
        const updateLevel =
            payload.updateLevel === 'season' || payload.updateLevel === 'show'
                ? payload.updateLevel
                : srv.update_level;
        const updateStrategy =
            payload.updateStrategy === 'all' || payload.updateStrategy === 'next'
                ? payload.updateStrategy
                : srv.update_strategy;
        const autoForcedSubtitles =
            payload.autoForcedSubtitles !== undefined
                ? payload.autoForcedSubtitles
                    ? 1
                    : 0
                : srv.auto_forced_subtitles;
        const triggerOnPlay =
            payload.triggerOnPlay !== undefined
                ? payload.triggerOnPlay
                    ? 1
                    : 0
                : srv.trigger_on_play;
        const triggerOnScan =
            payload.triggerOnScan !== undefined
                ? payload.triggerOnScan
                    ? 1
                    : 0
                : srv.trigger_on_scan;
        const triggerOnActivity =
            payload.triggerOnActivity !== undefined
                ? payload.triggerOnActivity
                    ? 1
                    : 0
                : srv.trigger_on_activity;
        const retentionDays =
            payload.retentionDays !== undefined
                ? Math.max(1, Math.min(3650, Math.round(payload.retentionDays)))
                : srv.retention_days;

        const db = getDatabase();
        db.prepare(`
            UPDATE monitored_servers
            SET custom_url_override = ?,
                is_monitoring_enabled = ?,
                debounce_seconds = ?,
                update_level = ?,
                update_strategy = ?,
                auto_forced_subtitles = ?,
                trigger_on_play = ?,
                trigger_on_scan = ?,
                trigger_on_activity = ?,
                retention_days = ?,
                updated_at = ?
            WHERE machine_identifier = ?
        `).run(
            customUrlOverride,
            isMonitoringEnabled,
            debounceSeconds,
            updateLevel,
            updateStrategy,
            autoForcedSubtitles,
            triggerOnPlay,
            triggerOnScan,
            triggerOnActivity,
            retentionDays,
            Date.now(),
            params.machineId
        );

        restartServerListener(params.machineId);
        sendJson(res, 200, { ok: true, customUrlOverride: customUrlOverride || '' });
    });

    /**
     * POST /api/admin/:machineId/test-connection
     * Tests connectivity to the specified Plex URL (or the server's active URL) using the stored owner token.
     */
    router.post('/api/admin/:machineId/test-connection', async ({ res, params, body, session }) => {
        const check = requireAdminAccess(params.machineId, session);
        if (!check.allowed) {
            sendError(res, check.errorStatus!, check.errorMessage!);
            return;
        }

        const srv = getMonitoredServer(params.machineId)!;
        const payload = (body || {}) as { url?: string };
        const rawUrl =
            payload.url?.trim() ||
            srv.custom_url_override?.trim() ||
            srv.server_url?.trim() ||
            '';

        if (!rawUrl) {
            sendJson(res, 200, {
                ok: false,
                url: '',
                errorMessage: 'No Plex URL specified to test.',
            });
            return;
        }

        const cleanUrl = normalizeCustomPlexUrl(rawUrl) || rawUrl;

        let ownerToken: string;
        try {
            ownerToken = decryptToken(srv.encrypted_owner_token);
        } catch {
            sendJson(res, 200, {
                ok: false,
                url: cleanUrl,
                errorMessage: 'Stored owner token could not be decrypted.',
            });
            return;
        }

        const startMs = Date.now();
        try {
            const identity = await probeServerIdentity(
                cleanUrl,
                'PASTA-Server-AdminTest',
                ownerToken,
                5000
            );
            const latencyMs = Date.now() - startMs;

            if (
                identity.machineIdentifier &&
                identity.machineIdentifier !== srv.machine_identifier
            ) {
                sendJson(res, 200, {
                    ok: false,
                    url: cleanUrl,
                    errorMessage: `Connected to "${
                        identity.friendlyName || 'Plex Server'
                    }", but its machineIdentifier (${identity.machineIdentifier}) does not match ${
                        srv.server_name
                    }.`,
                });
                return;
            }

            sendJson(res, 200, {
                ok: true,
                url: cleanUrl,
                friendlyName: identity.friendlyName || srv.server_name,
                machineIdentifier: identity.machineIdentifier || srv.machine_identifier,
                latencyMs,
            });
        } catch (err) {
            sendJson(res, 200, {
                ok: false,
                url: cleanUrl,
                errorMessage:
                    err instanceof Error ? err.message : 'Failed to connect to Plex server',
            });
        }
    });

    /**
     * GET /api/admin/:machineId/users
     * Returns all users on this server (for both the Admin Users tab and the Target Users batch selector).
     */
    router.get('/api/admin/:machineId/users', async ({ res, params, session }) => {
        const check = requireAdminAccess(params.machineId, session);
        if (!check.allowed) {
            sendError(res, check.errorStatus!, check.errorMessage!);
            return;
        }

        const monitored = getMonitoredServer(params.machineId);
        if (monitored && session) {
            const ownerToken = decryptToken(monitored.encrypted_owner_token);
            if (ownerToken) {
                await syncServerUsersFromPlex(
                    params.machineId,
                    {
                        id: monitored.owner_plex_user_id,
                        uuid: '',
                        username: session.primaryUsername || 'Owner',
                    },
                    ownerToken,
                    'PASTA-Server'
                ).catch(() => {});
            }
        }

        const users = getServerUsers(params.machineId);
        sendJson(res, 200, users);
    });

    /**
     * PUT /api/admin/:machineId/users/:userId/role
     * Strictly Owner-only: toggles `is_pasta_admin` on a server user.
     */
    router.put('/api/admin/:machineId/users/:userId/role', ({ res, params, body, session }) => {
        const check = requireAdminAccess(params.machineId, session);
        if (!check.allowed) {
            sendError(res, check.errorStatus!, check.errorMessage!);
            return;
        }
        if (check.role !== 'owner') {
            sendError(res, 403, 'Only the Plex Server Owner can grant or revoke PASTA Admin privileges');
            return;
        }

        const targetUserId = Number.parseInt(params.userId, 10);
        if (Number.isNaN(targetUserId)) {
            sendError(res, 400, 'Invalid userId');
            return;
        }

        const payload = (body || {}) as { isPastaAdmin?: boolean };
        setDelegatedPastaAdmin(params.machineId, targetUserId, Boolean(payload.isPastaAdmin));

        sendJson(res, 200, {
            ok: true,
            users: getServerUsers(params.machineId),
        });
    });

    /**
     * GET /api/admin/:machineId/rules
     * Returns all automation rules (library, show, season, keyword) for the Library Settings tab.
     */
    router.get('/api/admin/:machineId/rules', ({ res, params, session }) => {
        const check = requireAdminAccess(params.machineId, session);
        if (!check.allowed) {
            sendError(res, check.errorStatus!, check.errorMessage!);
            return;
        }

        const db = getDatabase();
        const rows = db
            .prepare(
                'SELECT id, scope_type, target_key, target_title, parent_key, policy, updated_at FROM automation_rules WHERE machine_identifier = ? ORDER BY id ASC'
            )
            .all(params.machineId);

        sendJson(res, 200, rows);
    });

    /**
     * PUT /api/admin/:machineId/rules
     * Upserts or deletes an automation rule (library, show, season, or keyword).
     */
    router.put('/api/admin/:machineId/rules', ({ res, params, body, session }) => {
        const check = requireAdminAccess(params.machineId, session);
        if (!check.allowed) {
            sendError(res, check.errorStatus!, check.errorMessage!);
            return;
        }

        const payload = (body || {}) as {
            scopeType?:
                | 'library'
                | 'show'
                | 'season'
                | 'keyword'
                | 'library_forced'
                | 'show_forced'
                | 'keyword_forced';
            targetKey?: string;
            targetTitle?: string;
            parentKey?: string | null;
            policy?: 'ALLOW' | 'IGNORE' | 'DEFAULT';
        };

        if (!payload.scopeType || !payload.targetKey || !payload.policy) {
            sendError(res, 400, 'scopeType, targetKey, and policy are required');
            return;
        }

        const db = getDatabase();
        const isBuiltInKeyword =
            (payload.scopeType === 'keyword' &&
                (payload.targetKey.toUpperCase() === 'PASTA_IGNORE' ||
                    payload.targetKey.toUpperCase() === 'PAL-IGNORE')) ||
            (payload.scopeType === 'keyword_forced' &&
                payload.targetKey.toUpperCase() === 'PASTA_NO_FORCED');

        if (payload.policy === 'DEFAULT' && !isBuiltInKeyword) {
            db.prepare(
                'DELETE FROM automation_rules WHERE machine_identifier = ? AND scope_type = ? AND target_key = ?'
            ).run(params.machineId, payload.scopeType, payload.targetKey);
        } else {
            const effectivePolicy =
                payload.policy === 'DEFAULT' && isBuiltInKeyword ? 'ALLOW' : payload.policy;
            const effectiveTargetKey = isBuiltInKeyword
                ? payload.targetKey.toUpperCase()
                : payload.targetKey;
            db.prepare(`
                INSERT INTO automation_rules (
                    machine_identifier, scope_type, target_key, target_title, parent_key, policy, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(machine_identifier, scope_type, target_key) DO UPDATE SET
                    target_title = excluded.target_title,
                    parent_key = excluded.parent_key,
                    policy = excluded.policy,
                    updated_at = excluded.updated_at
            `).run(
                params.machineId,
                payload.scopeType,
                effectiveTargetKey,
                payload.targetTitle || effectiveTargetKey,
                payload.parentKey || null,
                effectivePolicy,
                Date.now()
            );
        }

        const updatedRows = db
            .prepare(
                'SELECT id, scope_type, target_key, target_title, parent_key, policy, updated_at FROM automation_rules WHERE machine_identifier = ? ORDER BY id ASC'
            )
            .all(params.machineId);

        sendJson(res, 200, updatedRows);
    });

    /**
     * GET /api/admin/:machineId/logs
     * Returns automation operations with expandable episode drill-down rows.
     */
    router.get('/api/admin/:machineId/logs', ({ res, params, query, session }) => {
        const check = requireAdminAccess(params.machineId, session);
        if (!check.allowed) {
            sendError(res, check.errorStatus!, check.errorMessage!);
            return;
        }

        const limit = Math.min(200, Math.max(1, Number.parseInt(query.limit || '50', 10) || 50));
        const db = getDatabase();

        const ops = db
            .prepare(`
                SELECT
                    id,
                    machine_identifier,
                    plex_user_id,
                    username,
                    trigger_type,
                    show_rating_key,
                    show_title,
                    reference_episode_key,
                    reference_episode_label,
                    audio_summary,
                    subtitle_summary,
                    updated_count,
                    skipped_count,
                    created_at
                FROM auto_operations
                WHERE machine_identifier = ?
                ORDER BY created_at DESC
                LIMIT ?
            `)
            .all(params.machineId, limit) as Array<{
            id: number;
            machine_identifier: string;
            plex_user_id: number;
            username: string;
            trigger_type: string;
            show_rating_key: string;
            show_title: string;
            reference_episode_key: string;
            reference_episode_label: string;
            audio_summary: string | null;
            subtitle_summary: string | null;
            updated_count: number;
            skipped_count: number;
            created_at: number;
        }>;

        const episodesStmt = db.prepare(`
            SELECT
                id,
                episode_rating_key,
                episode_label,
                target_username,
                change_applied,
                match_reason,
                was_updated
            FROM auto_operation_episodes
            WHERE operation_id = ?
            ORDER BY id ASC
        `);

        const result = ops.map(op => ({
            ...op,
            episodes: episodesStmt.all(op.id),
        }));

        sendJson(res, 200, result);
    });

    /**
     * DELETE /api/admin/:machineId/logs
     * Clears automation logs for this server (`?olderThan=all|1h|12h|1d|1w|1m`).
     */
    router.delete('/api/admin/:machineId/logs', ({ res, params, query, session }) => {
        const check = requireAdminAccess(params.machineId, session);
        if (!check.allowed) {
            sendError(res, check.errorStatus!, check.errorMessage!);
            return;
        }

        const olderThan = query.olderThan || 'all';
        const now = Date.now();
        let cutoffMs: number | null = null;
        if (olderThan === '1h') cutoffMs = now - 60 * 60 * 1000;
        else if (olderThan === '12h') cutoffMs = now - 12 * 60 * 60 * 1000;
        else if (olderThan === '1d') cutoffMs = now - 24 * 60 * 60 * 1000;
        else if (olderThan === '1w') cutoffMs = now - 7 * 24 * 60 * 60 * 1000;
        else if (olderThan === '1m') cutoffMs = now - 30 * 24 * 60 * 60 * 1000;

        const db = getDatabase();
        let deleted: number;
        if (cutoffMs !== null) {
            const info = db
                .prepare(
                    'DELETE FROM auto_operations WHERE machine_identifier = ? AND created_at < ?'
                )
                .run(params.machineId, cutoffMs);
            deleted = Number(info.changes);
        } else {
            const info = db
                .prepare('DELETE FROM auto_operations WHERE machine_identifier = ?')
                .run(params.machineId);
            deleted = Number(info.changes);
        }

        db.prepare(
            'DELETE FROM auto_operation_episodes WHERE operation_id NOT IN (SELECT id FROM auto_operations)'
        ).run();

        sendJson(res, 200, { ok: true, deleted });
    });

    /**
     * POST /api/admin/:machineId/catch-up-scan
     * Manually triggers an episode catch-up scan across TV libraries for the last 24 hours.
     */
    router.post('/api/admin/:machineId/catch-up-scan', async ({ res, params, session }) => {
        const check = requireAdminAccess(params.machineId, session);
        if (!check.allowed) {
            sendError(res, check.errorStatus!, check.errorMessage!);
            return;
        }

        const srv = getMonitoredServer(params.machineId);
        if (!srv) {
            sendError(res, 404, 'Monitored server not found');
            return;
        }

        let ownerToken: string;
        try {
            ownerToken = decryptToken(srv.encrypted_owner_token);
        } catch {
            sendError(res, 500, 'Stored owner token could not be decrypted');
            return;
        }

        const effectiveUrl = srv.custom_url_override?.trim() || srv.server_url;
        const lookbackStartMs = Date.now() - 24 * 60 * 60 * 1000;

        try {
            recordDiagnosticEvent(
                'API',
                'Manual episode catch-up scan triggered from Admin Settings',
                undefined,
                params.machineId
            );
            const result = await catchUpMissedEpisodesSince(
                params.machineId,
                effectiveUrl,
                ownerToken,
                lookbackStartMs
            );
            sendJson(res, 200, {
                ok: true,
                scannedCount: result.scannedCount,
                processedCount: result.processedCount,
            });
        } catch (err) {
            sendError(
                res,
                500,
                err instanceof Error ? err.message : 'Failed to run catch-up scan'
            );
        }
    });

    /**
     * GET /api/admin/:machineId/diagnostics
     * Exports a sanitized JSON diagnostic report (config, anonymized users, rules, recent DB logs, and daemon ring buffer).
     */
    router.get('/api/admin/:machineId/diagnostics', ({ res, params, query, session }) => {
        const check = requireAdminAccess(params.machineId, session);
        if (!check.allowed) {
            sendError(res, check.errorStatus!, check.errorMessage!);
            return;
        }

        const srv = getMonitoredServer(params.machineId);
        if (!srv) {
            sendError(res, 404, 'Monitored server not found');
            return;
        }

        const rawWindow = (query.window || '15m').trim().toLowerCase();
        const windowMinutesMap: Record<string, number> = {
            '5m': 5,
            '15m': 15,
            '60m': 60,
        };
        const windowMinutes = windowMinutesMap[rawWindow];
        const sinceMs =
            typeof windowMinutes === 'number'
                ? Date.now() - windowMinutes * 60 * 1000
                : undefined;

        const db = getDatabase();
        const users = getServerUsers(params.machineId);

        // Anonymize user map so no usernames or emails are leaked in diagnostic exports
        const userRefMap = new Map<number, string>();
        const usersSummary = users.map((u, idx) => {
            const ref = `User#${idx + 1}`;
            userRefMap.set(u.plexUserId, ref);
            return {
                userRef: ref,
                isServerOwner: u.isServerOwner,
                isHomeUser: u.isHomeUser,
                isProtected: u.isProtected,
                isPastaAdmin: u.isPastaAdmin,
            };
        });

        const rules = db
            .prepare(
                'SELECT scope_type, target_key, target_title, parent_key, policy, updated_at FROM automation_rules WHERE machine_identifier = ? ORDER BY id ASC'
            )
            .all(params.machineId);

        const rawAutoOps = (
            typeof sinceMs === 'number'
                ? db
                      .prepare(
                          `SELECT id, plex_user_id, trigger_type, show_title, reference_episode_label, audio_summary, subtitle_summary, updated_count, skipped_count, created_at
                           FROM auto_operations
                           WHERE machine_identifier = ? AND created_at >= ?
                           ORDER BY created_at DESC
                           LIMIT 25`
                      )
                      .all(params.machineId, sinceMs)
                : db
                      .prepare(
                          `SELECT id, plex_user_id, trigger_type, show_title, reference_episode_label, audio_summary, subtitle_summary, updated_count, skipped_count, created_at
                           FROM auto_operations
                           WHERE machine_identifier = ?
                           ORDER BY created_at DESC
                           LIMIT 25`
                      )
                      .all(params.machineId)
        ) as Array<{
            id: number;
            plex_user_id: number;
            trigger_type: string;
            show_title: string;
            reference_episode_label: string;
            audio_summary: string | null;
            subtitle_summary: string | null;
            updated_count: number;
            skipped_count: number;
            created_at: number;
        }>;

        const episodeStmt = db.prepare(
            `SELECT episode_label, change_applied, match_reason, was_updated
             FROM auto_operation_episodes
             WHERE operation_id = ?
             ORDER BY id ASC`
        );

        const recentAutoOperations = rawAutoOps.map(op => ({
            id: op.id,
            userRef:
                op.plex_user_id === 0
                    ? 'Scanner'
                    : userRefMap.get(op.plex_user_id) || 'User',
            triggerType: op.trigger_type,
            showTitle: op.show_title,
            referenceEpisode: op.reference_episode_label,
            audioSummary: op.audio_summary,
            subtitleSummary: op.subtitle_summary,
            updatedCount: op.updated_count,
            skippedCount: op.skipped_count,
            createdAt: new Date(op.created_at).toISOString(),
            episodes: episodeStmt.all(op.id),
        }));

        const rawManualBatches = (
            typeof sinceMs === 'number'
                ? db
                      .prepare(
                          `SELECT id, initiated_by_user_id, target_users_mode, scope, target_title, stream_type, selected_stream_name, updated_count, skipped_count, duration_ms, created_at
                           FROM manual_batch_logs
                           WHERE machine_identifier = ? AND created_at >= ?
                           ORDER BY created_at DESC
                           LIMIT 20`
                      )
                      .all(params.machineId, sinceMs)
                : db
                      .prepare(
                          `SELECT id, initiated_by_user_id, target_users_mode, scope, target_title, stream_type, selected_stream_name, updated_count, skipped_count, duration_ms, created_at
                           FROM manual_batch_logs
                           WHERE machine_identifier = ?
                           ORDER BY created_at DESC
                           LIMIT 20`
                      )
                      .all(params.machineId)
        ) as Array<{
            id: number;
            initiated_by_user_id: number;
            target_users_mode: string;
            scope: string;
            target_title: string;
            stream_type: string;
            selected_stream_name: string;
            updated_count: number;
            skipped_count: number;
            duration_ms: number;
            created_at: number;
        }>;

        const recentManualBatches = rawManualBatches.map(b => ({
            id: b.id,
            initiatedBy: userRefMap.get(b.initiated_by_user_id) || 'User',
            targetUsersMode: b.target_users_mode,
            scope: b.scope,
            targetTitle: b.target_title,
            streamType: b.stream_type,
            selectedStreamName: b.selected_stream_name,
            updatedCount: b.updated_count,
            skippedCount: b.skipped_count,
            durationMs: b.duration_ms,
            createdAt: new Date(b.created_at).toISOString(),
        }));

        const episodePartsCount = (
            db
                .prepare(
                    'SELECT COUNT(*) as cnt FROM episode_parts WHERE machine_identifier = ?'
                )
                .get(params.machineId) as { cnt: number }
        ).cnt;

        const baselinesCount = (
            db
                .prepare(
                    'SELECT COUNT(*) as cnt FROM episode_baselines WHERE machine_identifier = ?'
                )
                .get(params.machineId) as { cnt: number }
        ).cnt;

        const report = {
            exportedAt: new Date().toISOString(),
            timeWindow: typeof windowMinutes === 'number' ? `${windowMinutes}m` : 'all',
            environment: {
                nodeVersion: process.version,
                platform: process.platform,
                arch: process.arch,
                uptimeSeconds: Math.round(process.uptime()),
                pastaMode: process.env.PASTA_MODE || 'server',
                debugLoggingEnabled: isDebugLoggingEnabled(),
                debugForcedByEnv: isDebugForcedByEnv(),
                uiDebugLoggingEnabled: isUiDebugLoggingEnabled(),
                diagnosticBufferStats: getDiagnosticBufferStats(),
            },
            serverConfig: {
                machineIdPrefix: `${srv.machine_identifier.slice(0, 8)}...`,
                authStatus: srv.auth_status,
                hasCustomUrlOverride: Boolean(srv.custom_url_override?.trim()),
                lastEventAt:
                    srv.last_event_timestamp > 0
                        ? new Date(srv.last_event_timestamp).toISOString()
                        : null,
                isMonitoringEnabled: Boolean(srv.is_monitoring_enabled),
                debounceSeconds: srv.debounce_seconds,
                updateLevel: srv.update_level,
                updateStrategy: srv.update_strategy,
                autoForcedSubtitles: Boolean(srv.auto_forced_subtitles),
                triggerOnPlay: Boolean(srv.trigger_on_play),
                triggerOnScan: Boolean(srv.trigger_on_scan),
                triggerOnActivity: Boolean(srv.trigger_on_activity),
                retentionDays: srv.retention_days,
                seededEpisodePartsCount: episodePartsCount,
                trackedEpisodeBaselinesCount: baselinesCount,
            },
            usersSummary,
            automationRules: rules,
            recentAutoOperations,
            recentManualBatches,
            diagnosticEventBuffer: getDiagnosticEvents(undefined, sinceMs),
        };

        sendJson(res, 200, report);
    });
};
