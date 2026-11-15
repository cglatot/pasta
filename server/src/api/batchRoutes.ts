import type { TargetUsersSelection } from '../../../src/shared/types/batchTypes.ts';
import type {
    PlexLibrary,
    PlexMetadata,
    PlexStream,
} from '../../../src/shared/types/plex.ts';
import {
    cancelBatchJobById,
    checkBatchTargetConflict,
    dismissBatchJobById,
    getVisibleActiveJobForUser,
    startManualBatchJob,
} from '../daemon/queueManager.ts';
import { updatePmsStream } from '../plex/client.ts';
import {
    executeServerSingleEpisodeUpdate,
    resolveTargetUsersForUpdate,
    upsertEpisodeBaseline,
} from '../plex/updater.ts';
import { getUserRoleForServer } from '../plex/userManager.ts';
import { getDatabase } from '../storage/db.ts';
import { type ApiRouter, sendError, sendJson } from './httpServer.ts';
import {
    resolveEffectiveServerUrl,
    resolveEffectiveUserToken,
} from './serverRoutes.ts';

export const registerBatchRoutes = (router: ApiRouter): void => {
    /**
     * POST /api/batch/single
     * Direct part stream update + immediate SQLite baseline update.
     */
    router.post('/api/batch/single', async ({ res, body, session }) => {
        if (!session) {
            sendError(res, 401, 'Not authenticated');
            return;
        }

        const payload = (body || {}) as {
            machineIdentifier?: string;
            episodeRatingKey?: string;
            partId?: number;
            streamId?: number;
            streamType?: 'audio' | 'subtitle';
            clientIdentifier?: string;
        };

        const machineId = payload.machineIdentifier || session.activeMachineId;
        if (!machineId || payload.partId === undefined || payload.streamId === undefined || !payload.streamType) {
            sendError(res, 400, 'machineIdentifier, partId, streamId, and streamType are required');
            return;
        }

        const serverUrl = resolveEffectiveServerUrl(machineId, session);
        if (!serverUrl) {
            sendError(res, 400, 'Could not resolve server URL');
            return;
        }

        const token = resolveEffectiveUserToken(machineId, session);
        const clientIdentifier = payload.clientIdentifier || 'PASTA-Server';

        await updatePmsStream(
            serverUrl,
            payload.partId,
            payload.streamId,
            payload.streamType,
            clientIdentifier,
            token
        );

        if (payload.episodeRatingKey) {
            upsertEpisodeBaseline(
                machineId,
                session.plexUserId,
                payload.episodeRatingKey,
                payload.streamType,
                payload.streamId
            );
        }

        sendJson(res, 200, { ok: true });
    });

    /**
     * POST /api/batch/single-episode
     * Executes a single episode/movie update on the server (supporting multi-version Media[]/Part[] and Target Users).
     */
    router.post('/api/batch/single-episode', async ({ res, body, session }) => {
        if (!session) {
            sendError(res, 401, 'Not authenticated');
            return;
        }

        const payload = (body || {}) as {
            machineIdentifier?: string;
            clientIdentifier?: string;
            episode?: PlexMetadata;
            targetStream?: PlexStream | null;
            type?: 'audio' | 'subtitle';
            keyword?: string;
            exactMatch?: boolean;
            targetUsers?: TargetUsersSelection;
        };

        const machineId = payload.machineIdentifier || session.activeMachineId;
        if (!machineId || !payload.episode || !payload.type) {
            sendError(res, 400, 'machineIdentifier, episode, and type are required');
            return;
        }

        const serverUrl = resolveEffectiveServerUrl(machineId, session);
        if (!serverUrl) {
            sendError(res, 400, 'Could not resolve server URL');
            return;
        }

        const activeToken = resolveEffectiveUserToken(machineId, session);
        const { targets } = resolveTargetUsersForUpdate({
            machineIdentifier: machineId,
            callerPrimaryUserId: session.plexUserId,
            activeUserId: session.plexUserId,
            activeUsername: session.title || session.username,
            activeToken,
            targetUsers: payload.targetUsers,
        });

        const result = await executeServerSingleEpisodeUpdate({
            machineIdentifier: machineId,
            serverUrl,
            clientIdentifier: payload.clientIdentifier || 'PASTA-Server',
            episode: payload.episode,
            targetStream: payload.targetStream ?? null,
            type: payload.type,
            keyword: payload.keyword,
            exactMatch: Boolean(payload.exactMatch),
            targets,
        });

        sendJson(res, 200, result);
    });

    /**
     * POST /api/batch
     * Starts a manual batch job (Season, Show, Collection, Library) on the server with 0ms delay.
     */
    router.post('/api/batch', ({ res, body, session }) => {
        if (!session) {
            sendError(res, 401, 'Not authenticated');
            return;
        }

        const payload = (body || {}) as {
            machineIdentifier?: string;
            clientIdentifier?: string;
            scope?: 'season' | 'show' | 'collection' | 'library';
            targetItem?: PlexMetadata | PlexLibrary;
            targetStream?: PlexStream | null;
            type?: 'audio' | 'subtitle';
            keyword?: string;
            targetUsers?: TargetUsersSelection;
        };

        const machineId = payload.machineIdentifier || session.activeMachineId;
        if (!machineId || !payload.scope || !payload.targetItem || !payload.type) {
            sendError(res, 400, 'machineIdentifier, scope, targetItem, and type are required');
            return;
        }

        const serverUrl = resolveEffectiveServerUrl(machineId, session);
        if (!serverUrl) {
            sendError(res, 400, 'Could not resolve server URL');
            return;
        }

        const activeToken = resolveEffectiveUserToken(machineId, session);
        const { targets, mode, summaryLabel } = resolveTargetUsersForUpdate({
            machineIdentifier: machineId,
            callerPrimaryUserId: session.plexUserId,
            activeUserId: session.plexUserId,
            activeUsername: session.title || session.username,
            activeToken,
            targetUsers: payload.targetUsers,
        });

        const conflictJob = checkBatchTargetConflict(
            machineId,
            payload.scope,
            payload.targetItem,
            targets.map(t => t.plexUserId)
        );
        if (conflictJob) {
            const stateWord =
                conflictJob.status === 'RUNNING' ? 'in progress' : 'queued';
            sendError(
                res,
                409,
                `A batch update for "${conflictJob.targetTitle}" affecting the selected user(s) is already ${stateWord} (initiated by ${conflictJob.initiatedByUsername}). Please wait for it to finish or cancel it first.`
            );
            return;
        }

        const job = startManualBatchJob({
            machineIdentifier: machineId,
            serverUrl,
            clientIdentifier: payload.clientIdentifier || 'PASTA-Server',
            initiatedByUserId: session.plexUserId,
            initiatedByUsername: session.title || session.username,
            primaryFetchToken: activeToken,
            scope: payload.scope,
            targetItem: payload.targetItem,
            targetStream: payload.targetStream ?? null,
            type: payload.type,
            keyword: payload.keyword,
            targets,
            targetUsersMode: mode,
            targetUsersSummary: summaryLabel,
        });

        sendJson(res, 200, {
            jobId: job.jobId,
            targetTitle: job.targetTitle,
            progress: job.progress,
        });
    });

    /**
     * GET /api/batch/active
     * Returns the currently running or most recently completed (un-dismissed) batch job for the user.
     */
    router.get('/api/batch/active', ({ res, query, session }) => {
        if (!session) {
            sendError(res, 401, 'Not authenticated');
            return;
        }

        const machineId = query.machineIdentifier || session.activeMachineId;
        const job = getVisibleActiveJobForUser(session.plexUserId, machineId);
        if (!job) {
            sendJson(res, 200, { activeJob: null });
            return;
        }

        sendJson(res, 200, {
            activeJob: {
                jobId: job.jobId,
                machineIdentifier: job.machineIdentifier,
                initiatedByUserId: job.initiatedByUserId,
                initiatedByUsername: job.initiatedByUsername,
                scope: job.scope,
                targetTitle: job.targetTitle,
                progress: job.progress,
                dismissed: job.dismissed,
            },
        });
    });

    router.post('/api/batch/:jobId/cancel', ({ res, params, session }) => {
        if (!session) {
            sendError(res, 401, 'Not authenticated');
            return;
        }
        const ok = cancelBatchJobById(params.jobId, session.plexUserId);
        sendJson(res, 200, { ok });
    });

    router.post('/api/batch/:jobId/dismiss', ({ res, params, session }) => {
        if (!session) {
            sendError(res, 401, 'Not authenticated');
            return;
        }
        const ok = dismissBatchJobById(params.jobId, session.plexUserId);
        sendJson(res, 200, { ok });
    });

    /**
     * GET /api/batch/history
     * Role-scoped Manual Batch Logs:
     * - Standard Users: Strictly self-initiated runs only.
     * - Owners / Delegated PASTA Admins: All runs on the server + optional Initiated By / Applied To / Scope filters.
     */
    router.get('/api/batch/history', ({ res, query, session }) => {
        if (!session) {
            sendError(res, 401, 'Not authenticated');
            return;
        }

        const machineId = query.machineIdentifier || session.activeMachineId;
        if (!machineId) {
            sendJson(res, 200, { logs: [], isAdmin: false });
            return;
        }

        const role = getUserRoleForServer(machineId, session.plexUserId);
        const isAdmin = role === 'owner' || role === 'admin';
        const limit = Math.min(200, Math.max(1, Number.parseInt(query.limit || '100', 10) || 100));

        const db = getDatabase();
        let rows: Array<{
            id: number;
            machine_identifier: string;
            initiated_by_user_id: number;
            initiated_by_username: string;
            target_users_mode: string;
            target_users_summary: string;
            target_user_ids_json: string;
            scope: string;
            target_title: string;
            stream_type: string;
            selected_stream_name: string;
            updated_count: number;
            skipped_count: number;
            duration_ms: number;
            created_at: number;
        }>;

        if (!isAdmin) {
            rows = db
                .prepare(`
                    SELECT *
                    FROM manual_batch_logs
                    WHERE machine_identifier = ? AND initiated_by_user_id = ?
                    ORDER BY created_at DESC
                    LIMIT ?
                `)
                .all(machineId, session.plexUserId, limit) as typeof rows;
        } else {
            rows = db
                .prepare(`
                    SELECT *
                    FROM manual_batch_logs
                    WHERE machine_identifier = ?
                    ORDER BY created_at DESC
                    LIMIT ?
                `)
                .all(machineId, limit) as typeof rows;

            // Optional Admin Filters
            if (query.initiatedBy && query.initiatedBy !== 'all') {
                const initId = Number.parseInt(query.initiatedBy, 10);
                if (!Number.isNaN(initId)) {
                    rows = rows.filter(r => r.initiated_by_user_id === initId);
                }
            }
            if (query.appliedTo && query.appliedTo !== 'any') {
                if (query.appliedTo === 'all') {
                    rows = rows.filter(r => r.target_users_mode === 'all');
                } else {
                    const targetId = Number.parseInt(query.appliedTo, 10);
                    if (!Number.isNaN(targetId)) {
                        rows = rows.filter(r => {
                            try {
                                const ids = JSON.parse(r.target_user_ids_json) as number[];
                                return Array.isArray(ids) && ids.includes(targetId);
                            } catch {
                                return false;
                            }
                        });
                    }
                }
            }
            if (query.scope && query.scope !== 'all') {
                rows = rows.filter(r => r.scope.toLowerCase() === query.scope.toLowerCase());
            }
        }

        sendJson(res, 200, {
            logs: rows,
            isAdmin,
        });
    });

    /**
     * DELETE /api/batch/history
     * Strictly Admin-only: Clears manual batch logs for a server (`?machineIdentifier=...&olderThan=all|1h|12h|1d|1w|1m`).
     */
    router.delete('/api/batch/history', ({ res, query, session }) => {
        if (!session) {
            sendError(res, 401, 'Not authenticated');
            return;
        }

        const machineId = query.machineIdentifier || session.activeMachineId;
        if (!machineId) {
            sendError(res, 400, 'machineIdentifier is required');
            return;
        }

        const role = getUserRoleForServer(machineId, session.plexUserId);
        if (role !== 'owner' && role !== 'admin') {
            sendError(res, 403, 'Admin privileges required to clear manual batch logs');
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
                    'DELETE FROM manual_batch_logs WHERE machine_identifier = ? AND created_at < ?'
                )
                .run(machineId, cutoffMs);
            deleted = Number(info.changes);
        } else {
            const info = db
                .prepare('DELETE FROM manual_batch_logs WHERE machine_identifier = ?')
                .run(machineId);
            deleted = Number(info.changes);
        }

        sendJson(res, 200, { ok: true, deleted });
    });
};
