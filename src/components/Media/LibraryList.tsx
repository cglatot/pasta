import React from 'react';
import type { PlexLibrary } from '../../types/plex';

interface Props {
    libraries: PlexLibrary[];
    selectedLibrary: PlexLibrary | null;
    onSelect: (lib: PlexLibrary) => void;
}

export const LibraryList: React.FC<Props> = ({ libraries, selectedLibrary, onSelect }) => {
    return (
        <div className="card shadow-sm mb-4">
            <div className="card-header bg-white">
                <h5 className="mb-0">Libraries</h5>
            </div>
            <div className="list-group list-group-flush" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {libraries.map(lib => (
                    <button
                        key={lib.key}
                        className={`list-group-item list-group-item-action ${selectedLibrary?.key === lib.key ? 'active' : ''}`}
                        onClick={() => onSelect(lib)}
                    >
                        {lib.title}
                    </button>
                ))}
            </div>
        </div>
    );
};
