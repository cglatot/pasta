import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { checkServerIdentity } from '../../services/plex';

export const ManualLogin: React.FC = () => {
    const { login, setServerUrl, clientIdentifier } = useAuth();
    const [url, setUrl] = useState('');
    const [token, setToken] = useState('');
    const [isConnecting, setIsConnecting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsConnecting(true);

        const cleanUrl = url.trim().replace(/\/+$/, '');
        const cleanToken = token.trim();

        try {
            if (cleanUrl) {
                try {
                    const identity = await checkServerIdentity(cleanUrl, clientIdentifier, cleanToken);
                    const machineId = identity?.MediaContainer?.machineIdentifier;
                    const serverName = identity?.MediaContainer?.friendlyName || identity?.MediaContainer?.myPlexServerName || 'Plex Server';
                    setServerUrl(cleanUrl, machineId, serverName);
                } catch {
                    // Carry on cleanly if /identity is unavailable or blocked by CORS
                    setServerUrl(cleanUrl, undefined, 'Plex Server');
                }
            }
            await login(cleanToken);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to connect');
        } finally {
            setIsConnecting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="mt-4">
            {error && <div className="alert alert-danger mb-3">{error}</div>}
            <div className="mb-3">
                <label htmlFor="plexUrl" className="form-label">Plex URL (Optional)</label>
                <input
                    type="text"
                    className="form-control"
                    id="plexUrl"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="http://192.168.1.10:32400"
                    disabled={isConnecting}
                />
            </div>
            <div className="mb-3">
                <label htmlFor="plexToken" className="form-label">Plex Token</label>
                <input
                    type="text"
                    className="form-control"
                    id="plexToken"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    required
                    placeholder="X-Plex-Token"
                    disabled={isConnecting}
                />
            </div>
            <button type="submit" className="btn btn-secondary" disabled={isConnecting}>
                {isConnecting ? (
                    <>
                        <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                        Connecting...
                    </>
                ) : (
                    'Connect'
                )}
            </button>
        </form>
    );
};
