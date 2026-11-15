import React from 'react';
import { ModalDialog } from './ModalDialog';

interface Props {
    show: boolean;
    title?: string;
    message: string | null;
    onClose: () => void;
}

export const NoticeModal: React.FC<Props> = ({
    show,
    title = 'Batch Update Locked',
    message,
    onClose,
}) => {
    return (
        <ModalDialog show={Boolean(show && message)} onClose={onClose} closeOnBackdrop>
            <div className="modal-content">
                <div className="modal-header d-flex justify-content-between align-items-center">
                    <h5 className="modal-title mb-0">
                        <i className="fas fa-exclamation-triangle me-2 text-warning"></i>
                        {title}
                    </h5>
                    <button
                        type="button"
                        className="btn-close"
                        onClick={onClose}
                        aria-label="Close"
                    ></button>
                </div>
                <div className="modal-body">
                    <p className="mb-0 text-light">{message}</p>
                </div>
                <div className="modal-footer">
                    <button type="button" className="btn btn-primary" onClick={onClose}>
                        OK
                    </button>
                </div>
            </div>
        </ModalDialog>
    );
};
