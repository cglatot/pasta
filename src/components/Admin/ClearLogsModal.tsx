import React, { useState } from 'react';
import { ModalDialog } from '../Layout/ModalDialog';

export type ClearLogsRange = 'all' | '1h' | '12h' | '1d' | '1w' | '1m';

interface Props {
    show: boolean;
    title: string;
    isClearing?: boolean;
    onClose: () => void;
    onConfirm: (range: ClearLogsRange) => void;
}

const CLEAR_OPTIONS: Array<{ value: ClearLogsRange; label: string }> = [
    { value: 'all', label: 'All logs' },
    { value: '1h', label: 'Logs older than 1 hour' },
    { value: '12h', label: 'Logs older than 12 hours' },
    { value: '1d', label: 'Logs older than 1 day' },
    { value: '1w', label: 'Logs older than 1 week' },
    { value: '1m', label: 'Logs older than 1 month' },
];

export const ClearLogsModal: React.FC<Props> = ({
    show,
    title,
    isClearing = false,
    onClose,
    onConfirm,
}) => {
    const [selectedRange, setSelectedRange] = useState<ClearLogsRange>('all');

    return (
        <ModalDialog
            show={show}
            onClose={isClearing ? undefined : onClose}
            closeOnBackdrop={!isClearing}
        >
            <div className="modal-content">
                    <div className="modal-header">
                        <h5 className="modal-title">{title}</h5>
                        <button
                            type="button"
                            className="btn-close"
                            onClick={onClose}
                            disabled={isClearing}
                            aria-label="Close"
                        ></button>
                    </div>
                    <div className="modal-body">
                        <p className="small text-muted mb-3">
                            Select which log entries you want to permanently remove:
                        </p>
                        <div className="d-flex flex-column gap-2">
                            {CLEAR_OPTIONS.map(opt => {
                                const isSelected = selectedRange === opt.value;
                                return (
                                    <label
                                        key={opt.value}
                                        className="d-flex align-items-center gap-2 px-3 py-2 rounded hover-highlight"
                                        style={{
                                            cursor: 'pointer',
                                            border: isSelected
                                                ? '1px solid #F39C12'
                                                : '1px solid #444',
                                            backgroundColor: isSelected
                                                ? 'rgba(243, 156, 18, 0.1)'
                                                : 'transparent',
                                        }}
                                    >
                                        <input
                                            type="radio"
                                            name="clearLogsRange"
                                            className="form-check-input m-0"
                                            style={{ cursor: 'pointer' }}
                                            value={opt.value}
                                            checked={isSelected}
                                            onChange={() => setSelectedRange(opt.value)}
                                        />
                                        <span className="small text-light">{opt.label}</span>
                                    </label>
                                );
                            })}
                        </div>
                    </div>
                    <div className="modal-footer">
                        <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            onClick={onClose}
                            disabled={isClearing}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => onConfirm(selectedRange)}
                            disabled={isClearing}
                        >
                            {isClearing ? 'Clearing...' : 'Clear Logs'}
                        </button>
                </div>
            </div>
        </ModalDialog>
    );
};
