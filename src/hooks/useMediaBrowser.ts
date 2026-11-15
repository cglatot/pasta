import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import type { PlexLibrary, PlexMetadata } from '../types/plex';
import {
    useLibraries,
    useLibraryItems,
    useLibraryCollections,
    useCollectionChildren,
    useMetadataChildren,
    useMetadata,
    plexKeys,
} from './usePlexQueries';

export const useMediaBrowser = () => {
    const queryClient = useQueryClient();
    const { clientIdentifier, accessToken, serverUrl, serverName, machineIdentifier } = useAuth();
    const { connectionTimeout } = useSettings();

    // Selection State
    const [selectedLibrary, setSelectedLibrary] = useState<PlexLibrary | null>(null);
    const [browseMode, setBrowseModeState] = useState<'all' | 'collections'>('all');
    const [selectedShow, setSelectedShow] = useState<PlexMetadata | null>(null);
    const [selectedSeason, setSelectedSeason] = useState<PlexMetadata | null>(null);
    const [selectedEpisode, setSelectedEpisode] = useState<PlexMetadata | null>(null);

    // Reset selection state when serverUrl changes (e.g. reconnect or change server)
    useEffect(() => {
        setSelectedLibrary(null);
        setBrowseModeState('all');
        setSelectedShow(null);
        setSelectedSeason(null);
        setSelectedEpisode(null);
    }, [serverUrl]);

    // Queries
    const librariesQuery = useLibraries(
        serverUrl,
        machineIdentifier,
        clientIdentifier,
        accessToken,
        connectionTimeout
    );

    const showsQuery = useLibraryItems(
        serverUrl,
        machineIdentifier,
        selectedLibrary?.key,
        clientIdentifier,
        accessToken,
        browseMode === 'all'
    );

    const collectionsQuery = useLibraryCollections(
        serverUrl,
        machineIdentifier,
        selectedLibrary?.key,
        clientIdentifier,
        accessToken,
        browseMode === 'collections'
    );

    const collectionChildrenQuery = useCollectionChildren(
        serverUrl,
        machineIdentifier,
        browseMode === 'collections' ? selectedShow?.ratingKey : undefined,
        clientIdentifier,
        accessToken
    );

    const isMovieLibrary = selectedLibrary?.type === 'movie';
    const isMovieItem = selectedShow?.type === 'movie' && browseMode === 'all';

    // In Collections mode for TV shows, collectionChildren are the shows in the collection
    const collectionFirstShowKey =
        browseMode === 'collections' && !isMovieLibrary
            ? collectionChildrenQuery.data?.[0]?.ratingKey
            : undefined;

    const effectiveShowKeyForSeasons =
        browseMode === 'collections'
            ? collectionFirstShowKey
            : !isMovieItem
              ? selectedShow?.ratingKey
              : undefined;

    const seasonsQuery = useMetadataChildren(
        serverUrl,
        machineIdentifier,
        effectiveShowKeyForSeasons,
        clientIdentifier,
        accessToken
    );

    // Episodes (only if season is selected)
    const episodesQuery = useMetadataChildren(
        serverUrl,
        machineIdentifier,
        selectedSeason?.ratingKey,
        clientIdentifier,
        accessToken
    );

    // Auto-select first movie or first season/episode when browsing a Collection so streams appear immediately
    useEffect(() => {
        if (browseMode !== 'collections' || !selectedShow) return;
        const children = collectionChildrenQuery.data;
        if (!children || children.length === 0) return;

        if (isMovieLibrary && !selectedEpisode) {
            setSelectedEpisode(children[0]);
        }
    }, [browseMode, selectedShow, collectionChildrenQuery.data, isMovieLibrary, selectedEpisode]);

    useEffect(() => {
        if (browseMode !== 'collections' || isMovieLibrary || !selectedShow) return;
        const seasonList = seasonsQuery.data;
        if (seasonList && seasonList.length > 0 && !selectedSeason) {
            setSelectedSeason(seasonList[0]);
        }
    }, [browseMode, isMovieLibrary, selectedShow, seasonsQuery.data, selectedSeason]);

    useEffect(() => {
        if (browseMode !== 'collections' || isMovieLibrary || !selectedSeason) return;
        const epList = episodesQuery.data;
        if (epList && epList.length > 0 && !selectedEpisode) {
            setSelectedEpisode(epList[0]);
        }
    }, [browseMode, isMovieLibrary, selectedSeason, episodesQuery.data, selectedEpisode]);

    // Full Episode/Movie Details
    const detailRatingKey = isMovieItem ? selectedShow?.ratingKey : selectedEpisode?.ratingKey;

    const detailsQuery = useMetadata(
        serverUrl,
        machineIdentifier,
        detailRatingKey,
        clientIdentifier,
        accessToken
    );

    // Derived State
    const libraries = librariesQuery.data || [];
    const shows = browseMode === 'collections' ? collectionsQuery.data || [] : showsQuery.data || [];
    const seasons = seasonsQuery.data || [];
    const episodes =
        browseMode === 'collections' && isMovieLibrary
            ? collectionChildrenQuery.data || []
            : episodesQuery.data || [];

    const handleRetryConnection = async () => {
        setSelectedLibrary(null);
        setSelectedShow(null);
        setSelectedSeason(null);
        setSelectedEpisode(null);
        await queryClient.resetQueries({ queryKey: plexKeys.all });
    };

    // Loading & Error Aggregation
    const isConnectionError = librariesQuery.isError;
    const loading =
        librariesQuery.isLoading ||
        showsQuery.isLoading ||
        collectionsQuery.isLoading ||
        collectionChildrenQuery.isLoading ||
        seasonsQuery.isLoading ||
        episodesQuery.isLoading ||
        detailsQuery.isLoading;
    const isReconnecting = librariesQuery.isFetching && isConnectionError;
    const error =
        librariesQuery.error ||
        showsQuery.error ||
        collectionsQuery.error ||
        collectionChildrenQuery.error ||
        seasonsQuery.error ||
        episodesQuery.error ||
        detailsQuery.error;
    const errorMessage = error ? (error instanceof Error ? error.message : 'An error occurred') : null;

    // Selection Handlers
    const selectLibrary = (library: PlexLibrary) => {
        if (selectedLibrary?.key !== library.key) {
            setSelectedLibrary(library);
            setSelectedShow(null);
            setSelectedSeason(null);
            setSelectedEpisode(null);
        }
    };

    const setBrowseMode = (mode: 'all' | 'collections') => {
        if (browseMode !== mode) {
            setBrowseModeState(mode);
            setSelectedShow(null);
            setSelectedSeason(null);
            setSelectedEpisode(null);
        }
    };

    const selectShow = (show: PlexMetadata) => {
        if (selectedShow?.ratingKey !== show.ratingKey) {
            setSelectedShow(show);
            setSelectedSeason(null);
            setSelectedEpisode(null);

            if (show.type === 'movie' && browseMode === 'all') {
                setSelectedEpisode(show);
            }
        }
    };

    const selectSeason = (season: PlexMetadata) => {
        if (selectedSeason?.ratingKey !== season.ratingKey) {
            setSelectedSeason(season);
            setSelectedEpisode(null);
        }
    };

    const selectEpisode = (episode: PlexMetadata) => {
        if (selectedEpisode?.ratingKey !== episode.ratingKey) {
            setSelectedEpisode(episode);
        }
    };

    const refreshEpisode = async () => {
        if (detailRatingKey) {
            await detailsQuery.refetch();
        }
    };

    const resetSelection = () => {
        setSelectedLibrary(null);
        setSelectedShow(null);
        setSelectedSeason(null);
        setSelectedEpisode(null);
    };

    const activeEpisode = detailsQuery.data || selectedEpisode;
    const selectedCollection = browseMode === 'collections' ? selectedShow : null;

    return {
        libraries,
        serverName,
        selectedLibrary,
        browseMode,
        setBrowseMode,
        shows,
        selectedShow,
        selectedCollection,
        seasons,
        selectedSeason,
        episodes,
        selectedEpisode: activeEpisode,
        loading,
        error: errorMessage,
        isConnectionError,
        isReconnecting,
        handleRetryConnection,
        selectLibrary,
        selectShow,
        selectSeason,
        selectEpisode,
        refreshEpisode,
        resetSelection,
    };
};
