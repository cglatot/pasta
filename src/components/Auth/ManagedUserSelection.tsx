import React, { useState } from 'react';
import type { PlexHomeUser } from '../../types/plex';
import { LoadingOverlay } from '../Layout/LoadingOverlay';

interface Props {
    users: PlexHomeUser[];
    onSelect: (user: PlexHomeUser, pin?: string) => void;
    onCancel: () => void;
}

export const ManagedUserSelection: React.FC<Props> = ({ users, onSelect, onCancel }) => {
    const [selectedUser, setSelectedUser] = useState<PlexHomeUser | null>(null);
    const [pin, setPin] = useState('');
    const [error, setError] = useState('');
    const [switching, setSwitching] = useState(false);

    const handleUserClick = async (user: PlexHomeUser) => {
        if (user.protected) {
            setSelectedUser(user);
            setPin('');
            setError('');
        } else {
            setSwitching(true);
            await onSelect(user);
            setSwitching(false);
        }
    };

    const handlePinSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (selectedUser) {
            setSwitching(true);
            await onSelect(selectedUser, pin);
            setSwitching(false);
        }
    };

    return (
        <>
            {switching && <LoadingOverlay message="Switching user..." />}
            {selectedUser ? (
                <div className="card shadow-sm">
                    <div className="card-header bg-white d-flex justify-content-between align-items-center">
                        <h5 className="mb-0">Enter PIN for {selectedUser.username}</h5>
                        <button
                            className="btn btn-outline-secondary btn-sm"
                            onClick={() => setSelectedUser(null)}
                        >
                            Back
                        </button>
                    </div>
                    <div className="card-body">
                        <form onSubmit={handlePinSubmit}>
                            <div className="mb-3">
                                <input
                                    type="password"
                                    className="form-control form-control-lg text-center"
                                    placeholder="PIN"
                                    value={pin}
                                    onChange={(e) => setPin(e.target.value)}
                                    autoFocus
                                    maxLength={4}
                                />
                            </div>
                            {error && <div className="alert alert-danger">{error}</div>}
                            <div className="d-grid">
                                <button type="submit" className="btn btn-primary btn-lg">
                                    Enter
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            ) : (
                <div className="card shadow-sm">
                    <div className="card-header bg-white d-flex justify-content-between align-items-center">
                        <h5 className="mb-0">Select User</h5>
                        <button className="btn btn-outline-secondary btn-sm" onClick={onCancel}>
                            Cancel
                        </button>
                    </div>
                    <div className="list-group list-group-flush">
                        {users.map(user => (
                            <button
                                key={user.id}
                                className="list-group-item list-group-item-action d-flex align-items-center p-3"
                                onClick={() => handleUserClick(user)}
                            >
                                <img
                                    src={user.thumb}
                                    alt={user.username}
                                    className="rounded-circle me-3"
                                    style={{ width: 40, height: 40, objectFit: 'cover' }}
                                />
                                <div className="flex-grow-1">
                                    <div className="fw-bold">{user.title || user.username}</div>
                                    {user.email && <small className="text-muted">{user.email}</small>}
                                </div>
                                {user.protected && (
                                    <i className="fas fa-lock text-warning"></i>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </>
    );
};
