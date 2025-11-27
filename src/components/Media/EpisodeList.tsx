import React from 'react';
import type { PlexMetadata } from '../../types/plex';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useSettings } from '../../context/SettingsContext';

interface Props {
    episodes: PlexMetadata[];
    selectedEpisode: PlexMetadata | null;
    onSelect: (episode: PlexMetadata) => void;
    isCollapsed?: boolean;
    onToggleCollapse?: () => void;
}

export const EpisodeList = React.forwardRef<HTMLDivElement, Props>(({ episodes, selectedEpisode, onSelect, isCollapsed = false, onToggleCollapse }, ref) => {
    const isMobile = useIsMobile();
    const { maxListItems } = useSettings();

    const handleSelect = (episode: PlexMetadata) => {
        onSelect(episode);

        // Auto-collapse on mobile after selection
        if (isMobile && !isCollapsed && onToggleCollapse) {
            onToggleCollapse();
        }
    };

    const Row = ({ index, style, data }: ListChildComponentProps<PlexMetadata[]>) => {
        const episode = data[index];

        // Safety check
        if (!episode) return null;

        return (
            <div style={style}>
                <button
                    className={`list-group-item list-group-item-action rounded-0 ${index === 0 ? 'border-0' : 'border-start-0 border-end-0 border-bottom-0'} ${selectedEpisode?.ratingKey === episode.ratingKey ? 'active' : ''}`}
                    onClick={() => handleSelect(episode)}
                    style={{ height: '100%', width: '100%', textAlign: 'left' }}
                >
                    <div className="d-flex justify-content-between align-items-center">
                        <span className="text-truncate" style={{ maxWidth: '85%' }}>
                            {episode.index !== undefined && <span className="me-2 text-muted">E{episode.index}</span>}
                            {episode.title}
                        </span>
                    </div>
                </button>
            </div>
        );
    };

    const ITEM_SIZE = 45;
    const listHeight = Math.min(Math.max(episodes.length, 1), maxListItems) * ITEM_SIZE;

    return (
        <div ref={ref} className="card shadow-sm mb-3" style={{ display: 'flex', flexDirection: 'column' }}>
            <div
                className="card-header bg-white"
                style={{
                    cursor: 'pointer',
                    userSelect: 'none',
                    borderBottomLeftRadius: isCollapsed ? 'var(--bs-card-border-radius)' : '0',
                    borderBottomRightRadius: isCollapsed ? 'var(--bs-card-border-radius)' : '0',
                    borderBottom: isCollapsed ? 'none' : undefined
                }}
                onClick={onToggleCollapse}
            >
                <h5 className="mb-0 d-flex justify-content-between align-items-center">
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        Episodes
                        {isCollapsed && selectedEpisode && (
                            <span className="text-muted ms-3" style={{ fontSize: '0.85rem', fontWeight: 'normal' }}>
                                {selectedEpisode.title}
                            </span>
                        )}
                    </span>
                    {onToggleCollapse && <i className={`fas fa-chevron-${isCollapsed ? 'down' : 'up'}`}></i>}
                </h5>
            </div>
            {!isCollapsed && (
                <div className="list-group list-group-flush flex-grow-1" style={{ overflow: 'hidden' }}>
                    {episodes.length > 0 ? (
                        <AutoSizer disableHeight>
                            {({ width }) => (
                                <List
                                    height={listHeight}
                                    itemCount={episodes.length}
                                    itemSize={ITEM_SIZE}
                                    width={width}
                                    itemData={episodes}
                                >
                                    {Row}
                                </List>
                            )}
                        </AutoSizer>
                    ) : (
                        <div className="list-group-item text-muted">No episodes found</div>
                    )}
                </div>
            )}
        </div>
    );
});
