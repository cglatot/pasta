import React from 'react';
import { useSettings } from '../../context/SettingsContext';

interface Props {
    show: boolean;
    onClose: () => void;
}

export const SettingsModal: React.FC<Props> = ({ show, onClose }) => {
    const { autoCollapse, setAutoCollapse, maxListItems, setMaxListItems } = useSettings();

    if (!show) return null;

    return (
        <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content">
                    <div className="modal-header">
                        <h5 className="modal-title">Settings</h5>
                        <button type="button" className="btn-close" onClick={onClose} aria-label="Close"></button>
                    </div>
                    <div className="modal-body">
                        {/* Auto-Collapse Setting */}
                        <div className="mb-4">
                            <div className="form-check form-switch">
                                <input
                                    className="form-check-input"
                                    type="checkbox"
                                    id="autoCollapseSwitch"
                                    checked={autoCollapse}
                                    onChange={(e) => setAutoCollapse(e.target.checked)}
                                />
                                <label className="form-check-label fw-bold" htmlFor="autoCollapseSwitch">
                                    Auto-collapse Navigation
                                </label>
                            </div>
                            <div className="form-text">
                                When enabled, making a selection (like a Library) will automatically collapse that section and show the new section (like on the Mobile UI)
                            </div>
                        </div>

                        {/* Max List Items Setting */}
                        <div className="mb-3">
                            <label htmlFor="maxListItemsInput" className="form-label fw-bold">
                                Max List Items
                            </label>
                            <div className="d-flex align-items-center">
                                <input
                                    type="range"
                                    className="form-range flex-grow-1 me-3"
                                    min="1"
                                    max="30"
                                    step="1"
                                    id="maxListItemsRange"
                                    value={maxListItems}
                                    onChange={(e) => setMaxListItems(parseInt(e.target.value))}
                                />
                                <span className="badge bg-warning text-dark" style={{ minWidth: '40px' }}>
                                    {maxListItems}
                                </span>
                            </div>
                            <div className="form-text">
                                Controls how many items are visible in the selection lists before scrolling is required.
                            </div>
                        </div>
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="btn btn-primary" onClick={onClose}>
                            Done
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
