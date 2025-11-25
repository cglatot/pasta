import React from 'react';
import type { PlexLibrary } from '../../types/plex';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { useIsMobile } from '../../hooks/useIsMobile';

interface Props {
    libraries: PlexLibrary[];
    selectedLibrary: PlexLibrary | null;
    onSelect: (lib: PlexLibrary) => void;
    isCollapsed?: boolean;
    onToggleCollapse?: () => void;
}

export const LibraryList: React.FC<Props> = ({ libraries, selectedLibrary, onSelect, isCollapsed = false, onToggleCollapse }) => {
    const isMobile = useIsMobile();

    const handleSelect = (lib: PlexLibrary) => {
        onSelect(lib);

        // Auto-collapse on mobile after selection
        if (isMobile && !isCollapsed && onToggleCollapse) {
            onToggleCollapse();
        }
    };

    const Row = ({ index, style, data }: ListChildComponentProps<PlexLibrary[]>) => {
        const lib = data[index];
        if (!lib) return null;

        return (
            <div style={style}>
                <button
                    className={`list-group-item list-group-item-action rounded-0 ${index === 0 ? 'border-0' : 'border-start-0 border-end-0 border-bottom-0'} ${selectedLibrary?.key === lib.key ? 'active' : ''}`}
                    onClick={() => handleSelect(lib)}
                    style={{ height: '100%', width: '100%', textAlign: 'left' }}
                >
                    <span className="text-truncate d-block">{lib.title}</span>
                </button>
            </div>
        );
    };

    const ITEM_SIZE = 45;
    const MAX_ITEMS = 6;
    const listHeight = Math.min(Math.max(libraries.length, 1), MAX_ITEMS) * ITEM_SIZE;

    return (
        <div className="card shadow-sm mb-3" style={{ display: 'flex', flexDirection: 'column' }}>
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
                    <span>
                        Libraries
                        {isCollapsed && selectedLibrary && (
                            <span className="text-muted ms-3" style={{ fontSize: '0.85rem', fontWeight: 'normal' }}>
                                {selectedLibrary.title}
                            </span>
                        )}
                    </span>
                    {onToggleCollapse && <i className={`fas fa-chevron-${isCollapsed ? 'down' : 'up'}`}></i>}
                </h5>
            </div>
            {!isCollapsed && (
                <div className="list-group list-group-flush flex-grow-1" style={{ overflow: 'hidden' }}>
                    {libraries.length > 0 ? (
                        <AutoSizer disableHeight>
                            {({ width }) => (
                                <List
                                    height={listHeight}
                                    itemCount={libraries.length}
                                    itemSize={ITEM_SIZE}
                                    width={width}
                                    itemData={libraries}
                                >
                                    {Row}
                                </List>
                            )}
                        </AutoSizer>
                    ) : (
                        <div className="list-group-item text-muted">No libraries found</div>
                    )}
                </div>
            )}
        </div>
    );
};
