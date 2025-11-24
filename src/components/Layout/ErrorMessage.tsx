import React from 'react';

interface ErrorMessageProps {
    message: string;
    onDismiss?: () => void;
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({ message, onDismiss }) => {
    return (
        <div className="alert alert-danger alert-dismissible fade show" role="alert">
            <i className="fas fa-exclamation-circle me-2"></i>
            <strong>Error:</strong> {message}
            {onDismiss && (
                <button
                    type="button"
                    className="btn-close"
                    aria-label="Close"
                    onClick={onDismiss}
                ></button>
            )}
        </div>
    );
};
