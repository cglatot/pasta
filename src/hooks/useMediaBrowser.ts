import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import type { PlexLibrary, PlexMetadata } from '../types/plex';
import { useLibraries, useLibraryItems, useMetadataChildren, useMetadata } from './usePlexQueries';

export const useMediaBrowser = () => {
    const { clientIdentifier, accessToken, serverUrl, serverName, machineIdentifier } = useAuth();

    // Selection State
    const [selectedLibrary, setSelectedLibrary] = useState<PlexLibrary | null>(null);
    const [selectedShow, setSelectedShow] = useState<PlexMetadata | null>(null);
    const [selectedSeason, setSelectedSeason] = useState<PlexMetadata | null>(null);
    const [selectedEpisode, setSelectedEpisode] = useState<PlexMetadata | null>(null);

    // Queries
    const librariesQuery = useLibraries(serverUrl, machineIdentifier, clientIdentifier, accessToken);

    const showsQuery = useLibraryItems(
        serverUrl,
        machineIdentifier,
        selectedLibrary?.key,
        clientIdentifier,
        accessToken
    );

    // Seasons (only if show is selected and NOT a movie)
    const isMovie = selectedShow?.type === 'movie';
    const seasonsQuery = useMetadataChildren(
        serverUrl,
        machineIdentifier,
        !isMovie ? selectedShow?.ratingKey : undefined,
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

    // Full Episode/Movie Details
    // If it's a movie, we fetch metadata for the show (which is the movie).
    // If it's an episode, we fetch metadata for the selected episode.
    const detailRatingKey = isMovie ? selectedShow?.ratingKey : selectedEpisode?.ratingKey;

    const detailsQuery = useMetadata(
        serverUrl,
        machineIdentifier,
        detailRatingKey,
        clientIdentifier,
        accessToken
    );

    // Derived State
    const libraries = librariesQuery.data || [];
    const shows = showsQuery.data || [];
    const seasons = seasonsQuery.data || [];
    const episodes = episodesQuery.data || [];

    // Loading & Error Aggregation
    const loading = librariesQuery.isLoading || showsQuery.isLoading || seasonsQuery.isLoading || episodesQuery.isLoading || detailsQuery.isLoading;
    const error = librariesQuery.error || showsQuery.error || seasonsQuery.error || episodesQuery.error || detailsQuery.error;
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

    const selectShow = (show: PlexMetadata) => {
        if (selectedShow?.ratingKey !== show.ratingKey) {
            setSelectedShow(show);
            setSelectedSeason(null);
            setSelectedEpisode(null);

            if (show.type === 'movie') {
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

    // The UI expects 'selectedEpisode' to be the full object with Media/Part info.
    // detailsQuery.data will have that.
    const activeEpisode = detailsQuery.data || selectedEpisode;

    return {
        libraries,
        serverName,
        selectedLibrary,
        shows,
        selectedShow,
        seasons,
        selectedSeason,
        episodes,
        selectedEpisode: activeEpisode,
        loading,
        error: errorMessage,
        selectLibrary,
        selectShow,
        selectSeason,
        selectEpisode,
        refreshEpisode,
        resetSelection
    };
};
