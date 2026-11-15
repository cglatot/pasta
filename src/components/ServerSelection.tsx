import React, { useState } from 'react';
import { usePlexServer } from '../hooks/usePlexServer';
import { LoadingOverlay } from './Layout/LoadingOverlay';
import type { PlexResource } from '../types/plex';

interface Props {
    onConnect: () => void;
    onOpenAdminSettings?: (machineIdentifier: string) => void;
}

export const ServerSelection: React.FC<Props> = ({ onConnect, onOpenAdminSettings }) => {
    const { servers, loading, connecting, error, connectToServer, cancelConnect } = usePlexServer();
    const [useLocalAddress, setUseLocalAddress] = useState(() => {
        const stored = localStorage.getItem('useLocalAddress');
        return stored === null ? true : stored === 'true';
    });

    const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const checked = e.target.checked;
        setUseLocalAddress(checked);
        localStorage.setItem('useLocalAddress', checked ? 'true' : 'false');
    };

    const handleConnect = async (server: PlexResource) => {
        const success = await connectToServer(server, useLocalAddress);
        if (success) {
            onConnect();
        }
    };

    if (loading) {
        return <div className="text-center"><div className="spinner-border" /></div>;
    }

    return (
        <>
            {connecting && (
                <LoadingOverlay
                    message="Connecting to server..."
                    onCancel={cancelConnect}
                />
            )}
            <div className="card shadow-sm">
                <div className="card-header bg-white">
                    <h5 className="mb-0">Select Plex Server</h5>
                </div>
                <div className="list-group list-group-flush">
                    {servers.map(server => {
                        const canAdminServer =
                            Boolean(server.isMonitored) &&
                            (server.pastaRole === 'owner' || server.pastaRole === 'admin');

                        return (
                            <div
                                key={server.clientIdentifier}
                                role="button"
                                tabIndex={0}
                                className="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
                                onClick={() => {
                                    if (!connecting) {
                                        void handleConnect(server);
                                    }
                                }}
                                onKeyDown={e => {
                                    if ((e.key === 'Enter' || e.key === ' ') && !connecting) {
                                        e.preventDefault();
                                        void handleConnect(server);
                                    }
                                }}
                                style={{ cursor: connecting ? 'not-allowed' : 'pointer' }}
                            >
                                <div className="d-flex align-items-center gap-2">
                                    <span>{server.name}</span>
                                    {server.productVersion && (
                                        <span className="badge bg-secondary rounded-pill">
                                            {server.productVersion}
                                        </span>
                                    )}
                                </div>
                                {canAdminServer && onOpenAdminSettings && (
                                    <button
                                        type="button"
                                        className="btn btn-outline-primary btn-sm"
                                        onClick={e => {
                                            e.stopPropagation();
                                            onOpenAdminSettings(server.clientIdentifier);
                                        }}
                                        disabled={connecting}
                                    >
                                        Admin Settings
                                    </button>
                                )}
                            </div>
                        );
                    })}
                    {servers.length === 0 && (
                        <div className="list-group-item text-muted">No servers found.</div>
                    )}
                </div>
                <div className="card-footer bg-light">
                    <div className="form-check">
                        <input
                            className="form-check-input"
                            type="checkbox"
                            id="useLocalAddress"
                            checked={useLocalAddress}
                            onChange={handleCheckboxChange}
                        />
                        <label className="form-check-label" htmlFor="useLocalAddress">
                            Prefer Local Address
                        </label>
                    </div>
                    {error && <div className="text-danger mt-2">{error}</div>}
                </div>
            </div>
        </>
    );
};
