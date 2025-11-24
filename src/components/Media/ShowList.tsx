import React, { useState } from 'react';
import type { PlexMetadata } from '../../types/plex';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';

interface Props {
    shows: PlexMetadata[];
    selectedShow: PlexMetadata | null;
    onSelect: (show: PlexMetadata) => void;
    libraryType?: string;
}

export const ShowList: React.FC<Props> = ({ shows, selectedShow, onSelect, libraryType }) => {
    const [filter, setFilter] = useState('');

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

        // Safety check: If data is missing or index is out of bounds, render nothing
        if (!show) {
            return null;
        }

        return (
            <div style={style}>
                <button
                    className={`list-group-item list-group-item-action rounded-0 ${index === 0 ? 'border-0' : 'border-start-0 border-end-0 border-bottom-0'} ${selectedShow?.ratingKey === show.ratingKey ? 'active' : ''}`}
                    onClick={() => onSelect(show)}
                    style={{ height: '100%', width: '100%', textAlign: 'left' }}
                >
                    <div className="d-flex justify-content-between align-items-center">
                        <span className="text-truncate" style={{ maxWidth: '80%' }}>{show.title}</span>
                        <small>{show.year}</small>
                    </div>
                </button>
            </div>
        );
    };

    const ITEM_SIZE = 50;
    const MAX_ITEMS = 8;
    const listHeight = Math.min(Math.max(filteredShows.length, 1), MAX_ITEMS) * ITEM_SIZE;

    return (
        <div className="card shadow-sm mb-4" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="card-header bg-white">
                <h5 className="mb-0">{getHeaderTitle()}</h5>
                <input
                    type="text"
                    className="form-control mt-2"
                    placeholder="Search..."
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                />
            </div>
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
        </div>
    );
};
