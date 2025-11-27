import React from 'react';
import type { PlexStream } from '../../types/plex';
import { useIsMobile } from '../../hooks/useIsMobile';

interface Props {
    streams: PlexStream[];
    onSelect: (streamId: number, scope: 'episode' | 'season' | 'show' | 'library') => void;
    keyword: string;
    onKeywordChange: (keyword: string) => void;
    isMovie?: boolean;
    isLibraryMode?: boolean;
}

export const SubtitleTable: React.FC<Props> = ({ streams, onSelect, keyword, onKeywordChange, isMovie = false, isLibraryMode = false }) => {
    const subtitleStreams = streams.filter(s => s.streamType === 3);
    const noneSelected = !subtitleStreams.some(s => s.selected);
    const isMobile = useIsMobile();

    return (
        <div className="card shadow-sm mb-4">
            <div className="card-header bg-white">
                <h5 className="mb-0">Subtitle Tracks</h5>
            </div>
            <div className="card-body bg-light border-bottom pt-2 pb-3">
                <div className="form-group mb-0">
                    <label htmlFor="subtitleKeyword" className="form-label fw-bold small">Subtitle Keyword</label>
                    <input
                        type="text"
                        className="form-control form-control-sm"
                        id="subtitleKeyword"
                        placeholder="Enter keyword to match subtitles (e.g. 'Forced')"
                        value={keyword}
                        onChange={(e) => onKeywordChange(e.target.value)}
                    />
                    <div className="form-text small">Only match subtitle tracks containing this keyword.</div>
                </div>
            </div>
            <div className="table-responsive" style={isMobile ? {
                scrollbarWidth: 'thin',
                scrollbarColor: '#888 #f1f1f1'
            } : undefined}>
                <style>{`
                    ${isMobile ? `
                        .table-responsive::-webkit-scrollbar {
                            height: 4px;
                        }
                        .table-responsive::-webkit-scrollbar-track {
                            background: #f1f1f1;
                        }
                        .table-responsive::-webkit-scrollbar-thumb {
                            background: #888;
                            border-radius: 2px;
                        }
                    ` : ''}
                `}</style>
                <table className="table table-hover mb-0">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Title</th>
                            {!isMobile && <th>Language</th>}
                            {!isMobile && <th>Codec</th>}
                            {(isLibraryMode || !isMovie) && <th>Actions</th>}
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            className={noneSelected ? 'table-active' : ''}
                        >
                            <td onClick={() => onSelect(0, 'episode')} style={{ cursor: 'pointer' }}>No Subtitles</td>
                            <td onClick={() => onSelect(0, 'episode')} style={{ cursor: 'pointer' }}>--</td>
                            {!isMobile && <td onClick={() => onSelect(0, 'episode')} style={{ cursor: 'pointer' }}>--</td>}
                            {!isMobile && <td onClick={() => onSelect(0, 'episode')} style={{ cursor: 'pointer' }}>--</td>}
                            {(isLibraryMode || !isMovie) && (
                                <td>
                                    <div className={isMobile ? 'btn-group-vertical btn-group-sm' : 'btn-group btn-group-sm'} role="group">
                                        {isLibraryMode ? (
                                            <button
                                                className="btn btn-primary btn-sm"
                                                onClick={(e) => { e.stopPropagation(); onSelect(0, 'library'); }}
                                                title="Apply to Entire Library"
                                                style={isMobile ? { textAlign: 'center' } : undefined}
                                            >
                                                Library
                                            </button>
                                        ) : (
                                            <>
                                                <button
                                                    className="btn btn-outline-primary btn-sm"
                                                    onClick={(e) => { e.stopPropagation(); onSelect(0, 'season'); }}
                                                    title="Apply to Season"
                                                    style={isMobile ? { textAlign: 'center' } : undefined}
                                                >
                                                    Season
                                                </button>
                                                <button
                                                    className="btn btn-outline-primary btn-sm"
                                                    onClick={(e) => { e.stopPropagation(); onSelect(0, 'show'); }}
                                                    title="Apply to Show"
                                                    style={isMobile ? { textAlign: 'center' } : undefined}
                                                >
                                                    Show
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </td>
                            )}
                        </tr>
                        {subtitleStreams.map(stream => (
                            <tr
                                key={stream.id}
                                className={stream.selected ? 'table-active' : ''}
                            >
                                <td onClick={() => onSelect(stream.id, 'episode')} style={{ cursor: 'pointer' }}>
                                    {stream.displayTitle || stream.title}
                                </td>
                                <td onClick={() => onSelect(stream.id, 'episode')} style={{ cursor: 'pointer' }}>
                                    {stream.title}
                                </td>
                                {!isMobile && (
                                    <td onClick={() => onSelect(stream.id, 'episode')} style={{ cursor: 'pointer' }}>
                                        {stream.language}
                                    </td>
                                )}
                                {!isMobile && (
                                    <td onClick={() => onSelect(stream.id, 'episode')} style={{ cursor: 'pointer' }}>
                                        {stream.codec}
                                    </td>
                                )}
                                {(isLibraryMode || !isMovie) && (
                                    <td>
                                        <div className={isMobile ? 'btn-group-vertical btn-group-sm' : 'btn-group btn-group-sm'} role="group">
                                            {isLibraryMode ? (
                                                <button
                                                    className="btn btn-primary btn-sm"
                                                    onClick={(e) => { e.stopPropagation(); onSelect(stream.id, 'library'); }}
                                                    title="Apply to Entire Library"
                                                    style={isMobile ? { textAlign: 'center' } : undefined}
                                                >
                                                    Library
                                                </button>
                                            ) : (
                                                <>
                                                    <button
                                                        className="btn btn-outline-primary btn-sm"
                                                        onClick={(e) => { e.stopPropagation(); onSelect(stream.id, 'season'); }}
                                                        title="Apply to Season"
                                                        style={isMobile ? { textAlign: 'center' } : undefined}
                                                    >
                                                        Season
                                                    </button>
                                                    <button
                                                        className="btn btn-outline-primary btn-sm"
                                                        onClick={(e) => { e.stopPropagation(); onSelect(stream.id, 'show'); }}
                                                        title="Apply to Show"
                                                        style={isMobile ? { textAlign: 'center' } : undefined}
                                                    >
                                                        Show
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
