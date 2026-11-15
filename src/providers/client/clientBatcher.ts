import {
    getCollectionChildren,
    getLibraryItems,
    getMetadata,
    getMetadataChildren,
    updateStream,
} from './plexClient';
import { resolveEpisodePartUpdates } from '../../shared/smartMatch';
import type { PlexLibrary, PlexMetadata, PlexStream } from '../../shared/types/plex';
import type { DetailedProgressState, EpisodeResult } from '../../shared/types/batchTypes';
import type { BatchUpdateRequest, MediaRequestContext, SingleEpisodeUpdateOptions } from '../types';

/**
 * Updates a single episode or movie across ALL of its Media[] versions and Part[] entries
 * directly from the browser (ClientStandaloneProvider).
 */
export const updateSingleEpisodeClient = async ({
    ctx,
    episode,
    targetStream,
    type,
    keyword,
    exactMatch = false,
}: SingleEpisodeUpdateOptions): Promise<EpisodeResult> => {
    const episodeTitle = episode.title || 'Unknown Episode';
    const seasonNumber = episode.parentIndex;
    const episodeNumber = episode.index;

    if (!ctx.serverUrl || !ctx.token) {
        return {
            episodeTitle,
            seasonNumber,
            episodeNumber,
            success: false,
            skipReason: 'Error',
            errorMessage: 'No server URL or access token',
        };
    }

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

        if (resolution.allAlreadyMatched) {
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

        // Apply updates to every Media/Part that needs changing (e.g. both 4K and 1080p versions)
        const partsToUpdate = resolution.partUpdates.filter(u => !u.alreadySelected);
        for (const partUpdate of partsToUpdate) {
            await updateStream(
                ctx.serverUrl,
                partUpdate.partId,
                partUpdate.streamId,
                type,
                ctx.clientIdentifier,
                ctx.token
            );
        }

        return {
            episodeTitle,
            seasonNumber,
            episodeNumber,
            success: true,
            matchReason: resolution.matchReason,
            streamName: resolution.streamName,
            previousStreamName: resolution.previousStreamName,
        };
    } catch (e) {
        console.error(`Failed to update episode ${episodeTitle}`, e);
        return {
            episodeTitle,
            seasonNumber,
            episodeNumber,
            success: false,
            skipReason: 'Error',
            errorMessage: e instanceof Error ? e.message : 'Unknown error',
        };
    }
};

const processEpisodeBatchClient = async (
    ctx: MediaRequestContext,
    episodes: PlexMetadata[],
    targetStream: PlexStream | null,
    type: 'audio' | 'subtitle',
    keyword: string | undefined,
    onProgress: (state: DetailedProgressState) => void,
    fetchMetadataCached?: (ratingKey: string) => Promise<PlexMetadata | undefined>,
    onInvalidateItem?: (ratingKey: string) => void,
    signal?: AbortSignal
): Promise<void> => {
    const total = episodes.length;
    const firstItem = episodes[0];
    const inferredType = firstItem?.type === 'movie' ? 'movie' : 'episode';

    onProgress({
        total,
        current: 0,
        success: 0,
        failed: 0,
        isProcessing: true,
        statusMessage: `Processing ${total} items...`,
        results: [],
        itemType: inferredType,
    });

    const episodesNeedingMetadata: PlexMetadata[] = [];
    const episodesWithMetadata: PlexMetadata[] = [];

    episodes.forEach(ep => {
        if (!ep.Media || !ep.Media[0]?.Part?.[0]?.Stream) {
            episodesNeedingMetadata.push(ep);
        } else {
            episodesWithMetadata.push(ep);
        }
    });

    const FETCH_BATCH_SIZE = 10;
    const fetchedEpisodes: PlexMetadata[] = [];

    if (episodesNeedingMetadata.length > 0 && ctx.serverUrl && ctx.token) {
        onProgress({
            total: episodesNeedingMetadata.length,
            current: 0,
            success: 0,
            failed: 0,
            isProcessing: true,
            statusMessage: `Fetching metadata for ${episodesNeedingMetadata.length} items...`,
            results: [],
            itemType: inferredType,
        });

        for (let i = 0; i < episodesNeedingMetadata.length; i += FETCH_BATCH_SIZE) {
            if (signal?.aborted) break;

            const batch = episodesNeedingMetadata.slice(i, i + FETCH_BATCH_SIZE);
            const batchPromises = batch.map(ep => {
                const fetchFn = fetchMetadataCached
                    ? () => fetchMetadataCached(ep.ratingKey)
                    : () => getMetadata(ctx.serverUrl!, ep.ratingKey, ctx.clientIdentifier, ctx.token!);
                return fetchFn().catch(err => {
                    console.warn(`Failed to fetch metadata for episode ${ep.title}:`, err);
                    return undefined;
                });
            });

            const batchResults = await Promise.all(batchPromises);
            fetchedEpisodes.push(...batchResults.filter((ep): ep is PlexMetadata => ep !== undefined));

            if (i % 50 === 0) {
                onProgress({
                    total: episodesNeedingMetadata.length,
                    current: fetchedEpisodes.length,
                    success: 0,
                    failed: 0,
                    isProcessing: true,
                    statusMessage: `Fetched metadata: ${fetchedEpisodes.length} / ${episodesNeedingMetadata.length}`,
                    results: [],
                    itemType: inferredType,
                });
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }
    }

    if (signal?.aborted) {
        onProgress({
            total,
            current: 0,
            success: 0,
            failed: 0,
            isProcessing: false,
            statusMessage: 'Cancelled by user.',
            results: [],
            itemType: inferredType,
        });
        return;
    }

    const allEpisodes = [...episodesWithMetadata, ...fetchedEpisodes];
    const UPDATE_BATCH_SIZE = 5;
    const results: EpisodeResult[] = [];
    const successfulEpisodes: PlexMetadata[] = [];
    let success = 0;
    let failed = 0;
    let lastUpdate = Date.now();

    for (let i = 0; i < allEpisodes.length; i += UPDATE_BATCH_SIZE) {
        if (signal?.aborted) break;

        const batch = allEpisodes.slice(i, i + UPDATE_BATCH_SIZE);
        const batchResults = await Promise.all(
            batch.map(ep =>
                updateSingleEpisodeClient({
                    ctx,
                    episode: ep,
                    targetStream,
                    type,
                    keyword,
                    exactMatch: false,
                })
            )
        );

        batchResults.forEach((result, idx) => {
            if (result.success) {
                success++;
                results.push(result);
                successfulEpisodes.push(batch[idx]);
            } else {
                failed++;
                if (total <= 5000 || result.skipReason === 'Error') {
                    results.push(result);
                }
            }
        });

        const processedCount = Math.min(i + batch.length, total);
        const now = Date.now();
        if (now - lastUpdate > 500 || processedCount === total) {
            onProgress({
                total,
                current: processedCount,
                success,
                failed,
                isProcessing: true,
                statusMessage: `Processing ${processedCount} of ${total}...`,
                results: [...results],
                itemType: inferredType,
            });
            lastUpdate = now;
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    if (onInvalidateItem) {
        successfulEpisodes.forEach(ep => onInvalidateItem(ep.ratingKey));
    }

    const isCancelled = Boolean(signal?.aborted);
    onProgress({
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
    });
};

export const executeBatchClient = async (request: BatchUpdateRequest): Promise<void> => {
    const {
        ctx,
        scope,
        targetItem,
        targetStream,
        type,
        keyword,
        onProgress,
        fetchMetadataCached,
        fetchChildrenCached,
        onInvalidateItem,
        signal,
    } = request;

    if (!ctx.serverUrl || !ctx.token) return;

    const getChildren = (ratingKey: string) =>
        fetchChildrenCached
            ? fetchChildrenCached(ratingKey)
            : getMetadataChildren(ctx.serverUrl!, ratingKey, ctx.clientIdentifier, ctx.token!);

    if (scope === 'season') {
        const season = targetItem as PlexMetadata;
        onProgress({
            total: 0,
            current: 0,
            success: 0,
            failed: 0,
            isProcessing: true,
            statusMessage: 'Fetching season episodes...',
            results: [],
        });

        const episodes = await getChildren(season.ratingKey);
        await processEpisodeBatchClient(
            ctx,
            episodes,
            targetStream,
            type,
            keyword,
            onProgress,
            fetchMetadataCached,
            onInvalidateItem,
            signal
        );
        return;
    }

    if (scope === 'show') {
        const show = targetItem as PlexMetadata;
        onProgress({
            total: 0,
            current: 0,
            success: 0,
            failed: 0,
            isProcessing: true,
            statusMessage: 'Fetching show information...',
            results: [],
        });

        const seasons = await getChildren(show.ratingKey);
        const seasonsEpisodes = await Promise.all(seasons.map(season => getChildren(season.ratingKey)));
        const allEpisodes = seasonsEpisodes.flat();

        await processEpisodeBatchClient(
            ctx,
            allEpisodes,
            targetStream,
            type,
            keyword,
            onProgress,
            fetchMetadataCached,
            onInvalidateItem,
            signal
        );
        return;
    }

    if (scope === 'collection') {
        const collection = targetItem as PlexMetadata;
        onProgress({
            total: 0,
            current: 0,
            success: 0,
            failed: 0,
            isProcessing: true,
            statusMessage: 'Fetching collection items...',
            results: [],
        });

        const collectionItems = await getCollectionChildren(
            ctx.serverUrl,
            collection.ratingKey,
            ctx.clientIdentifier,
            ctx.token
        );

        const allLeafItems: PlexMetadata[] = [];
        for (const item of collectionItems) {
            if (item.type === 'show') {
                const seasons = await getChildren(item.ratingKey);
                const seasonsEpisodes = await Promise.all(seasons.map(s => getChildren(s.ratingKey)));
                allLeafItems.push(...seasonsEpisodes.flat());
            } else {
                allLeafItems.push(item);
            }
        }

        await processEpisodeBatchClient(
            ctx,
            allLeafItems,
            targetStream,
            type,
            keyword,
            onProgress,
            fetchMetadataCached,
            onInvalidateItem,
            signal
        );
        return;
    }

    if (scope === 'library') {
        const library = targetItem as PlexLibrary;
        onProgress({
            total: 0,
            current: 0,
            success: 0,
            failed: 0,
            isProcessing: true,
            statusMessage: 'Fetching library items...',
            results: [],
        });

        let episodes: PlexMetadata[] = [];
        if (library.type === 'show') {
            episodes = await getLibraryItems(ctx.serverUrl, library.key, ctx.clientIdentifier, ctx.token, {
                type: 4,
            });
        } else if (library.type === 'movie') {
            episodes = await getLibraryItems(ctx.serverUrl, library.key, ctx.clientIdentifier, ctx.token);
        }

        if (episodes.length === 0) {
            throw new Error('No items found in this library.');
        }

        await processEpisodeBatchClient(
            ctx,
            episodes,
            targetStream,
            type,
            keyword,
            onProgress,
            fetchMetadataCached,
            onInvalidateItem,
            signal
        );
    }
};
