import { useState, useRef } from 'react';
import { updateStream, getMetadataChildren, getMetadata, getLibraryItems } from '../services/plex';
import { findMatchingStream } from '../utils/smartMatch';
import { useAuth } from '../context/AuthContext';
import type { PlexStream, PlexMetadata, PlexLibrary } from '../types/plex';
import type { DetailedProgressState, EpisodeResult, SkipReason, MatchReason } from '../types/batchTypes';
import { useQueryClient } from '@tanstack/react-query';
import { plexKeys } from './usePlexQueries';

// Format as "DisplayTitle - Title" or just show what's available
const formatStreamName = (stream: PlexStream): string => {
    const displayTitle = stream.displayTitle || '';
    const title = stream.title || '';

    if (displayTitle && title) {
        return `${displayTitle} - ${title}`;
    }
    return displayTitle || title || 'Unknown';
};

export const useBatchUpdater = () => {
    const { serverUrl, clientIdentifier, accessToken, machineIdentifier } = useAuth();
    const queryClient = useQueryClient();
    const abortControllerRef = useRef<AbortController | null>(null);

    const [progress, setProgress] = useState<DetailedProgressState>({
        total: 0,
        current: 0,
        success: 0,
        failed: 0,
        isProcessing: false,
        statusMessage: '',
        results: []
    });

    const cancelBatch = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
    };

    const updateSingleEpisode = async (
        episode: PlexMetadata,
        targetStream: PlexStream | null,
        type: 'audio' | 'subtitle',
        keyword?: string,
        exactMatch: boolean = false,
        invalidate: boolean = true
    ): Promise<EpisodeResult> => {
        const episodeTitle = episode.title || 'Unknown Episode';
        const seasonNumber = episode.parentIndex;
        const episodeNumber = episode.index;

        if (!serverUrl || !accessToken) {
            return {
                episodeTitle,
                seasonNumber,
                episodeNumber,
                success: false,
                skipReason: 'Error',
                errorMessage: 'No server URL or access token'
            };
        }

        try {
            // Assume episode already has full metadata from batch fetch
            const part = episode.Media?.[0]?.Part?.[0];
            if (!part || !part.Stream) {
                return {
                    episodeTitle,
                    seasonNumber,
                    episodeNumber,
                    success: false,
                    skipReason: 'Error',
                    errorMessage: 'No streams available'
                };
            }

            // Record what was selected before processing, so results can show "from -> to"
            const currentStream = part.Stream.find(s => s.streamType === (type === 'audio' ? 2 : 3) && s.selected);
            const previousStreamName = currentStream
                ? formatStreamName(currentStream)
                : (type === 'subtitle' ? 'None' : undefined);

            let streamIdToSet = 0; // Default to 0 (None) for subtitles
            let matchReason: MatchReason | undefined;
            let streamName: string | undefined;

            if (targetStream) {
                // If exactMatch is true, we try to find the exact stream ID in the current episode
                if (exactMatch) {
                    const exactStream = part.Stream.find(s => s.id === targetStream.id);
                    if (exactStream) {
                        streamIdToSet = exactStream.id;
                        matchReason = 'Exact Selection';
                        streamName = formatStreamName(exactStream);

                        // Check if already selected
                        if (exactStream.selected) {
                            return {
                                episodeTitle,
                                seasonNumber,
                                episodeNumber,
                                success: false,
                                skipReason: 'AlreadyMatched',
                                streamName,
                                previousStreamName
                            };
                        }
                    } else {
                        // Should not happen if invoked correctly for single episode
                        return {
                            episodeTitle,
                            seasonNumber,
                            episodeNumber,
                            success: false,
                            skipReason: 'Error',
                            errorMessage: 'Target stream not found in episode'
                        };
                    }
                } else {
                    // Find matching stream using smart match
                    const matchResult = findMatchingStream(targetStream, part.Stream, keyword);
                    if (matchResult) {
                        streamIdToSet = matchResult.stream.id;
                        matchReason = matchResult.matchReason;
                        streamName = formatStreamName(matchResult.stream);

                        // Check if the matched stream is already selected
                        if (matchResult.stream.selected) {
                            return {
                                episodeTitle,
                                seasonNumber,
                                episodeNumber,
                                success: false,
                                skipReason: 'AlreadyMatched',
                                streamName,
                                previousStreamName
                            };
                        }
                    } else {
                        // No match found, skip update
                        const skipReason: SkipReason = keyword ? 'KeywordFiltered' : 'NoMatch';
                        return {
                            episodeTitle,
                            seasonNumber,
                            episodeNumber,
                            success: false,
                            skipReason,
                            previousStreamName
                        };
                    }
                }
            } else {
                // If targetStream is null, we are setting to "None" (only valid for subtitles)
                if (type === 'audio') {
                    return {
                        episodeTitle,
                        seasonNumber,
                        episodeNumber,
                        success: false,
                        skipReason: 'Error',
                        errorMessage: 'Cannot set audio to None'
                    };
                }
                // Check if "None" is already selected (i.e., no subtitle stream is selected)
                const anySubtitleSelected = part.Stream.some(s => s.streamType === 3 && s.selected);
                if (!anySubtitleSelected) {
                    return {
                        episodeTitle,
                        seasonNumber,
                        episodeNumber,
                        success: false,
                        skipReason: 'AlreadyMatched',
                        streamName: 'None',
                        previousStreamName
                    };
                }

                streamName = 'None';
                matchReason = 'Exact Match (All Properties)'; // Setting to None is exact
            }

            await updateStream(serverUrl, part.id, streamIdToSet, type, clientIdentifier, accessToken);

            // Invalidate the specific episode metadata if requested
            if (invalidate) {
                queryClient.invalidateQueries({ queryKey: plexKeys.metadata(machineIdentifier, accessToken, episode.ratingKey) });
            }

            return {
                episodeTitle,
                seasonNumber,
                episodeNumber,
                success: true,
                matchReason,
                streamName,
                previousStreamName
            };
        } catch (e) {
            console.error(`Failed to update episode ${episodeTitle}`, e);
            return {
                episodeTitle,
                seasonNumber,
                episodeNumber,
                success: false,
                skipReason: 'Error',
                errorMessage: e instanceof Error ? e.message : 'Unknown error'
            };
        }
    };

    const processBatch = async (
        episodes: PlexMetadata[],
        targetStream: PlexStream | null,
        type: 'audio' | 'subtitle',
        keyword?: string
    ) => {
        const total = episodes.length;
        const firstItem = episodes[0];
        const inferredType = firstItem?.type === 'movie' ? 'movie' : 'episode';

        abortControllerRef.current = new AbortController();
        const signal = abortControllerRef.current.signal;

        setProgress({
            total,
            current: 0,
            success: 0,
            failed: 0,
            isProcessing: true,
            statusMessage: `Processing ${total} items...`,
            results: [],
            itemType: inferredType
        });

        // First, identify which episodes need metadata fetched
        const episodesNeedingMetadata: PlexMetadata[] = [];
        const episodesWithMetadata: PlexMetadata[] = [];

        episodes.forEach(ep => {
            if (!ep.Media || !ep.Media[0]?.Part?.[0]?.Stream) {
                episodesNeedingMetadata.push(ep);
            } else {
                episodesWithMetadata.push(ep);
            }
        });

        // Fetch all needed metadata in parallel, with controlled concurrency of 10
        const FETCH_BATCH_SIZE = 10;
        const fetchedEpisodes: PlexMetadata[] = [];

        if (episodesNeedingMetadata.length > 0 && serverUrl && accessToken) {
            setProgress(prev => ({
                ...prev,
                total: episodesNeedingMetadata.length,
                current: 0,
                statusMessage: `Fetching metadata for ${episodesNeedingMetadata.length} items...`
            }));

            for (let i = 0; i < episodesNeedingMetadata.length; i += FETCH_BATCH_SIZE) {
                if (signal.aborted) break;

                const batch = episodesNeedingMetadata.slice(i, i + FETCH_BATCH_SIZE);
                const batchPromises = batch.map(ep =>
                    queryClient.fetchQuery({
                        queryKey: plexKeys.metadata(machineIdentifier, accessToken, ep.ratingKey),
                        queryFn: () => getMetadata(serverUrl, ep.ratingKey, clientIdentifier, accessToken),
                        staleTime: 1000 * 60 * 30 // 30 minutes
                    }).catch(err => {
                        console.warn(`Failed to fetch metadata for episode ${ep.title}:`, err);
                        return null;
                    })
                );

                const batchResults = await Promise.all(batchPromises);
                fetchedEpisodes.push(...batchResults.filter((ep): ep is PlexMetadata => ep !== null));

                if (i % 50 === 0) {
                    setProgress(prev => ({
                        ...prev,
                        current: fetchedEpisodes.length,
                        statusMessage: `Fetched metadata: ${fetchedEpisodes.length} / ${episodesNeedingMetadata.length}`
                    }));
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            }
        }

        if (signal.aborted) {
            setProgress(prev => ({
                ...prev,
                isProcessing: false,
                statusMessage: 'Cancelled by user.'
            }));
            return;
        }

        // Combine episodes that already had metadata with newly fetched ones
        const allEpisodes = [...episodesWithMetadata, ...fetchedEpisodes];

        // Now process all episodes with concurrency of 5
        const UPDATE_BATCH_SIZE = 5;
        const results: EpisodeResult[] = [];
        const successfulEpisodes: PlexMetadata[] = [];
        let success = 0;
        let failed = 0;
        let lastUpdate = Date.now();

        for (let i = 0; i < allEpisodes.length; i += UPDATE_BATCH_SIZE) {
            if (signal.aborted) break;

            const batch = allEpisodes.slice(i, i + UPDATE_BATCH_SIZE);
            const batchResults = await Promise.all(
                batch.map(ep => updateSingleEpisode(ep, targetStream, type, keyword, false, false))
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
                setProgress({
                    total,
                    current: processedCount,
                    success,
                    failed,
                    isProcessing: true,
                    statusMessage: `Processing ${processedCount} of ${total}...`,
                    results: [...results],
                    itemType: inferredType
                });
                lastUpdate = now;
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        // Defer query invalidation for changed items until the end of the batch
        successfulEpisodes.forEach(ep => {
            queryClient.invalidateQueries({
                queryKey: plexKeys.metadata(machineIdentifier, accessToken, ep.ratingKey)
            });
        });

        const isCancelled = signal.aborted;
        setProgress({
            total,
            current: results.length,
            success,
            failed,
            isProcessing: false,
            statusMessage: isCancelled
                ? `Cancelled! ${success} updated before cancel.`
                : `Completed! ${success} successful, ${failed} failed/skipped.`,
            results,
            itemType: inferredType
        });
    };

    const updateLibrary = async (
        library: PlexLibrary,
        targetStream: PlexStream | null,
        type: 'audio' | 'subtitle',
        keyword?: string
    ) => {
        if (!serverUrl || !accessToken) return;

        // Prevent navigation
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', handleBeforeUnload);

        try {
            setProgress({
                total: 0,
                current: 0,
                success: 0,
                failed: 0,
                isProcessing: true,
                statusMessage: 'Fetching library items...',
                results: []
            });

            let episodes: PlexMetadata[] = [];

            if (library.type === 'show') {
                // Fetch all episodes directly using type=4
                episodes = await getLibraryItems(serverUrl, library.key, clientIdentifier, accessToken, { type: 4 });
            } else if (library.type === 'movie') {
                episodes = await getLibraryItems(serverUrl, library.key, clientIdentifier, accessToken);
            }

            if (episodes.length === 0) {
                alert('No items found in this library.');
                return;
            }

            await processBatch(episodes, targetStream, type, keyword);

            // Invalidate the library query to reflect changes
            queryClient.invalidateQueries({ queryKey: plexKeys.libraryItems(machineIdentifier, library.key) });

        } catch (e) {
            console.error(e);
            alert('Failed to fetch library items');
            resetProgress();
        } finally {
            window.removeEventListener('beforeunload', handleBeforeUnload);
        }
    };

    const updateSeason = async (season: PlexMetadata, targetStream: PlexStream | null, type: 'audio' | 'subtitle', keyword?: string) => {
        if (!serverUrl || !accessToken) return;

        setProgress({
            total: 0,
            current: 0,
            success: 0,
            failed: 0,
            isProcessing: true,
            statusMessage: 'Fetching season episodes...',
            results: []
        });

        try {
            const episodes = await queryClient.fetchQuery({
                queryKey: plexKeys.children(machineIdentifier, accessToken, season.ratingKey),
                queryFn: () => getMetadataChildren(serverUrl, season.ratingKey, clientIdentifier, accessToken),
                staleTime: 1000 * 60 * 5
            });
            await processBatch(episodes, targetStream, type, keyword);

            queryClient.invalidateQueries({ queryKey: plexKeys.children(machineIdentifier, accessToken, season.ratingKey) });

        } catch (e) {
            console.error(e);
            alert('Failed to fetch season episodes');
            resetProgress();
        }
    };

    const updateShow = async (show: PlexMetadata, targetStream: PlexStream | null, type: 'audio' | 'subtitle', keyword?: string) => {
        if (!serverUrl || !accessToken) return;

        setProgress({
            total: 0,
            current: 0,
            success: 0,
            failed: 0,
            isProcessing: true,
            statusMessage: 'Fetching show information...',
            results: []
        });

        try {
            // Fetch all seasons
            const seasons = await queryClient.fetchQuery({
                queryKey: plexKeys.children(machineIdentifier, accessToken, show.ratingKey),
                queryFn: () => getMetadataChildren(serverUrl, show.ratingKey, clientIdentifier, accessToken),
                staleTime: 1000 * 60 * 5
            });

            // Parallelize season fetching
            const seasonPromises = seasons.map(season =>
                queryClient.fetchQuery({
                    queryKey: plexKeys.children(machineIdentifier, accessToken, season.ratingKey),
                    queryFn: () => getMetadataChildren(serverUrl, season.ratingKey, clientIdentifier, accessToken),
                    staleTime: 1000 * 60 * 5
                })
            );
            const seasonsEpisodes = await Promise.all(seasonPromises);
            const allEpisodes = seasonsEpisodes.flat();

            await processBatch(allEpisodes, targetStream, type, keyword);

            // Invalidate all seasons involved
            seasons.forEach(season => {
                queryClient.invalidateQueries({ queryKey: plexKeys.children(machineIdentifier, accessToken, season.ratingKey) });
            });

        } catch (e) {
            console.error(e);
            alert('Failed to fetch show episodes');
            resetProgress();
        }
    };

    const resetProgress = () => {
        setProgress({
            total: 0,
            current: 0,
            success: 0,
            failed: 0,
            isProcessing: false,
            statusMessage: '',
            results: []
        });
    };

    return {
        progress,
        updateSeason,
        updateShow,
        updateLibrary,
        updateSingleEpisode,
        resetProgress,
        cancelBatch
    };
};
