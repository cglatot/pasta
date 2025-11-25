import React, { useState, useEffect } from 'react';
import { usePlexServer } from '../hooks/usePlexServer';
import { LoadingOverlay } from './Layout/LoadingOverlay';
import type { PlexResource } from '../types/plex';

interface Props {
    onConnect: () => void;
}

export const ServerSelection: React.FC<Props> = ({ onConnect }) => {
    const { servers, loading, connecting, error, connectToServer } = usePlexServer();
    const [useLocalAddress, setUseLocalAddress] = useState(false);

    useEffect(() => {
        const stored = localStorage.getItem('useLocalAddress');
        if (stored === 'true') {
            setUseLocalAddress(true);
        }
    }, []);

    const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const checked = e.target.checked;
        setUseLocalAddress(checked);
        if (checked) {
            localStorage.setItem('useLocalAddress', 'true');
        } else {
            localStorage.removeItem('useLocalAddress');
        }
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
            {connecting && <LoadingOverlay message="Connecting to server..." />}
            <div className="card shadow-sm">
                <div className="card-header bg-white">
                    <h5 className="mb-0">Select Plex Server</h5>
                </div>
                <div className="list-group list-group-flush">
                    {servers.map(server => (
                        <button
                            key={server.clientIdentifier}
                            className="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
                            onClick={() => handleConnect(server)}
                            disabled={connecting}
                        >
                            {server.name}
                            <span className="badge bg-secondary rounded-pill">{server.productVersion}</span>
                        </button>
                    ))}
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
                            Use Local Address
                        </label>
                    </div>
                    {error && <div className="text-danger mt-2">{error}</div>}
                </div>
            </div>
        </>
    );
};
