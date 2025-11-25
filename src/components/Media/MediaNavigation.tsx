import React, { useState, useEffect } from 'react';
import { LibraryList } from './LibraryList';
import { ShowList } from './ShowList';
import { SeasonList } from './SeasonList';
import { EpisodeList } from './EpisodeList';
import type { PlexLibrary, PlexMetadata } from '../../types/plex';
import { useAuth } from '../../context/AuthContext';

interface Props {
    libraries: PlexLibrary[];
    selectedLibrary: PlexLibrary | null;
    onSelectLibrary: (lib: PlexLibrary) => void;

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
    const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

    // Reset all sections to expanded when user or server changes
    useEffect(() => {
        setCollapsedSections(new Set());
    }, [user, serverUrl]);

    // Expand all sections when library changes
    useEffect(() => {
        if (selectedLibrary) {
            setCollapsedSections(new Set());
        }
    }, [selectedLibrary?.key]);

    // Expand seasons and episodes when show changes
    useEffect(() => {
        if (selectedShow) {
            setCollapsedSections(prev => {
                const newSet = new Set(prev);
                newSet.delete('seasons');
                newSet.delete('episodes');
                return newSet;
            });
        }
    }, [selectedShow?.ratingKey]);

    // Expand episodes when season changes
    useEffect(() => {
        if (selectedSeason) {
            setCollapsedSections(prev => {
                const newSet = new Set(prev);
                newSet.delete('episodes');
                return newSet;
            });
        }
    }, [selectedSeason?.ratingKey]);

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
                    shows={shows}
                    selectedShow={selectedShow}
                    onSelect={onSelectShow}
                    libraryType={selectedLibrary.type}
                    isCollapsed={collapsedSections.has('shows')}
                    onToggleCollapse={() => toggleCollapse('shows')}
                />
            )}

            {selectedShow && seasons.length > 0 && (
                <SeasonList
                    seasons={seasons}
                    selectedSeason={selectedSeason}
                    onSelect={onSelectSeason}
                    isCollapsed={collapsedSections.has('seasons')}
                    onToggleCollapse={() => toggleCollapse('seasons')}
                />
            )}

            {selectedSeason && (
                <EpisodeList
                    episodes={episodes}
                    selectedEpisode={selectedEpisode}
                    onSelect={onSelectEpisode}
                    isCollapsed={collapsedSections.has('episodes')}
                    onToggleCollapse={() => toggleCollapse('episodes')}
                />
            )}
        </>
    );
};
