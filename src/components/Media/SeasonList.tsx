import React from 'react';
import type { PlexMetadata } from '../../types/plex';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useSettings } from '../../context/SettingsContext';

interface Props {
    seasons: PlexMetadata[];
    selectedSeason: PlexMetadata | null;
    onSelect: (season: PlexMetadata) => void;
    isCollapsed?: boolean;
    onToggleCollapse?: () => void;
}

export const SeasonList = React.forwardRef<HTMLDivElement, Props>(({ seasons, selectedSeason, onSelect, isCollapsed = false, onToggleCollapse }, ref) => {
    const isMobile = useIsMobile();
    const { maxListItems } = useSettings();

    const handleSelect = (season: PlexMetadata) => {
        onSelect(season);

        // Auto-collapse on mobile after selection
        if (isMobile && !isCollapsed && onToggleCollapse) {
            onToggleCollapse();
        }
    };

    const Row = ({ index, style, data }: ListChildComponentProps<PlexMetadata[]>) => {
        const season = data[index];

        // Safety check
        if (!season) return null;

        return (
            <div style={style}>
                <button
                    className={`list-group-item list-group-item-action rounded-0 ${index === 0 ? 'border-0' : 'border-start-0 border-end-0 border-bottom-0'} ${selectedSeason?.ratingKey === season.ratingKey ? 'active' : ''}`}
                    onClick={() => handleSelect(season)}
                    style={{ height: '100%', width: '100%', textAlign: 'left' }}
                >
                    <div className="d-flex justify-content-between align-items-center">
                        <span>{season.title}</span>
                    </div>
                </button>
            </div>
        );
    };

    const ITEM_SIZE = 45;
    const listHeight = Math.min(Math.max(seasons.length, 1), maxListItems) * ITEM_SIZE;

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
                        Seasons
                        {isCollapsed && selectedSeason && (
                            <span className="text-muted ms-3" style={{ fontSize: '0.85rem', fontWeight: 'normal' }}>
                                {selectedSeason.title}
                            </span>
                        )}
                    </span>
                    {onToggleCollapse && <i className={`fas fa-chevron-${isCollapsed ? 'down' : 'up'}`}></i>}
                </h5>
            </div>
            {!isCollapsed && (
                <div className="list-group list-group-flush flex-grow-1" style={{ overflow: 'hidden' }}>
                    {seasons.length > 0 ? (
                        <AutoSizer disableHeight>
                            {({ width }) => (
                                <List
                                    height={listHeight}
                                    itemCount={seasons.length}
                                    itemSize={ITEM_SIZE}
                                    width={width}
                                    itemData={seasons}
                                >
                                    {Row}
                                </List>
                            )}
                        </AutoSizer>
                    ) : (
                        <div className="list-group-item text-muted">No seasons found</div>
                    )}
                </div>
            )}
        </div>
    );
});
