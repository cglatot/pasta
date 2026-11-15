import {
    formatStreamName,
    resolveEpisodePartUpdates,
} from '../../../src/shared/smartMatch.ts';
import type {
    DetailedProgressState,
    EpisodeResult,
    TargetUsersSelection,
} from '../../../src/shared/types/batchTypes.ts';
import type {
    PlexLibrary,
    PlexMetadata,
    PlexStream,
} from '../../../src/shared/types/plex.ts';
import { getDatabase } from '../storage/db.ts';
import {
    getPmsCollectionChildren,
    getPmsLibraryItemsPaginated,
    getPmsMetadata,
    getPmsMetadataChildren,
    updatePmsStream,
} from './client.ts';
import {
    getAllUserTokensForServer,
    getUserRoleForServer,
} from './userManager.ts';

export interface TargetUserCredential {
    plexUserId: number;
    username: string;
    token: string;
}

/**
 * Updates `episode_baselines` in SQLite immediately whenever PASTA updates a stream
 * so the background WebSocket stateDiffCache knows the change came from PASTA and never double-triggers.
 */
export const upsertEpisodeBaseline = (
    machineIdentifier: string,
    plexUserId: number,
    episodeRatingKey: string,
    streamType: 'audio' | 'subtitle',
    streamId: number,
    episode?: PlexMetadata
): void => {
    const db = getDatabase();
    const existing = db
        .prepare(
            'SELECT audio_stream_id, subtitle_stream_id FROM episode_baselines WHERE machine_identifier = ? AND plex_user_id = ? AND episode_rating_key = ?'
        )
        .get(machineIdentifier, plexUserId, episodeRatingKey) as
        | { audio_stream_id: number; subtitle_stream_id: number }
        | undefined;

    const epStreams = episode?.Media?.[0]?.Part?.[0]?.Stream;
    const fallbackAudioId =
        epStreams?.find(s => s.streamType === 2 && s.selected)?.id ?? 0;
    const fallbackSubId =
        epStreams?.find(s => s.streamType === 3 && s.selected)?.id ?? 0;

    const audioId =
        streamType === 'audio'
            ? streamId
            : existing?.audio_stream_id && existing.audio_stream_id > 0
              ? existing.audio_stream_id
              : fallbackAudioId;
    const subId =
        streamType === 'subtitle'
            ? streamId
            : existing !== undefined
              ? existing.subtitle_stream_id
              : fallbackSubId;

    db.prepare(`
        INSERT INTO episode_baselines (
            machine_identifier, plex_user_id, episode_rating_key, audio_stream_id, subtitle_stream_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(machine_identifier, plex_user_id, episode_rating_key) DO UPDATE SET
            audio_stream_id = excluded.audio_stream_id,
            subtitle_stream_id = excluded.subtitle_stream_id,
            updated_at = excluded.updated_at
    `).run(machineIdentifier, plexUserId, episodeRatingKey, audioId, subId, Date.now());
};

export const getEpisodeBaseline = (
    machineIdentifier: string,
    plexUserId: number,
    episodeRatingKey: string
): { audio_stream_id: number; subtitle_stream_id: number } | undefined => {
    const db = getDatabase();
    return db
        .prepare(
            'SELECT audio_stream_id, subtitle_stream_id FROM episode_baselines WHERE machine_identifier = ? AND plex_user_id = ? AND episode_rating_key = ?'
        )
        .get(machineIdentifier, plexUserId, episodeRatingKey) as
        | { audio_stream_id: number; subtitle_stream_id: number }
        | undefined;
};

/**
 * Resolves the list of target user credentials for a manual single-episode or batch update.
 * Enforces that only Owners and Delegated PASTA Admins can target `all` or `specific` users.
 */
export const resolveTargetUsersForUpdate = (params: {
    machineIdentifier: string;
    callerPrimaryUserId: number;
    activeUserId: number;
    activeUsername: string;
    activeToken: string;
    targetUsers?: TargetUsersSelection;
}): {
    targets: TargetUserCredential[];
    mode: 'single' | 'all' | 'specific';
    summaryLabel: string;
} => {
    const {
        machineIdentifier,
        callerPrimaryUserId,
        activeUserId,
        activeUsername,
        activeToken,
        targetUsers,
    } = params;

    const role = getUserRoleForServer(machineIdentifier, callerPrimaryUserId);
    const isAdminOrOwner = role === 'owner' || role === 'admin';

    if (isAdminOrOwner && targetUsers && targetUsers.mode === 'all') {
        const allTargets = getAllUserTokensForServer(machineIdentifier);
        if (allTargets.length > 0) {
            return {
                targets: allTargets,
                mode: 'all',
                summaryLabel: `All Users (${allTargets.length})`,
            };
        }
    }

    if (
        isAdminOrOwner &&
        targetUsers &&
        targetUsers.mode === 'specific' &&
        Array.isArray(targetUsers.userIds) &&
        targetUsers.userIds.length > 0
    ) {
        const specificTargets = getAllUserTokensForServer(
            machineIdentifier,
            targetUsers.userIds
        );
        if (specificTargets.length > 0) {
            const label =
                specificTargets.length <= 2
                    ? specificTargets.map(t => t.username).join(', ')
                    : `${specificTargets.length} Users (${specificTargets
                          .slice(0, 2)
                          .map(t => t.username)
                          .join(', ')}...)`;
            return {
                targets: specificTargets,
                mode: 'specific',
                summaryLabel: label,
            };
        }
    }

    return {
        targets: [
            {
                plexUserId: activeUserId,
                username: activeUsername,
                token: activeToken,
            },
        ],
        mode: 'single',
        summaryLabel: activeUsername,
    };
};

/**
 * Updates a single episode/movie across all Media[]/Part[] versions and fans out the POST
 * across all resolved target users ("Fetch-Once, Fan-Out-POST").
 */
export const executeServerSingleEpisodeUpdate = async (params: {
    machineIdentifier: string;
    serverUrl: string;
    clientIdentifier: string;
    episode: PlexMetadata;
    targetStream: PlexStream | null;
    type: 'audio' | 'subtitle';
    keyword?: string;
    exactMatch?: boolean;
    targets: TargetUserCredential[];
}): Promise<EpisodeResult> => {
    const {
        machineIdentifier,
        serverUrl,
        clientIdentifier,
        episode,
        targetStream,
        type,
        keyword,
        exactMatch = false,
        targets,
    } = params;

    const episodeTitle = episode.title || 'Unknown Episode';
    const seasonNumber = episode.parentIndex;
    const episodeNumber = episode.index;

    try {
        const resolution = resolveEpisodePartUpdates(episode, targetStream, type, {
            keyword,
            exactMatch,
        });

        if (!resolution.hasStreams || resolution.skipReason === 'Error') {
            return {
                episodeTitle,
                seasonNumber,
                episodeNumber,
                success: false,
                skipReason: 'Error',
                errorMessage: resolution.errorMessage || 'No streams available',
                previousStreamName: resolution.previousStreamName,
            };
        }

        if (resolution.partUpdates.length === 0) {
            return {
                episodeTitle,
                seasonNumber,
                episodeNumber,
                success: false,
                skipReason: resolution.skipReason || 'NoMatch',
                previousStreamName: resolution.previousStreamName,
            };
        }

        // Single-user path: use the episode's own selected flags directly
        if (targets.length === 1) {
            const singleUser = targets[0];
            if (resolution.allAlreadyMatched) {
                upsertEpisodeBaseline(
                    machineIdentifier,
                    singleUser.plexUserId,
                    episode.ratingKey,
                    type,
                    resolution.partUpdates[0].streamId,
                    episode
                );
                return {
                    episodeTitle,
                    seasonNumber,
                    episodeNumber,
                    success: false,
                    skipReason: 'AlreadyMatched',
                    matchReason: resolution.matchReason,
                    streamName: resolution.streamName,
                    previousStreamName: resolution.previousStreamName,
                };
            }

            const partsToUpdate = resolution.partUpdates.filter(u => !u.alreadySelected);
            for (const partUpdate of partsToUpdate) {
                await updatePmsStream(
                    serverUrl,
                    partUpdate.partId,
                    partUpdate.streamId,
                    type,
                    clientIdentifier,
                    singleUser.token
                );
            }

            upsertEpisodeBaseline(
                machineIdentifier,
                singleUser.plexUserId,
                episode.ratingKey,
                type,
                resolution.partUpdates[0].streamId,
                episode
            );

            return {
                episodeTitle,
                seasonNumber,
                episodeNumber,
                success: true,
                matchReason: resolution.matchReason,
                streamName: resolution.streamName,
                previousStreamName: resolution.previousStreamName,
            };
        }

        // Multi-user path ("Fetch-Once, Fan-Out-POST"):
        // Metadata and stream matching were computed ONCE above; now fan out the lightweight POST
        // across each target user's token (skipping users whose baseline already matches).
        let updatedUsersCount = 0;
        const primaryStreamId = resolution.partUpdates[0].streamId;

        await Promise.all(
            targets.map(async userTarget => {
                const baseline = getEpisodeBaseline(
                    machineIdentifier,
                    userTarget.plexUserId,
                    episode.ratingKey
                );
                const baselineStreamId =
                    type === 'audio' ? baseline?.audio_stream_id : baseline?.subtitle_stream_id;

                if (
                    baseline &&
                    baselineStreamId === primaryStreamId &&
                    resolution.partUpdates.length === 1 &&
                    primaryStreamId !== 0
                ) {
                    return;
                }

                for (const partUpdate of resolution.partUpdates) {
                    await updatePmsStream(
                        serverUrl,
                        partUpdate.partId,
                        partUpdate.streamId,
                        type,
                        clientIdentifier,
                        userTarget.token
                    );
                }

                upsertEpisodeBaseline(
                    machineIdentifier,
                    userTarget.plexUserId,
                    episode.ratingKey,
                    type,
                    primaryStreamId,
                    episode
                );
                updatedUsersCount++;
            })
        );

        if (updatedUsersCount === 0) {
            return {
                episodeTitle,
                seasonNumber,
                episodeNumber,
                success: false,
                skipReason: 'AlreadyMatched',
                matchReason: resolution.matchReason,
                streamName: resolution.streamName,
                previousStreamName: resolution.previousStreamName,
                updatedUsersCount: 0,
                totalUsersCount: targets.length,
            };
        }

        return {
            episodeTitle,
            seasonNumber,
            episodeNumber,
            success: true,
            matchReason: resolution.matchReason,
            streamName: resolution.streamName,
            previousStreamName: resolution.previousStreamName,
            updatedUsersCount,
            totalUsersCount: targets.length,
        };
    } catch (err) {
        return {
            episodeTitle,
            seasonNumber,
            episodeNumber,
            success: false,
            skipReason: 'Error',
            errorMessage: err instanceof Error ? err.message : 'Unknown error',
        };
    }
};

export const recordManualBatchLog = (params: {
    machineIdentifier: string;
    initiatedByUserId: number;
    initiatedByUsername: string;
    targetUsersMode: 'single' | 'all' | 'specific';
    targetUsersSummary: string;
    targetUserIds: number[];
    scope: string;
    targetTitle: string;
    streamType: 'audio' | 'subtitle';
    selectedStreamName: string;
    updatedCount: number;
    skippedCount: number;
    durationMs: number;
}): void => {
    const db = getDatabase();
    db.prepare(`
        INSERT INTO manual_batch_logs (
            machine_identifier,
            initiated_by_user_id,
            initiated_by_username,
            target_users_mode,
            target_users_summary,
            target_user_ids_json,
            scope,
            target_title,
            stream_type,
            selected_stream_name,
            updated_count,
            skipped_count,
            duration_ms,
            created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        params.machineIdentifier,
        params.initiatedByUserId,
        params.initiatedByUsername,
        params.targetUsersMode,
        params.targetUsersSummary,
        JSON.stringify(params.targetUserIds),
        params.scope,
        params.targetTitle,
        params.streamType,
        params.selectedStreamName,
        params.updatedCount,
        params.skippedCount,
        params.durationMs,
        Date.now()
    );
};

export const executeServerBatchUpdate = async (params: {
    jobId: string;
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
    onProgress: (state: DetailedProgressState) => void;
    signal: AbortSignal;
}): Promise<DetailedProgressState> => {
    const {
        jobId,
        machineIdentifier,
        serverUrl,
        clientIdentifier,
        initiatedByUserId,
        initiatedByUsername,
        primaryFetchToken,
        scope,
        targetItem,
        targetStream,
        type,
        keyword,
        targets,
        targetUsersMode,
        targetUsersSummary,
        onProgress,
        signal,
    } = params;

    const startedAt = Date.now();
    const targetTitle =
        scope === 'season' && 'parentTitle' in targetItem && targetItem.parentTitle
            ? `${targetItem.parentTitle} - ${targetItem.title}`
            : targetItem.title || 'Batch Update';

    onProgress({
        jobId,
        total: 0,
        current: 0,
        success: 0,
        failed: 0,
        isProcessing: true,
        statusMessage: `Fetching ${scope} items for "${targetTitle}"...`,
        results: [],
        targetUsersSummary,
    });

    let leafItems: PlexMetadata[] = [];

    if (scope === 'season') {
        const season = targetItem as PlexMetadata;
        leafItems = await getPmsMetadataChildren(
            serverUrl,
            season.ratingKey,
            clientIdentifier,
            primaryFetchToken
        );
    } else if (scope === 'show') {
        const show = targetItem as PlexMetadata;
        const seasons = await getPmsMetadataChildren(
            serverUrl,
            show.ratingKey,
            clientIdentifier,
            primaryFetchToken
        );
        const seasonEpisodes = await Promise.all(
            seasons.map(s =>
                getPmsMetadataChildren(
                    serverUrl,
                    s.ratingKey,
                    clientIdentifier,
                    primaryFetchToken
                )
            )
        );
        leafItems = seasonEpisodes.flat();
    } else if (scope === 'collection') {
        const collection = targetItem as PlexMetadata;
        const colChildren = await getPmsCollectionChildren(
            serverUrl,
            collection.ratingKey,
            clientIdentifier,
            primaryFetchToken
        );
        for (const item of colChildren) {
            if (item.type === 'show') {
                const seasons = await getPmsMetadataChildren(
                    serverUrl,
                    item.ratingKey,
                    clientIdentifier,
                    primaryFetchToken
                );
                const seasonEpisodes = await Promise.all(
                    seasons.map(s =>
                        getPmsMetadataChildren(
                            serverUrl,
                            s.ratingKey,
                            clientIdentifier,
                            primaryFetchToken
                        )
                    )
                );
                leafItems.push(...seasonEpisodes.flat());
            } else {
                leafItems.push(item);
            }
        }
    } else if (scope === 'library') {
        const lib = targetItem as PlexLibrary;
        leafItems = await getPmsLibraryItemsPaginated(
            serverUrl,
            lib.key,
            clientIdentifier,
            primaryFetchToken,
            lib.type === 'show' ? { type: 4 } : undefined
        );
    }

    const total = leafItems.length;
    const inferredType = leafItems[0]?.type === 'movie' ? 'movie' : 'episode';

    if (total === 0) {
        const emptyState: DetailedProgressState = {
            jobId,
            total: 0,
            current: 0,
            success: 0,
            failed: 0,
            isProcessing: false,
            statusMessage: 'No items found to process.',
            results: [],
            itemType: inferredType,
            targetUsersSummary,
        };
        onProgress(emptyState);
        return emptyState;
    }

    // 1. Fetch full metadata ONCE per item (with concurrency of 10) for items lacking Media/Part/Stream
    const itemsNeedingMetadata: PlexMetadata[] = [];
    const itemsWithMetadata: PlexMetadata[] = [];

    for (const item of leafItems) {
        if (!item.Media || !item.Media[0]?.Part?.[0]?.Stream) {
            itemsNeedingMetadata.push(item);
        } else {
            itemsWithMetadata.push(item);
        }
    }

    const FETCH_BATCH_SIZE = 10;
    const fetchedItems: PlexMetadata[] = [];

    if (itemsNeedingMetadata.length > 0) {
        onProgress({
            jobId,
            total: itemsNeedingMetadata.length,
            current: 0,
            success: 0,
            failed: 0,
            isProcessing: true,
            statusMessage: `Fetching metadata for ${itemsNeedingMetadata.length} items...`,
            results: [],
            itemType: inferredType,
            targetUsersSummary,
        });

        for (let i = 0; i < itemsNeedingMetadata.length; i += FETCH_BATCH_SIZE) {
            if (signal.aborted) break;
            const batch = itemsNeedingMetadata.slice(i, i + FETCH_BATCH_SIZE);
            const batchResults = await Promise.all(
                batch.map(ep =>
                    getPmsMetadata(
                        serverUrl,
                        ep.ratingKey,
                        clientIdentifier,
                        primaryFetchToken
                    ).catch(() => undefined)
                )
            );
            fetchedItems.push(
                ...batchResults.filter((ep): ep is PlexMetadata => ep !== undefined)
            );

            if (i % 40 === 0 || fetchedItems.length === itemsNeedingMetadata.length) {
                onProgress({
                    jobId,
                    total: itemsNeedingMetadata.length,
                    current: fetchedItems.length,
                    success: 0,
                    failed: 0,
                    isProcessing: true,
                    statusMessage: `Fetched metadata: ${fetchedItems.length} / ${itemsNeedingMetadata.length}`,
                    results: [],
                    itemType: inferredType,
                    targetUsersSummary,
                });
            }
        }
    }

    if (signal.aborted) {
        const cancelledState: DetailedProgressState = {
            jobId,
            total,
            current: 0,
            success: 0,
            failed: 0,
            isProcessing: false,
            statusMessage: 'Cancelled by user.',
            results: [],
            itemType: inferredType,
            targetUsersSummary,
        };
        onProgress(cancelledState);
        return cancelledState;
    }

    const allEpisodes = [...itemsWithMetadata, ...fetchedItems];
    const UPDATE_BATCH_SIZE = 5;

    const results: EpisodeResult[] = [];
    let success = 0;
    let failed = 0;
    let lastEmitTime = Date.now();

    onProgress({
        jobId,
        total,
        current: 0,
        success: 0,
        failed: 0,
        isProcessing: true,
        statusMessage: `Updating "${targetTitle}": 0 of ${total}...`,
        results: [],
        itemType: inferredType,
        targetUsersSummary,
    });

    for (let i = 0; i < allEpisodes.length; i += UPDATE_BATCH_SIZE) {
        if (signal.aborted) break;

        const batch = allEpisodes.slice(i, i + UPDATE_BATCH_SIZE);
        const batchResults = await Promise.all(
            batch.map(ep =>
                executeServerSingleEpisodeUpdate({
                    machineIdentifier,
                    serverUrl,
                    clientIdentifier,
                    episode: ep,
                    targetStream,
                    type,
                    keyword,
                    exactMatch: false,
                    targets,
                })
            )
        );

        for (const res of batchResults) {
            if (res.success) {
                success++;
                results.push(res);
            } else {
                failed++;
                if (total <= 5000 || res.skipReason === 'Error') {
                    results.push(res);
                }
            }
        }

        const processedCount = Math.min(i + batch.length, total);
        const now = Date.now();
        if (now - lastEmitTime >= 250 || processedCount === total) {
            lastEmitTime = now;
            onProgress({
                jobId,
                total,
                current: processedCount,
                success,
                failed,
                isProcessing: true,
                statusMessage: `Updating "${targetTitle}": ${processedCount} of ${total}...`,
                results: [...results],
                itemType: inferredType,
                targetUsersSummary,
            });
        }
    }

    const isCancelled = signal.aborted;
    const finalState: DetailedProgressState = {
        jobId,
        total,
        current: results.length,
        success,
        failed,
        isProcessing: false,
        statusMessage: isCancelled
            ? `Cancelled! ${success} updated before cancel.`
            : `Completed! ${success} successful, ${failed} failed/skipped.`,
        results,
        itemType: inferredType,
        targetUsersSummary,
    };

    recordManualBatchLog({
        machineIdentifier,
        initiatedByUserId,
        initiatedByUsername,
        targetUsersMode,
        targetUsersSummary,
        targetUserIds: targets.map(t => t.plexUserId),
        scope,
        targetTitle,
        streamType: type,
        selectedStreamName: targetStream ? formatStreamName(targetStream) : 'None',
        updatedCount: success,
        skippedCount: failed,
        durationMs: Date.now() - startedAt,
    });

    onProgress(finalState);
    return finalState;
};
