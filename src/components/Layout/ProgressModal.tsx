import React, { useState } from 'react';
import type { DetailedProgressState } from '../../types/batchTypes';

interface Props {
    show: boolean;
    title: string;
    progress: DetailedProgressState;
    onClose?: () => void;
}

export const ProgressModal: React.FC<Props> = ({ show, title, progress, onClose }) => {
    const [showChanged, setShowChanged] = useState(false); // Start collapsed
    const [showSkipped, setShowSkipped] = useState(false); // Start collapsed

    if (!show) return null;

    const percentage = progress.total > 0
        ? Math.round((progress.current / progress.total) * 100)
        : 0;

    const isComplete = !progress.isProcessing && progress.current === progress.total && progress.total > 0;

    const changedEpisodes = progress.results.filter(r => r.success);
    const skippedEpisodes = progress.results.filter(r => !r.success);

    const formatEpisodeTitle = (result: typeof progress.results[0]) => {
        if (result.seasonNumber !== undefined && result.episodeNumber !== undefined) {
            return `S${result.seasonNumber}E${result.episodeNumber} - ${result.episodeTitle}`;
        }
        return result.episodeTitle;
    };

    return (
        <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <div className="modal-dialog modal-dialog-centered modal-lg">
                <div className="modal-content">
                    <div className="modal-header">
                        <h5 className="modal-title">{isComplete ? 'Update Complete' : title}</h5>
                        {isComplete && onClose && (
                            <button type="button" className="btn-close" onClick={onClose} aria-label="Close"></button>
                        )}
                    </div>
                    <div className="modal-body">
                        {!isComplete && (
                            <>
                                <div className="progress mb-3" style={{ height: '25px' }}>
                                    <div
                                        className="progress-bar progress-bar-striped progress-bar-animated"
                                        role="progressbar"
                                        style={{ width: `${percentage}%` }}
                                        aria-valuenow={percentage}
                                        aria-valuemin={0}
                                        aria-valuemax={100}
                                    >
                                        {percentage}%
                                    </div>
                                </div>
                                <p className="text-center mb-0">{progress.statusMessage}</p>
                                <div className="text-center mt-2 text-muted small">
                                    Processed: {progress.current} / {progress.total}
                                </div>
                            </>
                        )}

                        {isComplete && (
                            <div>
                                <div className="alert alert-success mb-3">
                                    <strong>Completed!</strong> {progress.success} episode{progress.success !== 1 ? 's' : ''} updated, {progress.failed} skipped
                                </div>

                                {/* Changed Episodes */}
                                {changedEpisodes.length > 0 && (
                                    <div className="mb-3">
                                        <button
                                            className="btn btn-link p-0 text-decoration-none w-100 text-start d-flex justify-content-between align-items-center"
                                            onClick={() => setShowChanged(!showChanged)}
                                        >
                                            <h6 className="mb-0">
                                                <i className={`fas fa-chevron-${showChanged ? 'down' : 'right'} me-2`}></i>
                                                Changed Episodes ({changedEpisodes.length})
                                            </h6>
                                        </button>
                                        {showChanged && (
                                            <div className="mt-2" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                                                <ul className="list-group list-group-flush">
                                                    {changedEpisodes.map((result, idx) => (
                                                        <li key={idx} className="list-group-item px-2 py-2">
                                                            <div className="d-flex justify-content-between align-items-start">
                                                                <div className="flex-grow-1">
                                                                    <div className="fw-bold small">{formatEpisodeTitle(result)}</div>
                                                                    <div className="text-muted small">
                                                                        → {result.streamName}
                                                                    </div>
                                                                </div>
                                                                <span className="badge bg-success text-white small ms-2">
                                                                    {result.matchReason}
                                                                </span>
                                                            </div>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Skipped Episodes */}
                                {skippedEpisodes.length > 0 && (
                                    <div className="mb-3">
                                        <button
                                            className="btn btn-link p-0 text-decoration-none w-100 text-start d-flex justify-content-between align-items-center"
                                            onClick={() => setShowSkipped(!showSkipped)}
                                        >
                                            <h6 className="mb-0">
                                                <i className={`fas fa-chevron-${showSkipped ? 'down' : 'right'} me-2`}></i>
                                                Skipped Episodes ({skippedEpisodes.length})
                                            </h6>
                                        </button>
                                        {showSkipped && (
                                            <div className="mt-2" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                                                <ul className="list-group list-group-flush">
                                                    {skippedEpisodes.map((result, idx) => {
                                                        let badgeText = '';
                                                        let badgeClass = 'bg-warning';

                                                        if (result.skipReason === 'NoMatch') {
                                                            badgeText = 'No Match';
                                                            badgeClass = 'bg-warning';
                                                        } else if (result.skipReason === 'AlreadyMatched') {
                                                            badgeText = 'Already Set';
                                                            badgeClass = 'bg-warning';
                                                        } else if (result.skipReason === 'KeywordFiltered') {
                                                            badgeText = 'No Match (Keyword)';
                                                            badgeClass = 'bg-warning';
                                                        } else if (result.skipReason === 'Error') {
                                                            badgeText = 'Error';
                                                            badgeClass = 'bg-danger';
                                                        }

                                                        return (
                                                            <li
                                                                key={idx}
                                                                className="list-group-item px-2 py-2"
                                                            >
                                                                <div className="d-flex justify-content-between align-items-start">
                                                                    <div className="flex-grow-1">
                                                                        <div className="fw-bold small">{formatEpisodeTitle(result)}</div>
                                                                        {result.skipReason === 'AlreadyMatched' && result.streamName && (
                                                                            <div className="text-muted small">
                                                                                → {result.streamName}
                                                                            </div>
                                                                        )}
                                                                        {result.skipReason === 'Error' && result.errorMessage && (
                                                                            <div className="text-danger small">
                                                                                {result.errorMessage}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                    <span className={`badge ${badgeClass} text-white small ms-2`}>
                                                                        {badgeText}
                                                                    </span>
                                                                </div>
                                                            </li>
                                                        );
                                                    })}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    {isComplete && onClose && (
                        <div className="modal-footer">
                            <button type="button" className="btn btn-primary" onClick={onClose}>
                                Close
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
