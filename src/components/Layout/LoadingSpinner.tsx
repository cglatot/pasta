import React from 'react';

interface LoadingSpinnerProps {
    fullPage?: boolean;
    overlay?: boolean;
    message?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ 
    fullPage = false, 
    overlay = false,
    message = 'Loading...' 
}) => {
    const containerStyle: React.CSSProperties = fullPage 
        ? {
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            zIndex: 1050,
            backgroundColor: 'rgba(25, 25, 25, 0.8)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            flexDirection: 'column'
          }
        : overlay 
            ? {
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                zIndex: 10,
                backgroundColor: 'rgba(25, 25, 25, 0.7)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                flexDirection: 'column',
                minHeight: '200px'
              }
            : {
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                padding: '2rem',
                flexDirection: 'column'
              };

    return (
        <div style={containerStyle}>
            <div className="spinner-border text-primary" role="status" style={{ width: '3rem', height: '3rem' }}>
                <span className="visually-hidden">{message}</span>
            </div>
            {message && <div className="mt-3 text-muted">{message}</div>}
        </div>
    );
};
