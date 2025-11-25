import React from 'react';
import type { PlexStream } from '../../types/plex';

interface Props {
    streams: PlexStream[];
    onSelect: (streamId: number, scope: 'episode' | 'season' | 'show') => void;
    keyword: string;
    onKeywordChange: (keyword: string) => void;
    isMovie?: boolean;
}

export const SubtitleTable: React.FC<Props> = ({ streams, onSelect, keyword, onKeywordChange, isMovie = false }) => {
    const subtitleStreams = streams.filter(s => s.streamType === 3);
    const noneSelected = !subtitleStreams.some(s => s.selected);

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
            <div className="table-responsive">
                <table className="table table-hover mb-0">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Title</th>
                            <th>Language</th>
                            <th>Codec</th>
                            {!isMovie && <th>Actions</th>}
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            className={noneSelected ? 'table-active' : ''}
                        >
                            <td onClick={() => onSelect(0, 'episode')} style={{ cursor: 'pointer' }}>No Subtitles</td>
                            <td onClick={() => onSelect(0, 'episode')} style={{ cursor: 'pointer' }}>--</td>
                            <td onClick={() => onSelect(0, 'episode')} style={{ cursor: 'pointer' }}>--</td>
                            <td onClick={() => onSelect(0, 'episode')} style={{ cursor: 'pointer' }}>--</td>
                            {!isMovie && (
                                <td>
                                    <div className="btn-group btn-group-sm" role="group">
                                        <button
                                            className="btn btn-outline-secondary"
                                            onClick={(e) => { e.stopPropagation(); onSelect(0, 'season'); }}
                                            title="Apply to Season"
                                        >
                                            Season
                                        </button>
                                        <button
                                            className="btn btn-outline-secondary"
                                            onClick={(e) => { e.stopPropagation(); onSelect(0, 'show'); }}
                                            title="Apply to Show"
                                        >
                                            Show
                                        </button>
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
                                <td onClick={() => onSelect(stream.id, 'episode')} style={{ cursor: 'pointer' }}>
                                    {stream.language}
                                </td>
                                <td onClick={() => onSelect(stream.id, 'episode')} style={{ cursor: 'pointer' }}>
                                    {stream.codec}
                                </td>
                                {!isMovie && (
                                    <td>
                                        <div className="btn-group btn-group-sm" role="group">
                                            <button
                                                className="btn btn-outline-secondary"
                                                onClick={(e) => { e.stopPropagation(); onSelect(stream.id, 'season'); }}
                                                title="Apply to Season"
                                            >
                                                Season
                                            </button>
                                            <button
                                                className="btn btn-outline-secondary"
                                                onClick={(e) => { e.stopPropagation(); onSelect(stream.id, 'show'); }}
                                                title="Apply to Show"
                                            >
                                                Show
                                            </button>
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
