import React, { useState, useEffect } from 'react';
import type { DetailedProgressState, EpisodeResult } from '../../types/batchTypes';
import { VirtualList, type VirtualListRowProps } from './VirtualList';
import { ModalDialog } from './ModalDialog';

interface Props {
    show: boolean;
    title: string;
    progress: DetailedProgressState;
    onClose?: () => void;
    onCancel?: () => void;
    onMinimize?: () => void;
    onCancelQueuedJob?: (jobId: string) => void;
}

export const ProgressModal: React.FC<Props> = ({
    show,
    title,
    progress,
    onClose,
    onCancel,
    onMinimize,
    onCancelQueuedJob,
}) => {
    const [expandedSection, setExpandedSection] = useState<'changed' | 'skipped' | null>(null);

    // Reset expanded sections whenever modal is closed or a new process starts,
    // so sections always start collapsed by default
    useEffect(() => {
        if (!show || progress.isProcessing) {
            setExpandedSection(null);
        }
    }, [show, progress.isProcessing]);

    if (!show) return null;

    const percentage = progress.total > 0
        ? Math.round((progress.current / progress.total) * 100)
        : 0;

    const isComplete = !progress.isProcessing && progress.total > 0;

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
    const ChangedRow = ({ style, data }: VirtualListRowProps<EpisodeResult>) => {
        const result = data;
        if (!result) return null;
        return (
            <div style={style} className="px-2 py-2 border-bottom cursor-default hover-highlight">
                <div className="d-flex justify-content-between align-items-start">
                    <div className="flex-grow-1">
                        <div className="fw-bold small">{formatEpisodeTitle(result)}</div>
                        <div className="text-muted small">
                            {result.previousStreamName ? `${result.previousStreamName} → ` : '→ '}{result.streamName}
                            {result.totalUsersCount && result.totalUsersCount > 1 && (
                                <span className="ms-2 text-warning">
                                    (Updated for {result.updatedUsersCount ?? result.totalUsersCount}/{result.totalUsersCount} users)
                                </span>
                            )}
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
    const SkippedRow = ({ style, data }: VirtualListRowProps<EpisodeResult>) => {
        const result = data;
        if (!result) return null;
        let badgeText = '';
        let badgeClass = 'bg-warning text-dark';

        if (result.skipReason === 'NoMatch') {
            badgeText = 'No Match';
            badgeClass = 'bg-danger text-white';
        } else if (result.skipReason === 'AlreadyMatched') {
            badgeText = 'Already Set';
            badgeClass = 'bg-warning text-dark';
        } else if (result.skipReason === 'KeywordFiltered') {
            badgeText = 'No Match (Keyword)';
            badgeClass = 'bg-danger text-white';
        } else if (result.skipReason === 'Error') {
            badgeText = 'Error';
            badgeClass = 'bg-danger text-white';
        }

        const isNoMatch = result.skipReason === 'NoMatch' || result.skipReason === 'KeywordFiltered';
        const streamDisplay = result.skipReason === 'AlreadyMatched'
            ? result.streamName
            : (isNoMatch ? result.previousStreamName : null);

        return (
            <div style={style} className="px-2 py-2 border-bottom cursor-default hover-highlight">
                <div className="d-flex justify-content-between align-items-start">
                    <div className="flex-grow-1">
                        <div className="fw-bold small">{formatEpisodeTitle(result)}</div>
                        {streamDisplay && (
                            <div className="text-muted small">
                                → {streamDisplay}
                                {result.totalUsersCount && result.totalUsersCount > 1 && (
                                    <span className="ms-2">
                                        (All {result.totalUsersCount} users)
                                    </span>
                                )}
                            </div>
                        )}
                        {result.skipReason === 'Error' && result.errorMessage && (
                            <div className="text-danger small">
                                {result.errorMessage}
                            </div>
                        )}
                    </div>
                    <span className={`badge ${badgeClass} small ms-2`}>
                        {badgeText}
                    </span>
                </div>
            </div>
        );
    };

    const handleHeaderClose = () => {
        if (isComplete && onClose) {
            onClose();
        } else if (progress.isProcessing && onMinimize) {
            onMinimize();
        }
    };

    const canDismiss = Boolean((isComplete && onClose) || (progress.isProcessing && onMinimize));

    return (
        <ModalDialog
            show={show}
            dialogClassName="modal-lg"
            onClose={canDismiss ? handleHeaderClose : undefined}
        >
            <div className="modal-content" style={{ maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
                    <div className="modal-header">
                        <h5 className="modal-title">{isComplete ? 'Update Complete' : title}</h5>
                        {((isComplete && onClose) || (progress.isProcessing && onMinimize)) && (
                            <button
                                type="button"
                                className="btn-close"
                                onClick={handleHeaderClose}
                                aria-label="Close"
                            ></button>
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
                                    {progress.targetUsersSummary && (
                                        <span className="ms-2">• Target: {progress.targetUsersSummary}</span>
                                    )}
                                </div>

                                {progress.queuedJobs && progress.queuedJobs.length > 0 && (
                                    <div className="mt-4 pt-3 border-top border-secondary">
                                        <h6 className="mb-2 text-warning small fw-bold">
                                            Queued Jobs ({progress.queuedJobs.length})
                                        </h6>
                                        <div
                                            className="d-flex flex-column gap-2"
                                            style={{ maxHeight: '180px', overflowY: 'auto' }}
                                        >
                                            {progress.queuedJobs.map((qJob, idx) => (
                                                <div
                                                    key={qJob.jobId}
                                                    className="d-flex justify-content-between align-items-center px-2 py-2 rounded border border-secondary"
                                                    style={{ backgroundColor: 'rgba(255, 255, 255, 0.03)' }}
                                                >
                                                    <div className="flex-grow-1 me-2">
                                                        <div className="fw-bold small">
                                                            #{idx + 1} • {qJob.targetTitle}{' '}
                                                            <span className="badge bg-secondary ms-1 text-capitalize">
                                                                {qJob.scope}
                                                            </span>
                                                        </div>
                                                        <div className="text-muted small">
                                                            {qJob.streamType === 'audio'
                                                                ? 'Audio'
                                                                : 'Subtitle'}
                                                            : {qJob.streamName}
                                                            {qJob.targetUsersSummary
                                                                ? ` • Target: ${qJob.targetUsersSummary}`
                                                                : ''}
                                                        </div>
                                                    </div>
                                                    {onCancelQueuedJob && (
                                                        <button
                                                            type="button"
                                                            className="btn btn-outline-danger btn-sm py-0 px-2"
                                                            onClick={() =>
                                                                onCancelQueuedJob(qJob.jobId)
                                                            }
                                                            title="Remove from queue"
                                                        >
                                                            Cancel
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}

                        {isComplete && (
                            <div className="d-flex flex-column flex-grow-1" style={{ minHeight: 0 }}>
                                <div className="alert alert-success mb-3 flex-shrink-0">
                                    <strong>Completed!</strong> {progress.success} {progress.success !== 1 ? itemLabel.toLowerCase() : itemLabelSingular.toLowerCase()} updated, {progress.failed} skipped
                                    {progress.targetUsersSummary && (
                                        <span className="ms-2 small">({progress.targetUsersSummary})</span>
                                    )}
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
                                                <VirtualList
                                                    items={changedEpisodes}
                                                    itemHeight={60}
                                                >
                                                    {ChangedRow}
                                                </VirtualList>
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
                                                <VirtualList
                                                    items={skippedEpisodes}
                                                    itemHeight={60}
                                                >
                                                    {SkippedRow}
                                                </VirtualList>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    {progress.isProcessing && onCancel && (
                        <div className="modal-footer d-flex justify-content-between align-items-center">
                            <span className="text-muted small">
                                {onMinimize ? 'Batch update in progress on server...' : 'Batch update in progress...'}
                            </span>
                            <div className="d-flex gap-2">
                                {onMinimize && (
                                    <button
                                        type="button"
                                        className="btn btn-outline-secondary"
                                        onClick={onMinimize}
                                    >
                                        Minimize
                                    </button>
                                )}
                                <button type="button" className="btn btn-outline-danger" onClick={onCancel}>
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                    {isComplete && onClose && (
                        <div className="modal-footer">
                            <button type="button" className="btn btn-primary" onClick={onClose}>
                                Close
                            </button>
                        </div>
                    )}
                </div>
        </ModalDialog>
    );
};
