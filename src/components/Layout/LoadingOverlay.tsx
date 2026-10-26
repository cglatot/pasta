import React, { useState, useEffect } from 'react';
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll';

interface Props {
    message?: string;
    onChangeServer?: () => void;
    onCancel?: () => void;
}

export const LoadingOverlay: React.FC<Props> = ({ message, onChangeServer, onCancel }) => {
    useLockBodyScroll(true);
    const [showCancel, setShowCancel] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => {
            setShowCancel(true);
        }, 3000);
        return () => clearTimeout(timer);
    }, []);

    const handleAction = onChangeServer || onCancel;

    return (
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 9999,
            }}
        >
            <div className="spinner-border text-warning" role="status" style={{ width: '3rem', height: '3rem' }}>
                <span className="visually-hidden">Loading...</span>
            </div>
            {message && (
                <p className="text-white mt-3 fs-5">{message}</p>
            )}
            {showCancel && handleAction && (
                <div className="mt-3">
                    <button
                        type="button"
                        className="btn btn-outline-light btn-sm"
                        onClick={handleAction}
                    >
                        <i className="fas fa-server me-2"></i>
                        {onChangeServer ? 'Change Server' : 'Cancel'}
                    </button>
                </div>
            )}
        </div>
    );
};
