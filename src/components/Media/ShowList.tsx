import React, { useState } from 'react';
import type { PlexMetadata } from '../../types/plex';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useSettings } from '../../context/SettingsContext';

interface Props {
    shows: PlexMetadata[];
    selectedShow: PlexMetadata | null;
    onSelect: (show: PlexMetadata) => void;
    libraryType?: string;
    isCollapsed?: boolean;
    onToggleCollapse?: () => void;
}

export const ShowList = React.forwardRef<HTMLDivElement, Props>(({ shows, selectedShow, onSelect, libraryType, isCollapsed = false, onToggleCollapse }, ref) => {
    const [filter, setFilter] = useState('');
    const isMobile = useIsMobile();
    const { maxListItems } = useSettings();

    const handleSelect = (show: PlexMetadata) => {
        onSelect(show);

        // Auto-collapse on mobile after selection
        if (isMobile && !isCollapsed && onToggleCollapse) {
            onToggleCollapse();
        }
    };

    const filteredShows = shows.filter(show =>
        show.title.toLowerCase().includes(filter.toLowerCase())
    );

    const getHeaderTitle = () => {
        if (libraryType === 'movie') return 'Movies';
        if (libraryType === 'show') return 'TV Shows';
        return 'Content';
    };

    const Row = ({ index, style, data }: ListChildComponentProps<PlexMetadata[]>) => {
        const show = data[index];

        if (!show) {
            return null;
        }

        return (
            <div style={style}>
                <button
                    className={`list-group-item list-group-item-action rounded-0 ${index === 0 ? 'border-0' : 'border-start-0 border-end-0 border-bottom-0'} ${selectedShow?.ratingKey === show.ratingKey ? 'active' : ''}`}
                    onClick={() => handleSelect(show)}
                    style={{ height: '100%', width: '100%', textAlign: 'left' }}
                >
                    <div className="d-flex justify-content-between align-items-center">
                        <span className="text-truncate" style={{ maxWidth: '80%' }}>{show.title}</span>
                        <small className="flex-shrink-0">{show.year}</small>
                    </div>
                </button>
            </div>
        );
    };

    const ITEM_SIZE = 45;
    const listHeight = Math.min(Math.max(filteredShows.length, 1), maxListItems) * ITEM_SIZE;

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
                        {getHeaderTitle()}
                        {isCollapsed && selectedShow && (
                            <span className="text-muted ms-3" style={{ fontSize: '0.85rem', fontWeight: 'normal' }}>
                                {selectedShow.title}
                            </span>
                        )}
                    </span>
                    {onToggleCollapse && <i className={`fas fa-chevron-${isCollapsed ? 'down' : 'up'}`}></i>}
                </h5>
                {!isCollapsed && (
                    <input
                        type="text"
                        className="form-control mt-2"
                        placeholder="Search..."
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                    />
                )}
            </div>
            {!isCollapsed && (
                <div className="list-group list-group-flush flex-grow-1" style={{ overflow: 'hidden' }}>
                    {filteredShows.length > 0 ? (
                        <AutoSizer disableHeight>
                            {({ width }) => (
                                <List
                                    height={listHeight}
                                    itemCount={filteredShows.length}
                                    itemSize={ITEM_SIZE}
                                    width={width}
                                    itemData={filteredShows}
                                >
                                    {Row}
                                </List>
                            )}
                        </AutoSizer>
                    ) : (
                        <div className="list-group-item text-muted">No matches found</div>
                    )}
                </div>
            )}
        </div>
    );
});
