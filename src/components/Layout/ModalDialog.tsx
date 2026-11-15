import React, { useEffect } from 'react';
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll';

interface ModalDialogProps {
    show: boolean;
    onClose?: () => void;
    closeOnBackdrop?: boolean;
    dialogClassName?: string;
    ariaLabelledBy?: string;
    zIndex?: number;
    children: React.ReactNode;
}

export const ModalDialog: React.FC<ModalDialogProps> = ({
    show,
    onClose,
    closeOnBackdrop = false,
    dialogClassName = '',
    ariaLabelledBy,
    zIndex = 1055,
    children,
}) => {
    useLockBodyScroll(show);

    useEffect(() => {
        if (!show || !onClose) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [show, onClose]);

    if (!show) return null;

    return (
        <div
            className="modal show d-block"
            role="dialog"
            aria-modal="true"
            aria-labelledby={ariaLabelledBy}
            tabIndex={-1}
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.55)', zIndex }}
            onClick={
                closeOnBackdrop && onClose
                    ? e => {
                          if (
                              e.target === e.currentTarget ||
                              (e.target as HTMLElement).classList.contains('modal-dialog')
                          ) {
                              onClose();
                          }
                      }
                    : undefined
            }
        >
            <div className={`modal-dialog modal-dialog-centered ${dialogClassName}`.trim()}>
                {children}
            </div>
        </div>
    );
};
