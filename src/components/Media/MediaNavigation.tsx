import React, { useState, useEffect } from 'react';
import { LibraryList } from './LibraryList';
import { ShowList } from './ShowList';
import { SeasonList } from './SeasonList';
import { EpisodeList } from './EpisodeList';
import type { PlexLibrary, PlexMetadata } from '../../types/plex';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { useIsMobile } from '../../hooks/useIsMobile';

interface Props {
    libraries: PlexLibrary[];
    selectedLibrary: PlexLibrary | null;
    onSelectLibrary: (lib: PlexLibrary) => void;

    browseMode?: 'all' | 'collections';
    onBrowseModeChange?: (mode: 'all' | 'collections') => void;

    shows: PlexMetadata[];
    selectedShow: PlexMetadata | null;
    onSelectShow: (show: PlexMetadata) => void;

    seasons: PlexMetadata[];
    selectedSeason: PlexMetadata | null;
    onSelectSeason: (season: PlexMetadata) => void;

    episodes: PlexMetadata[];
    selectedEpisode: PlexMetadata | null;
    onSelectEpisode: (episode: PlexMetadata) => void;
}

export const MediaNavigation: React.FC<Props> = ({
    libraries,
    selectedLibrary,
    onSelectLibrary,
    browseMode = 'all',
    onBrowseModeChange,
    shows,
    selectedShow,
    onSelectShow,
    seasons,
    selectedSeason,
    onSelectSeason,
    episodes,
    selectedEpisode,
    onSelectEpisode
}) => {
    const { user, serverUrl } = useAuth();
    const { autoCollapse } = useSettings();
    const isMobile = useIsMobile();
    const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

    // Reset all sections to expanded when user or server changes
    useEffect(() => {
        setCollapsedSections(new Set());
    }, [user, serverUrl]);

    // Expand shows, seasons, and episodes when library changes (but keep libraries collapsed if user collapsed it)
    useEffect(() => {
        if (selectedLibrary) {
            setCollapsedSections(prev => {
                const newSet = new Set(prev);
                newSet.delete('shows');
                newSet.delete('seasons');
                newSet.delete('episodes');

                if (isMobile || autoCollapse) {
                    newSet.add('libraries');
                }

                return newSet;
            });
        }
    }, [selectedLibrary, selectedLibrary?.key, isMobile, autoCollapse]);

    // Expand seasons and episodes when show changes
    useEffect(() => {
        if (selectedShow) {
            setCollapsedSections(prev => {
                const newSet = new Set(prev);
                newSet.delete('seasons');
                newSet.delete('episodes');

                // Only auto-collapse the "shows" list if it's NOT a movie library in "all" mode
                if ((isMobile || autoCollapse) && (selectedLibrary?.type !== 'movie' || browseMode === 'collections')) {
                    newSet.add('shows');
                }

                return newSet;
            });
        }
    }, [selectedShow, selectedShow?.ratingKey, isMobile, autoCollapse, selectedLibrary?.type, browseMode]);

    // Expand episodes when season changes
    useEffect(() => {
        if (selectedSeason) {
            setCollapsedSections(prev => {
                const newSet = new Set(prev);
                newSet.delete('episodes');

                if (isMobile || autoCollapse) {
                    newSet.add('seasons');
                }

                return newSet;
            });
        }
    }, [selectedSeason, selectedSeason?.ratingKey, isMobile, autoCollapse]);

    const toggleCollapse = (section: string) => {
        setCollapsedSections(prev => {
            const newSet = new Set(prev);
            if (newSet.has(section)) {
                newSet.delete(section);
            } else {
                newSet.add(section);
            }
            return newSet;
        });
    };

    // Auto-scroll Refs
    const showListRef = React.useRef<HTMLDivElement>(null);
    const seasonListRef = React.useRef<HTMLDivElement>(null);
    const episodeListRef = React.useRef<HTMLDivElement>(null);

    // Auto-scroll logic
    useEffect(() => {
        if (selectedLibrary && showListRef.current) {
            setTimeout(() => {
                showListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
        }
    }, [selectedLibrary, selectedLibrary?.key, shows]);

    useEffect(() => {
        if (selectedShow && seasonListRef.current) {
            setTimeout(() => {
                seasonListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
        }
    }, [selectedShow, selectedShow?.ratingKey, seasons]);

    useEffect(() => {
        if (selectedSeason && episodeListRef.current) {
            setTimeout(() => {
                episodeListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
        }
    }, [selectedSeason, selectedSeason?.ratingKey, episodes]);

    const showMovieCollectionEpisodes =
        browseMode === 'collections' &&
        selectedLibrary?.type === 'movie' &&
        selectedShow &&
        episodes.length > 0;

    return (
        <>
            <LibraryList
                libraries={libraries}
                selectedLibrary={selectedLibrary}
                onSelect={onSelectLibrary}
                isCollapsed={collapsedSections.has('libraries')}
                onToggleCollapse={() => toggleCollapse('libraries')}
            />

            {selectedLibrary && (
                <ShowList
                    ref={showListRef}
                    shows={shows}
                    selectedShow={selectedShow}
                    onSelect={onSelectShow}
                    libraryType={selectedLibrary.type}
                    browseMode={browseMode}
                    onBrowseModeChange={onBrowseModeChange}
                    isCollapsed={collapsedSections.has('shows')}
                    onToggleCollapse={() => toggleCollapse('shows')}
                />
            )}

            {selectedShow && seasons.length > 0 && (
                <SeasonList
                    ref={seasonListRef}
                    seasons={seasons}
                    selectedSeason={selectedSeason}
                    onSelect={onSelectSeason}
                    isCollapsed={collapsedSections.has('seasons')}
                    onToggleCollapse={() => toggleCollapse('seasons')}
                />
            )}

            {(selectedSeason || showMovieCollectionEpisodes) && (
                <EpisodeList
                    ref={episodeListRef}
                    episodes={episodes}
                    selectedEpisode={selectedEpisode}
                    onSelect={onSelectEpisode}
                    headerTitle={showMovieCollectionEpisodes ? 'Collection Movies' : 'Episodes'}
                    isCollapsed={collapsedSections.has('episodes')}
                    onToggleCollapse={() => toggleCollapse('episodes')}
                />
            )}
        </>
    );
};
