import { formatStreamName } from '../../../src/shared/smartMatch.ts';
import type {
    DetailedProgressState,
    QueuedBatchJobSummary,
} from '../../../src/shared/types/batchTypes.ts';
import type {
    PlexLibrary,
    PlexMetadata,
    PlexStream,
} from '../../../src/shared/types/plex.ts';
import {
    broadcastSseEventPerClient,
    canUserViewBatchJob,
} from '../api/sse.ts';
import {
    executeServerBatchUpdate,
    type TargetUserCredential,
} from '../plex/updater.ts';

export type BatchJobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'ERROR';

export interface StartManualBatchParams {
    machineIdentifier: string;
    serverUrl: string;
    clientIdentifier: string;
    initiatedByUserId: number;
    initiatedByUsername: string;
    primaryFetchToken: string;
    scope: 'season' | 'show' | 'collection' | 'library';
    targetItem: PlexMetadata | PlexLibrary;
    targetStream: PlexStream | null;
    type: 'audio' | 'subtitle';
    keyword?: string;
    targets: TargetUserCredential[];
    targetUsersMode: 'single' | 'all' | 'specific';
    targetUsersSummary: string;
}

export interface ActiveBatchJob {
    jobId: string;
    machineIdentifier: string;
    initiatedByUserId: number;
    initiatedByUsername: string;
    scope: 'season' | 'show' | 'collection' | 'library';
    targetTitle: string;
    targetRatingKey: string;
    showRatingKey: string | null;
    librarySectionKey: string | null;
    streamType: 'audio' | 'subtitle';
    streamName: string;
    targetUsersSummary: string;
    status: BatchJobStatus;
    progress: DetailedProgressState;
    abortController: AbortController;
    runParams: StartManualBatchParams;
    createdAt: number;
    updatedAt: number;
    dismissed: boolean;
}

const jobs = new Map<string, ActiveBatchJob>();
let jobCounter = 0;

// Hook registered by eventBuffer to cancel any pending debounce timer when superseded by a manual batch
let cancelPendingDebounceHook:
    | ((machineIdentifier: string, showRatingKey?: string) => void)
    | null = null;

export const registerDebounceSupersedeHook = (
    fn: (machineIdentifier: string, showRatingKey?: string) => void
): void => {
    cancelPendingDebounceHook = fn;
};

const extractTargetKeys = (
    scope: 'season' | 'show' | 'collection' | 'library',
    targetItem: PlexMetadata | PlexLibrary
): {
    targetRatingKey: string;
    showRatingKey: string | null;
    librarySectionKey: string | null;
} => {
    if (scope === 'library') {
        const lib = targetItem as PlexLibrary;
        return {
            targetRatingKey: String(lib.key),
            showRatingKey: null,
            librarySectionKey: String(lib.key),
        };
    }

    const meta = targetItem as PlexMetadata;
    const rawLibId = meta.librarySectionID ?? meta.librarySectionKey;
    const librarySectionKey = rawLibId
        ? String(rawLibId).replace(/^\/library\/sections\//, '')
        : null;
    const showRatingKey =
        scope === 'show'
            ? String(meta.ratingKey)
            : scope === 'season' && meta.parentRatingKey
              ? String(meta.parentRatingKey)
              : null;

    return {
        targetRatingKey: String(meta.ratingKey),
        showRatingKey,
        librarySectionKey,
    };
};

/**
 * Checks whether there is already a RUNNING or QUEUED batch job on this server
 * that overlaps with the requested target AND shares at least one target user.
 */
export const checkBatchTargetConflict = (
    machineIdentifier: string,
    scope: 'season' | 'show' | 'collection' | 'library',
    targetItem: PlexMetadata | PlexLibrary,
    incomingTargetUserIds: number[]
): ActiveBatchJob | null => {
    const incoming = extractTargetKeys(scope, targetItem);
    const incomingUserSet = new Set(incomingTargetUserIds);

    for (const existing of jobs.values()) {
        if (existing.machineIdentifier !== machineIdentifier) continue;
        if (existing.status !== 'RUNNING' && existing.status !== 'QUEUED') continue;

        // Lockout is per target user: only conflict if at least one target user overlaps
        const hasOverlappingUser = existing.runParams.targets.some(t =>
            incomingUserSet.has(t.plexUserId)
        );
        if (!hasOverlappingUser) continue;

        // 1. Exact same scope & ratingKey/key
        if (existing.scope === scope && existing.targetRatingKey === incoming.targetRatingKey) {
            return existing;
        }

        // 2. Same TV Show (e.g. Show vs Season of that Show, or Season vs Show)
        if (
            existing.showRatingKey &&
            incoming.showRatingKey &&
            existing.showRatingKey === incoming.showRatingKey
        ) {
            // If both are seasons of the same show, only conflict if they are the same season (handled above).
            // If at least one is the entire show, they overlap!
            if (existing.scope === 'show' || scope === 'show') {
                return existing;
            }
        }

        // 3. Library-wide batch overlaps with any item inside that library
        if (
            (existing.scope === 'library' || scope === 'library') &&
            existing.librarySectionKey &&
            incoming.librarySectionKey &&
            existing.librarySectionKey === incoming.librarySectionKey
        ) {
            return existing;
        }
    }

    return null;
};

const getQueuedJobSummariesForServer = (
    machineIdentifier: string,
    viewerPlexUserId?: number,
    excludeJobId?: string
): QueuedBatchJobSummary[] => {
    return Array.from(jobs.values())
        .filter(
            j =>
                j.machineIdentifier === machineIdentifier &&
                j.status === 'QUEUED' &&
                !j.dismissed &&
                j.jobId !== excludeJobId &&
                (viewerPlexUserId === undefined ||
                    canUserViewBatchJob(
                        j.machineIdentifier,
                        j.initiatedByUserId,
                        viewerPlexUserId
                    ))
        )
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(j => ({
            jobId: j.jobId,
            scope: j.scope,
            targetTitle: j.targetTitle,
            streamType: j.streamType,
            streamName: j.streamName,
            targetUsersSummary: j.targetUsersSummary,
            initiatedByUsername: j.initiatedByUsername,
        }));
};

const buildJobViewForUser = (
    job: ActiveBatchJob,
    viewerPlexUserId: number
): ActiveBatchJob => {
    return {
        ...job,
        progress: {
            ...job.progress,
            queuedJobs: getQueuedJobSummariesForServer(
                job.machineIdentifier,
                viewerPlexUserId,
                job.jobId
            ),
        },
    };
};

export const getVisibleActiveJobForUser = (
    viewerPlexUserId: number,
    machineIdentifier?: string | null
): ActiveBatchJob | null => {
    const candidates = Array.from(jobs.values())
        .filter(j => {
            if (j.dismissed) return false;
            if (machineIdentifier && j.machineIdentifier !== machineIdentifier) return false;
            return canUserViewBatchJob(
                j.machineIdentifier,
                j.initiatedByUserId,
                viewerPlexUserId
            );
        })
        .sort((a, b) => {
            const rank = (status: BatchJobStatus): number => {
                if (status === 'RUNNING') return 0;
                if (status === 'QUEUED') return 1;
                return 2;
            };
            const rA = rank(a.status);
            const rB = rank(b.status);
            if (rA !== rB) return rA - rB;
            if (a.status === 'QUEUED' && b.status === 'QUEUED') {
                return a.createdAt - b.createdAt;
            }
            return b.updatedAt - a.updatedAt;
        });

    const chosen = candidates[0] || null;
    if (!chosen) return null;
    return buildJobViewForUser(chosen, viewerPlexUserId);
};

const broadcastServerQueueState = (
    machineIdentifier: string,
    dismissedFallbackJob?: ActiveBatchJob
): void => {
    broadcastSseEventPerClient('batch_progress', client => {
        const visibleJob = getVisibleActiveJobForUser(
            client.plexUserId,
            machineIdentifier
        );
        if (visibleJob) {
            return {
                jobId: visibleJob.jobId,
                machineIdentifier: visibleJob.machineIdentifier,
                initiatedByUserId: visibleJob.initiatedByUserId,
                initiatedByUsername: visibleJob.initiatedByUsername,
                scope: visibleJob.scope,
                targetTitle: visibleJob.targetTitle,
                progress: visibleJob.progress,
                dismissed: false,
            };
        }
        if (
            dismissedFallbackJob &&
            canUserViewBatchJob(
                machineIdentifier,
                dismissedFallbackJob.initiatedByUserId,
                client.plexUserId
            )
        ) {
            return {
                jobId: dismissedFallbackJob.jobId,
                machineIdentifier: dismissedFallbackJob.machineIdentifier,
                initiatedByUserId: dismissedFallbackJob.initiatedByUserId,
                initiatedByUsername: dismissedFallbackJob.initiatedByUsername,
                scope: dismissedFallbackJob.scope,
                targetTitle: dismissedFallbackJob.targetTitle,
                progress: dismissedFallbackJob.progress,
                dismissed: true,
            };
        }
        return null;
    });
};

const getRunningJobForServer = (machineIdentifier: string): ActiveBatchJob | null => {
    for (const j of jobs.values()) {
        if (j.machineIdentifier === machineIdentifier && j.status === 'RUNNING') {
            return j;
        }
    }
    return null;
};

const getNextQueuedJobForServer = (machineIdentifier: string): ActiveBatchJob | null => {
    const queued = Array.from(jobs.values())
        .filter(j => j.machineIdentifier === machineIdentifier && j.status === 'QUEUED' && !j.dismissed)
        .sort((a, b) => a.createdAt - b.createdAt);
    return queued[0] || null;
};

const runJobNow = (job: ActiveBatchJob, dismissedPreviousJob?: ActiveBatchJob): void => {
    job.status = 'RUNNING';
    job.progress = {
        ...job.progress,
        isProcessing: true,
        statusMessage: `Starting ${job.scope} update for "${job.targetTitle}"...`,
    };
    job.updatedAt = Date.now();
    broadcastServerQueueState(job.machineIdentifier, dismissedPreviousJob);

    const params = job.runParams;
    void executeServerBatchUpdate({
        jobId: job.jobId,
        machineIdentifier: params.machineIdentifier,
        serverUrl: params.serverUrl,
        clientIdentifier: params.clientIdentifier,
        initiatedByUserId: params.initiatedByUserId,
        initiatedByUsername: params.initiatedByUsername,
        primaryFetchToken: params.primaryFetchToken,
        scope: params.scope,
        targetItem: params.targetItem,
        targetStream: params.targetStream,
        type: params.type,
        keyword: params.keyword,
        targets: params.targets,
        targetUsersMode: params.targetUsersMode,
        targetUsersSummary: params.targetUsersSummary,
        signal: job.abortController.signal,
        onProgress: state => {
            job.progress = state;
            job.updatedAt = Date.now();
            broadcastServerQueueState(job.machineIdentifier);
        },
    })
        .then(() => {
            const wasCancelled = job.abortController.signal.aborted;
            job.status = wasCancelled ? 'CANCELLED' : 'COMPLETED';
            if (wasCancelled) {
                job.dismissed = true;
            }
            job.updatedAt = Date.now();
        })
        .catch(err => {
            job.status = 'ERROR';
            job.progress = {
                ...job.progress,
                isProcessing: false,
                statusMessage: `Error: ${err instanceof Error ? err.message : 'Batch failed'}`,
            };
            job.updatedAt = Date.now();
            broadcastServerQueueState(job.machineIdentifier);
        })
        .finally(() => {
            const nextJob = getNextQueuedJobForServer(job.machineIdentifier);
            if (nextJob) {
                // Auto-dismiss the finished job so the UI transitions cleanly to the next queued job
                job.dismissed = true;
                runJobNow(nextJob, job);
            } else {
                broadcastServerQueueState(job.machineIdentifier, job.dismissed ? job : undefined);
            }
        });
};

export const startManualBatchJob = (params: StartManualBatchParams): ActiveBatchJob => {
    const jobId = `batch-${++jobCounter}-${Date.now()}`;
    const abortController = new AbortController();
    const targetTitle =
        params.scope === 'season' &&
        'parentTitle' in params.targetItem &&
        params.targetItem.parentTitle
            ? `${params.targetItem.parentTitle} - ${params.targetItem.title}`
            : params.targetItem.title || 'Batch Update';

    const { targetRatingKey, showRatingKey, librarySectionKey } = extractTargetKeys(
        params.scope,
        params.targetItem
    );

    // Supersede any pending 30s background debounce timer for this show/server
    if (cancelPendingDebounceHook) {
        cancelPendingDebounceHook(params.machineIdentifier, showRatingKey || undefined);
    }

    const streamName = params.targetStream ? formatStreamName(params.targetStream) : 'None';
    const currentlyRunning = getRunningJobForServer(params.machineIdentifier);

    const initialProgress: DetailedProgressState = {
        jobId,
        total: 0,
        current: 0,
        success: 0,
        failed: 0,
        isProcessing: true,
        statusMessage: currentlyRunning
            ? `Queued - waiting for current batch job to finish...`
            : `Starting ${params.scope} update for "${targetTitle}"...`,
        results: [],
        targetUsersSummary: params.targetUsersSummary,
        queuedJobs: [],
    };

    const job: ActiveBatchJob = {
        jobId,
        machineIdentifier: params.machineIdentifier,
        initiatedByUserId: params.initiatedByUserId,
        initiatedByUsername: params.initiatedByUsername,
        scope: params.scope,
        targetTitle,
        targetRatingKey,
        showRatingKey,
        librarySectionKey,
        streamType: params.type,
        streamName,
        targetUsersSummary: params.targetUsersSummary,
        status: 'QUEUED',
        progress: initialProgress,
        abortController,
        runParams: params,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        dismissed: false,
    };

    jobs.set(jobId, job);

    // Dismiss any previously completed jobs visible to this initiator when they start a new job
    for (const existing of jobs.values()) {
        if (
            existing.machineIdentifier === params.machineIdentifier &&
            existing.jobId !== jobId &&
            existing.status !== 'QUEUED' &&
            existing.status !== 'RUNNING'
        ) {
            existing.dismissed = true;
        }
    }

    if (!currentlyRunning) {
        runJobNow(job);
    } else {
        // Another job is already running on this server: keep `job` in QUEUED state
        // and broadcast each viewer's updated queue state!
        broadcastServerQueueState(params.machineIdentifier);
    }

    return getVisibleActiveJobForUser(params.initiatedByUserId, params.machineIdentifier) || job;
};

export const cancelBatchJobById = (
    jobId: string,
    viewerPrimaryUserId: number
): boolean => {
    const job = jobs.get(jobId);
    if (!job) return false;
    if (
        !canUserViewBatchJob(
            job.machineIdentifier,
            job.initiatedByUserId,
            viewerPrimaryUserId
        )
    ) {
        return false;
    }

    if (job.status === 'QUEUED') {
        job.status = 'CANCELLED';
        job.dismissed = true;
        job.updatedAt = Date.now();
        broadcastServerQueueState(job.machineIdentifier, job);
        return true;
    }

    job.abortController.abort();
    return true;
};

export const dismissBatchJobById = (
    jobId: string,
    viewerPrimaryUserId: number
): boolean => {
    const job = jobs.get(jobId);
    if (!job) return false;
    if (
        !canUserViewBatchJob(
            job.machineIdentifier,
            job.initiatedByUserId,
            viewerPrimaryUserId
        )
    ) {
        return false;
    }
    job.dismissed = true;
    broadcastServerQueueState(job.machineIdentifier, job);
    return true;
};
