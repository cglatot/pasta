import React from 'react';

interface Props {
    show: boolean;
    onAccept: (dontShowAgain: boolean) => void;
    onCancel: () => void;
}

export const WarningModal: React.FC<Props> = ({ show, onAccept, onCancel }) => {
    const [dontShowAgain, setDontShowAgain] = React.useState(false);

    // Reset checkbox when modal opens
    React.useEffect(() => {
        if (show) {
            setDontShowAgain(false);
        }
    }, [show]);

    if (!show) return null;

    return (
        <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content">
                    <div className="modal-header text-white" style={{ backgroundColor: '#212529' }}>
                        <h5 className="modal-title">
                            <i className="fas fa-exclamation-triangle me-2 text-warning"></i>
                            Warning: Library Mode
                        </h5>
                    </div>
                    <div className="modal-body">
                        <p className="fw-bold">You are about to enable Library Mode.</p>
                        <p>
                            This will apply your track selection to <strong>EVERY item in this library</strong>.
                        </p>
                        <div className="alert alert-danger">
                            <ul className="mb-0 small">
                                <li>This process runs entirely in your browser.</li>
                                <li>For large libraries, this <strong>will take a long time</strong>.</li>
                                <li><strong>Do not close this tab</strong> or refresh the page while it is running.</li>
                                <li>Your browser may become unresponsive during processing.</li>
                            </ul>
                        </div>
                        <p className="mb-0">Are you sure you want to proceed?</p>
                    </div>
                    <div className="modal-footer d-flex flex-column align-items-end">
                        <div className="d-flex justify-content-end w-100 gap-2 mb-2">
                            <button type="button" className="btn btn-secondary" onClick={onCancel}>
                                Cancel
                            </button>
                            <button type="button" className="btn btn-primary" onClick={() => onAccept(dontShowAgain)}>
                                I Understand, Enable Library Mode
                            </button>
                        </div>
                        <div className="d-flex align-items-center justify-content-end">
                            <label className="text-muted small me-2" htmlFor="dontShowAgain">
                                Do not show this message again
                            </label>
                            <input
                                className="form-check-input mt-0 ms-0"
                                type="checkbox"
                                id="dontShowAgain"
                                checked={dontShowAgain}
                                onChange={(e) => setDontShowAgain(e.target.checked)}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
