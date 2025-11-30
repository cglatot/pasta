import React, { useState } from 'react';
import type { DetailedProgressState, EpisodeResult } from '../../types/batchTypes';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';

interface Props {
    show: boolean;
    title: string;
    progress: DetailedProgressState;
    onClose?: () => void;
}

export const ProgressModal: React.FC<Props> = ({ show, title, progress, onClose }) => {
    const [expandedSection, setExpandedSection] = useState<'changed' | 'skipped' | null>(null);

    if (!show) return null;

    const percentage = progress.total > 0
        ? Math.round((progress.current / progress.total) * 100)
        : 0;

    const isComplete = !progress.isProcessing && progress.current === progress.total && progress.total > 0;

    const changedEpisodes = progress.results.filter(r => r.success);
    const skippedEpisodes = progress.results.filter(r => !r.success);

    const itemLabel = progress.itemType === 'movie' ? 'Movies' : 'Episodes';
    const itemLabelSingular = progress.itemType === 'movie' ? 'Movie' : 'Episode';

    const formatEpisodeTitle = (result: EpisodeResult) => {
        if (result.seasonNumber !== undefined && result.episodeNumber !== undefined) {
            return `S${result.seasonNumber}E${result.episodeNumber} - ${result.episodeTitle}`;
        }
        return result.episodeTitle;
    };

    // Virtualized Row for Changed Items
    const ChangedRow = ({ index, style, data }: ListChildComponentProps<EpisodeResult[]>) => {
        const result = data[index];
        return (
            <div style={style} className="px-2 py-2 border-bottom cursor-default hover-highlight">
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
            </div>
        );
    };

    // Virtualized Row for Skipped Items
    const SkippedRow = ({ index, style, data }: ListChildComponentProps<EpisodeResult[]>) => {
        const result = data[index];
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
            <div style={style} className="px-2 py-2 border-bottom cursor-default hover-highlight">
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
                    <span className={`badge ${badgeClass} text-dark small ms-2`}>
                        {badgeText}
                    </span>
                </div>
            </div>
        );
    };

    return (
        <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <div className="modal-dialog modal-dialog-centered modal-lg">
                <div className="modal-content" style={{ maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
                    <div className="modal-header">
                        <h5 className="modal-title">{isComplete ? 'Update Complete' : title}</h5>
                        {isComplete && onClose && (
                            <button type="button" className="btn-close" onClick={onClose} aria-label="Close"></button>
                        )}
                    </div>
                    <div className="modal-body d-flex flex-column" style={{ overflow: 'hidden', minHeight: 0 }}>
                        {!isComplete && (
                            <>
                                <div className="progress mb-3" style={{ height: '25px' }}>
                                    <div
                                        className="progress-bar progress-bar-striped progress-bar-animated bg-warning"
                                        role="progressbar"
                                        style={{ width: `${percentage}%`, color: 'black', fontWeight: 'bold' }}
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
                            <div className="d-flex flex-column flex-grow-1" style={{ minHeight: 0 }}>
                                <div className="alert alert-success mb-3 flex-shrink-0">
                                    <strong>Completed!</strong> {progress.success} {progress.success !== 1 ? itemLabel.toLowerCase() : itemLabelSingular.toLowerCase()} updated, {progress.failed} skipped
                                </div>

                                {/* Changed Items */}
                                {changedEpisodes.length > 0 && (
                                    <div className="mb-3 d-flex flex-column" style={{ flex: expandedSection === 'changed' ? '1 1 auto' : '0 0 auto', minHeight: 0 }}>
                                        <button
                                            className="btn btn-link p-0 text-decoration-none w-100 text-start d-flex justify-content-between align-items-center text-warning flex-shrink-0"
                                            onClick={() => setExpandedSection(expandedSection === 'changed' ? null : 'changed')}
                                        >
                                            <h6 className="mb-0">
                                                <i className={`fas fa-chevron-${expandedSection === 'changed' ? 'down' : 'right'} me-2`}></i>
                                                Changed {itemLabel} ({changedEpisodes.length})
                                            </h6>
                                        </button>
                                        {expandedSection === 'changed' && (
                                            <div className="mt-2" style={{ height: changedEpisodes.length * 60, minHeight: 0, flex: '1 1 auto', overflow: 'hidden' }}>
                                                <AutoSizer>
                                                    {({ height, width }) => (
                                                        <List
                                                            height={height}
                                                            itemCount={changedEpisodes.length}
                                                            itemSize={60}
                                                            width={width}
                                                            itemData={changedEpisodes}
                                                        >
                                                            {ChangedRow}
                                                        </List>
                                                    )}
                                                </AutoSizer>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Skipped Items */}
                                {skippedEpisodes.length > 0 && (
                                    <div className="mb-3 d-flex flex-column" style={{ flex: expandedSection === 'skipped' ? '1 1 auto' : '0 0 auto', minHeight: 0 }}>
                                        <button
                                            className="btn btn-link p-0 text-decoration-none w-100 text-start d-flex justify-content-between align-items-center text-warning flex-shrink-0"
                                            onClick={() => setExpandedSection(expandedSection === 'skipped' ? null : 'skipped')}
                                        >
                                            <h6 className="mb-0">
                                                <i className={`fas fa-chevron-${expandedSection === 'skipped' ? 'down' : 'right'} me-2`}></i>
                                                Skipped {itemLabel} ({skippedEpisodes.length})
                                            </h6>
                                        </button>
                                        {expandedSection === 'skipped' && (
                                            <div className="mt-2" style={{ height: skippedEpisodes.length * 60, minHeight: 0, flex: '1 1 auto', overflow: 'hidden' }}>
                                                <AutoSizer>
                                                    {({ height, width }) => (
                                                        <List
                                                            height={height}
                                                            itemCount={skippedEpisodes.length}
                                                            itemSize={60}
                                                            width={width}
                                                            itemData={skippedEpisodes}
                                                        >
                                                            {SkippedRow}
                                                        </List>
                                                    )}
                                                </AutoSizer>
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
