import { useState } from 'react';
import { updateStream, getMetadataChildren, getMetadata, getLibraryItems } from '../services/plex';
import { findMatchingStream } from '../utils/smartMatch';
import { useAuth } from '../context/AuthContext';
import type { PlexStream, PlexMetadata, PlexLibrary } from '../types/plex';
import type { DetailedProgressState, EpisodeResult, SkipReason, MatchReason } from '../types/batchTypes';
import { useQueryClient } from '@tanstack/react-query';
import { plexKeys } from './usePlexQueries';

export const useBatchUpdater = () => {
    const { serverUrl, clientIdentifier, accessToken, machineIdentifier } = useAuth();
    const queryClient = useQueryClient();

    const [progress, setProgress] = useState<DetailedProgressState>({
        total: 0,
        current: 0,
        success: 0,
        failed: 0,
        isProcessing: false,
        statusMessage: '',
        results: []
    });

    const updateSingleEpisode = async (
        episode: PlexMetadata,
        targetStream: PlexStream | null,
        type: 'audio' | 'subtitle',
        keyword?: string,
        exactMatch: boolean = false
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

                        const displayTitle = exactStream.displayTitle || '';
                        const title = exactStream.title || '';

                        if (displayTitle && title) {
                            streamName = `${displayTitle} - ${title}`;
                        } else {
                            streamName = displayTitle || title || 'Unknown';
                        }

                        // Check if already selected
                        if (exactStream.selected) {
                            return {
                                episodeTitle,
                                seasonNumber,
                                episodeNumber,
                                success: false,
                                skipReason: 'AlreadyMatched',
                                streamName
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

                        // Format as "DisplayTitle - Title" or just show what's available
                        const displayTitle = matchResult.stream.displayTitle || '';
                        const title = matchResult.stream.title || '';

                        if (displayTitle && title) {
                            streamName = `${displayTitle} - ${title}`;
                        } else {
                            streamName = displayTitle || title || 'Unknown';
                        }

                        // Check if the matched stream is already selected
                        if (matchResult.stream.selected) {
                            return {
                                episodeTitle,
                                seasonNumber,
                                episodeNumber,
                                success: false,
                                skipReason: 'AlreadyMatched',
                                streamName
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
                            skipReason
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
                        streamName: 'None'
                    };
                }

                streamName = 'None';
                matchReason = 'Exact Match (All Properties)'; // Setting to None is exact
            }

            await updateStream(serverUrl, part.id, streamIdToSet, type, clientIdentifier, accessToken);

            // Invalidate the specific episode metadata
            queryClient.invalidateQueries({ queryKey: plexKeys.metadata(machineIdentifier, accessToken, episode.ratingKey) });

            return {
                episodeTitle,
                seasonNumber,
                episodeNumber,
                success: true,
                matchReason,
                streamName
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
        // Determine item type based on the first episode's metadata (if available) or default to 'episode'
        // Ideally this should be passed in, but we can infer or default.
        // Actually, let's pass it in or infer it.
        // For now, we'll default to 'episode' here, but updateLibrary will set it correctly if we pass it.
        // Let's add itemType to processBatch arguments.

        // Wait, I can't easily change the signature of processBatch without updating all callers.
        // Let's infer it. If it has seasonNumber/episodeNumber it's an episode.
        // But movies don't have those.
        // Let's just default to 'episode' in the state init, but allow callers to override?
        // No, let's just add the argument to processBatch. It's internal to this hook mostly.
        // Actually updateSeason and updateShow call it too.

        // Let's stick to 'episode' as default for updateSeason/updateShow.
        // For updateLibrary, we know the type.

        // Let's just update the state initialization in processBatch.
        // We can check if the first item has `type='movie'`.
        const firstItem = episodes[0];
        const inferredType = firstItem?.type === 'movie' ? 'movie' : 'episode';

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

        // Fetch all needed metadata in parallel, but with controlled concurrency
        // to avoid hitting rate limits (batch size of 10)
        const BATCH_SIZE = 10;
        const fetchedEpisodes: PlexMetadata[] = [];

        if (episodesNeedingMetadata.length > 0 && serverUrl && accessToken) {
            // Update status for metadata fetching
            setProgress(prev => ({
                ...prev,
                total: episodesNeedingMetadata.length,
                current: 0,
                statusMessage: `Fetching metadata for ${episodesNeedingMetadata.length} items...`
            }));

            for (let i = 0; i < episodesNeedingMetadata.length; i += BATCH_SIZE) {
                const batch = episodesNeedingMetadata.slice(i, i + BATCH_SIZE);
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

                // Throttle metadata fetch progress updates
                if (i % 50 === 0) {
                    setProgress(prev => ({
                        ...prev,
                        current: fetchedEpisodes.length,
                        statusMessage: `Fetched metadata: ${fetchedEpisodes.length} / ${episodesNeedingMetadata.length}`
                    }));
                    await new Promise(resolve => setTimeout(resolve, 10)); // Small yield
                }
            }
        }

        // Combine episodes that already had metadata with newly fetched ones
        const allEpisodes = [...episodesWithMetadata, ...fetchedEpisodes];

        // Now process all episodes with their full metadata
        const results: EpisodeResult[] = [];
        let success = 0;
        let failed = 0;
        let lastUpdate = Date.now();

        for (let i = 0; i < allEpisodes.length; i++) {
            const episode = allEpisodes[i];
            const result = await updateSingleEpisode(episode, targetStream, type, keyword);

            if (result.success) {
                success++;
                results.push(result);
            } else {
                failed++;
                // Memory Safety: For large batches (>5000), only store Errors.
                // Skips (AlreadyMatched, NoMatch) are counted but not stored to save memory.
                // Increased limit from 1000 to 5000 based on user feedback.
                if (total <= 5000 || result.skipReason === 'Error') {
                    results.push(result);
                }
            }

            // UI Throttling: Update state only every 500ms or on the last item
            const now = Date.now();
            if (now - lastUpdate > 500 || i === allEpisodes.length - 1) {
                setProgress({
                    total,
                    current: i + 1,
                    success,
                    failed,
                    isProcessing: true,
                    statusMessage: `Processing ${i + 1} of ${total}...`,
                    results: [...results],
                    itemType: inferredType
                });
                lastUpdate = now;

                // Yield to event loop to prevent freezing
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        setProgress({
            total,
            current: total,
            success,
            failed,
            isProcessing: false,
            statusMessage: `Completed! ${success} successful, ${failed} failed/skipped.`,
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
                // This is much more efficient than fetching shows -> seasons -> episodes
                episodes = await getLibraryItems(serverUrl, library.key, clientIdentifier, accessToken, { type: 4 });
            } else if (library.type === 'movie') {
                // Fetch all movies
                episodes = await getLibraryItems(serverUrl, library.key, clientIdentifier, accessToken);
            }

            if (episodes.length === 0) {
                alert('No items found in this library.');
                return;
            }

            await processBatch(episodes, targetStream, type, keyword);

            // Invalidate the library query to reflect changes
            // Note: We don't invalidate every single item as that would be too heavy
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

            // Invalidate the season's children (episodes list)
            // This ensures that if we view the list again, we get fresh data
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
            let allEpisodes: PlexMetadata[] = [];

            for (const season of seasons) {
                const episodes = await queryClient.fetchQuery({
                    queryKey: plexKeys.children(machineIdentifier, accessToken, season.ratingKey),
                    queryFn: () => getMetadataChildren(serverUrl, season.ratingKey, clientIdentifier, accessToken),
                    staleTime: 1000 * 60 * 5
                });
                allEpisodes = [...allEpisodes, ...episodes];

                // Invalidate each season's children as we process
                // Or we can do it at the end. Doing it here might be safer if we stop early.
            }

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
        resetProgress
    };
};
