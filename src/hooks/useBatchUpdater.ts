import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { usePastaProvider } from '../providers/PastaProvider';
import {
    cancelServerBatchJob,
    dismissServerBatchJob,
    fetchActiveServerBatch,
    subscribeToServerBatchEvents,
} from '../providers/server/sseClient';
import type { PlexStream, PlexMetadata, PlexLibrary } from '../types/plex';
import type { DetailedProgressState, EpisodeResult, TargetUsersSelection } from '../types/batchTypes';
import { useQueryClient } from '@tanstack/react-query';
import { plexKeys } from './usePlexQueries';

// Shared modal visibility state across Header (Status Pill) and MediaBrowser (ProgressModal).
// Starts minimized (true) on initial page load / new session so existing server jobs appear in the
// Header Status Pill without popping the modal automatically; starting a batch in THIS window sets it to false.
let sharedModalMinimized = true;
let currentDisplayedJobId: string | null = null;
let pendingLocalBatchStart = false;
const setPendingLocalBatchStart = (val: boolean) => {
    pendingLocalBatchStart = val;
};
const locallyStartedJobIds = new Set<string>();
const modalVisibilityListeners = new Set<(minimized: boolean) => void>();

export const setBatchModalMinimized = (minimized: boolean) => {
    sharedModalMinimized = minimized;
    for (const listener of modalVisibilityListeners) {
        listener(minimized);
    }
};

export const syncModalVisibilityWithServerEvent = (
    evt: { jobId: string } | null
) => {
    if (!evt) {
        currentDisplayedJobId = null;
        setBatchModalMinimized(true);
        return;
    }

    if (pendingLocalBatchStart) {
        locallyStartedJobIds.add(evt.jobId);
        pendingLocalBatchStart = false;
        currentDisplayedJobId = evt.jobId;
        setBatchModalMinimized(false);
        return;
    }

    if (evt.jobId !== currentDisplayedJobId) {
        currentDisplayedJobId = evt.jobId;
        if (!locallyStartedJobIds.has(evt.jobId)) {
            setBatchModalMinimized(true);
        }
    }
};

export const useBatchModalVisibility = () => {
    const [isMinimized, setIsMinimized] = useState(sharedModalMinimized);
    useEffect(() => {
        const listener = (val: boolean) => setIsMinimized(val);
        modalVisibilityListeners.add(listener);
        return () => {
            modalVisibilityListeners.delete(listener);
        };
    }, []);
    return {
        isMinimized,
        minimizeModal: () => setBatchModalMinimized(true),
        reopenModal: () => setBatchModalMinimized(false),
    };
};

export const useBatchUpdater = () => {
    const provider = usePastaProvider();
    const isServerMode = provider.mode === 'server';
    const { serverUrl, clientIdentifier, accessToken, machineIdentifier, isAuthenticated } = useAuth();
    const queryClient = useQueryClient();
    const abortControllerRef = useRef<AbortController | null>(null);
    const [activeTargetTitle, setActiveTargetTitle] = useState<string>('');
    const [batchNotice, setBatchNotice] = useState<string | null>(null);
    const clearBatchNotice = useCallback(() => setBatchNotice(null), []);

    const [progress, setProgress] = useState<DetailedProgressState>({
        total: 0,
        current: 0,
        success: 0,
        failed: 0,
        isProcessing: false,
        statusMessage: '',
        results: []
    });

    // In Server Mode, subscribe to live SSE batch progress and restore any active batch on mount/refresh
    useEffect(() => {
        if (!isServerMode || !isAuthenticated) return;

        void fetchActiveServerBatch(machineIdentifier);

        const unsubscribe = subscribeToServerBatchEvents(evt => {
            syncModalVisibilityWithServerEvent(evt);
            if (!evt) {
                setProgress({
                    total: 0,
                    current: 0,
                    success: 0,
                    failed: 0,
                    isProcessing: false,
                    statusMessage: '',
                    results: [],
                });
                setActiveTargetTitle('');
                return;
            }
            setActiveTargetTitle(evt.targetTitle || '');
            setProgress(evt.progress);

            // When a server batch finishes, invalidate React Query cache for the server
            if (!evt.progress.isProcessing && evt.progress.total > 0) {
                queryClient.invalidateQueries({
                    queryKey: plexKeys.server(evt.machineIdentifier),
                });
            }
        });

        return unsubscribe;
    }, [isServerMode, isAuthenticated, machineIdentifier, queryClient]);

    const cancelBatch = useCallback(() => {
        if (isServerMode && progress.jobId) {
            void cancelServerBatchJob(progress.jobId);
            return;
        }
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
    }, [isServerMode, progress.jobId]);

    const cancelQueuedBatch = useCallback(
        (jobId: string) => {
            if (isServerMode && jobId) {
                void cancelServerBatchJob(jobId);
            }
        },
        [isServerMode]
    );

    const getCtx = () => ({
        serverUrl,
        machineIdentifier,
        clientIdentifier,
        token: accessToken,
    });

    const fetchMetadataCached = (ratingKey: string) =>
        queryClient.fetchQuery({
            queryKey: plexKeys.metadata(machineIdentifier, accessToken, ratingKey),
            queryFn: () => provider.media.getMetadata(getCtx(), ratingKey),
            staleTime: 1000 * 60 * 30,
        });

    const fetchChildrenCached = (ratingKey: string) =>
        queryClient.fetchQuery({
            queryKey: plexKeys.children(machineIdentifier, accessToken, ratingKey),
            queryFn: () => provider.media.getMetadataChildren(getCtx(), ratingKey),
            staleTime: 1000 * 60 * 5,
        });

    const invalidateMetadata = (ratingKey: string) => {
        queryClient.invalidateQueries({
            queryKey: plexKeys.metadata(machineIdentifier, accessToken, ratingKey),
        });
    };

    const updateSingleEpisode = async (
        episode: PlexMetadata,
        targetStream: PlexStream | null,
        type: 'audio' | 'subtitle',
        keyword?: string,
        exactMatch: boolean = false,
        invalidate: boolean = true,
        targetUsers?: TargetUsersSelection
    ): Promise<EpisodeResult> => {
        const result = await provider.batch.updateSingleEpisode({
            ctx: getCtx(),
            episode,
            targetStream,
            type,
            keyword,
            exactMatch,
            targetUsers,
        });

        if (result.success && invalidate) {
            invalidateMetadata(episode.ratingKey);
        }

        return result;
    };

    const updateLibrary = async (
        library: PlexLibrary,
        targetStream: PlexStream | null,
        type: 'audio' | 'subtitle',
        keyword?: string,
        targetUsers?: TargetUsersSelection
    ) => {
        if (!serverUrl && provider.mode === 'client') return;

        setBatchModalMinimized(false);
        if (isServerMode) {
            setPendingLocalBatchStart(true);
        }
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = '';
        };
        if (provider.mode === 'client') {
            window.addEventListener('beforeunload', handleBeforeUnload);
        }

        abortControllerRef.current = new AbortController();

        try {
            await provider.batch.executeBatch({
                ctx: getCtx(),
                scope: 'library',
                targetItem: library,
                targetStream,
                type,
                keyword,
                targetUsers,
                onProgress: state => {
                    if (state.jobId) locallyStartedJobIds.add(state.jobId);
                    setProgress(state);
                },
                fetchMetadataCached,
                fetchChildrenCached,
                onInvalidateItem: invalidateMetadata,
                signal: abortControllerRef.current.signal,
            });
            setPendingLocalBatchStart(false);
            setBatchModalMinimized(false);

            queryClient.invalidateQueries({
                queryKey: plexKeys.libraryItems(machineIdentifier, library.key),
            });
        } catch (e) {
            setPendingLocalBatchStart(false);
            console.error(e);
            setBatchNotice(e instanceof Error ? e.message : 'Failed to fetch library items');
            if (!isServerMode) {
                resetProgress();
            }
        } finally {
            if (provider.mode === 'client') {
                window.removeEventListener('beforeunload', handleBeforeUnload);
            }
        }
    };

    const updateSeason = async (
        season: PlexMetadata,
        targetStream: PlexStream | null,
        type: 'audio' | 'subtitle',
        keyword?: string,
        targetUsers?: TargetUsersSelection
    ) => {
        if (!serverUrl && provider.mode === 'client') return;

        setBatchModalMinimized(false);
        if (isServerMode) {
            setPendingLocalBatchStart(true);
        }
        abortControllerRef.current = new AbortController();

        try {
            await provider.batch.executeBatch({
                ctx: getCtx(),
                scope: 'season',
                targetItem: season,
                targetStream,
                type,
                keyword,
                targetUsers,
                onProgress: state => {
                    if (state.jobId) locallyStartedJobIds.add(state.jobId);
                    setProgress(state);
                },
                fetchMetadataCached,
                fetchChildrenCached,
                onInvalidateItem: invalidateMetadata,
                signal: abortControllerRef.current.signal,
            });
            setPendingLocalBatchStart(false);
            setBatchModalMinimized(false);

            queryClient.invalidateQueries({
                queryKey: plexKeys.children(machineIdentifier, accessToken, season.ratingKey),
            });
        } catch (e) {
            setPendingLocalBatchStart(false);
            console.error(e);
            setBatchNotice(e instanceof Error ? e.message : 'Failed to fetch season episodes');
            if (!isServerMode) {
                resetProgress();
            }
        }
    };

    const updateShow = async (
        show: PlexMetadata,
        targetStream: PlexStream | null,
        type: 'audio' | 'subtitle',
        keyword?: string,
        targetUsers?: TargetUsersSelection
    ) => {
        if (!serverUrl && provider.mode === 'client') return;

        setBatchModalMinimized(false);
        if (isServerMode) {
            setPendingLocalBatchStart(true);
        }
        abortControllerRef.current = new AbortController();

        try {
            await provider.batch.executeBatch({
                ctx: getCtx(),
                scope: 'show',
                targetItem: show,
                targetStream,
                type,
                keyword,
                targetUsers,
                onProgress: state => {
                    if (state.jobId) locallyStartedJobIds.add(state.jobId);
                    setProgress(state);
                },
                fetchMetadataCached,
                fetchChildrenCached,
                onInvalidateItem: invalidateMetadata,
                signal: abortControllerRef.current.signal,
            });
            setPendingLocalBatchStart(false);
            setBatchModalMinimized(false);

            queryClient.invalidateQueries({
                queryKey: plexKeys.server(machineIdentifier),
            });
        } catch (e) {
            setPendingLocalBatchStart(false);
            console.error(e);
            setBatchNotice(e instanceof Error ? e.message : 'Failed to fetch show episodes');
            if (!isServerMode) {
                resetProgress();
            }
        }
    };

    const updateCollection = async (
        collection: PlexMetadata,
        targetStream: PlexStream | null,
        type: 'audio' | 'subtitle',
        keyword?: string,
        targetUsers?: TargetUsersSelection
    ) => {
        if (!serverUrl && provider.mode === 'client') return;

        setBatchModalMinimized(false);
        if (isServerMode) {
            setPendingLocalBatchStart(true);
        }
        abortControllerRef.current = new AbortController();

        try {
            await provider.batch.executeBatch({
                ctx: getCtx(),
                scope: 'collection',
                targetItem: collection,
                targetStream,
                type,
                keyword,
                targetUsers,
                onProgress: state => {
                    if (state.jobId) locallyStartedJobIds.add(state.jobId);
                    setProgress(state);
                },
                fetchMetadataCached,
                fetchChildrenCached,
                onInvalidateItem: invalidateMetadata,
                signal: abortControllerRef.current.signal,
            });
            setPendingLocalBatchStart(false);
            setBatchModalMinimized(false);

            queryClient.invalidateQueries({
                queryKey: plexKeys.server(machineIdentifier),
            });
        } catch (e) {
            setPendingLocalBatchStart(false);
            console.error(e);
            setBatchNotice(e instanceof Error ? e.message : 'Failed to process collection items');
            if (!isServerMode) {
                resetProgress();
            }
        }
    };

    const resetProgress = useCallback(() => {
        if (isServerMode && progress.jobId) {
            void dismissServerBatchJob(progress.jobId);
        }
        currentDisplayedJobId = null;
        setBatchModalMinimized(true);
        setProgress({
            total: 0,
            current: 0,
            success: 0,
            failed: 0,
            isProcessing: false,
            statusMessage: '',
            results: []
        });
    }, [isServerMode, progress.jobId]);

    return {
        progress,
        activeTargetTitle,
        batchNotice,
        clearBatchNotice,
        updateSeason,
        updateShow,
        updateCollection,
        updateLibrary,
        updateSingleEpisode,
        resetProgress,
        cancelBatch,
        cancelQueuedBatch,
    };
};
