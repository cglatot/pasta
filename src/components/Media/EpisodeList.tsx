import React from 'react';
import type { PlexMetadata } from '../../types/plex';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';

interface Props {
    episodes: PlexMetadata[];
    selectedEpisode: PlexMetadata | null;
    onSelect: (episode: PlexMetadata) => void;
}

export const EpisodeList: React.FC<Props> = ({ episodes, selectedEpisode, onSelect }) => {
    const Row = ({ index, style, data }: ListChildComponentProps<PlexMetadata[]>) => {
        const episode = data[index];

        // Safety check
        if (!episode) return null;

        return (
            <div style={style}>
                <button
                    className={`list-group-item list-group-item-action rounded-0 ${index === 0 ? 'border-0' : 'border-start-0 border-end-0 border-bottom-0'} ${selectedEpisode?.ratingKey === episode.ratingKey ? 'active' : ''}`}
                    onClick={() => onSelect(episode)}
                    style={{ height: '100%', width: '100%', textAlign: 'left' }}
                >
                    {episode.index !== undefined && <span className="me-2 text-muted">E{episode.index}</span>}
                    {episode.title}
                </button>
            </div>
        );
    };

    const ITEM_SIZE = 50;
    const MAX_ITEMS = 8;
    const listHeight = Math.min(Math.max(episodes.length, 1), MAX_ITEMS) * ITEM_SIZE;

    return (
        <div className="card shadow-sm mb-4" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="card-header bg-white">
                <h5 className="mb-0">Episodes</h5>
            </div>
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
        </div>
    );
};
