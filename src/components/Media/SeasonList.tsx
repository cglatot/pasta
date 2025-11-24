import React from 'react';
import type { PlexMetadata } from '../../types/plex';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';

interface Props {
    seasons: PlexMetadata[];
    selectedSeason: PlexMetadata | null;
    onSelect: (season: PlexMetadata) => void;
}

export const SeasonList: React.FC<Props> = ({ seasons, selectedSeason, onSelect }) => {
    const Row = ({ index, style, data }: ListChildComponentProps<PlexMetadata[]>) => {
        const season = data[index];

        // Safety check
        if (!season) return null;

        return (
            <div style={style}>
                <button
                    className={`list-group-item list-group-item-action rounded-0 ${index === 0 ? 'border-0' : 'border-start-0 border-end-0 border-bottom-0'} ${selectedSeason?.ratingKey === season.ratingKey ? 'active' : ''}`}
                    onClick={() => onSelect(season)}
                    style={{ height: '100%', width: '100%', textAlign: 'left' }}
                >
                    {season.title}
                </button>
            </div>
        );
    };

    const ITEM_SIZE = 50;
    const MAX_ITEMS = 8;
    const listHeight = Math.min(Math.max(seasons.length, 1), MAX_ITEMS) * ITEM_SIZE;

    return (
        <div className="card shadow-sm mb-4" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="card-header bg-white">
                <h5 className="mb-0">Seasons</h5>
            </div>
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
        </div>
    );
};
