import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';

export const ManualLogin: React.FC = () => {
    const { login, setServerUrl } = useAuth();
    const [url, setUrl] = useState('');
    const [token, setToken] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (url) setServerUrl(url);
        await login(token);
    };

    return (
        <form onSubmit={handleSubmit} className="mt-4">
            <div className="mb-3">
                <label htmlFor="plexUrl" className="form-label">Plex URL (Optional)</label>
                <input
                    type="text"
                    className="form-control"
                    id="plexUrl"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="http://192.168.1.10:32400"
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
                />
            </div>
            <button type="submit" className="btn btn-secondary">Connect</button>
        </form>
    );
};
