import React from 'react';

interface Props {
    message?: string;
}

export const LoadingOverlay: React.FC<Props> = ({ message }) => {
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
        </div>
    );
};
