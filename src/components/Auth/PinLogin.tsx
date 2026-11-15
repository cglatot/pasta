import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';

export const PinLogin: React.FC = () => {
    const { clientIdentifier, createLoginPin, pollLoginPin } = useAuth();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const intervalRef = useRef<number | null>(null);
    const timeoutRef = useRef<number | null>(null);
    const isPollingRef = useRef(false);

    const cleanup = () => {
        isPollingRef.current = false;
        if (intervalRef.current !== null) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
        if (timeoutRef.current !== null) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
    };

    useEffect(() => {
        return cleanup;
    }, []);

    const handleLogin = async () => {
        cleanup();
        setLoading(true);
        setError(null);
        try {
            const pinData = await createLoginPin();
            const popup = window.open(
                `https://app.plex.tv/auth#?clientID=${clientIdentifier}&code=${pinData.code}&context%5Bdevice%5D%5Bproduct%5D=Plex%20Web`,
                'PlexSignIn',
                'width=800,height=730'
            );

            if (!popup) {
                setError('Popup blocked. Please allow popups for this site.');
                setLoading(false);
                return;
            }

            intervalRef.current = window.setInterval(async () => {
                if (popup.closed) {
                    cleanup();
                    setLoading(false);
                    return;
                }

                if (isPollingRef.current) {
                    return;
                }
                isPollingRef.current = true;

                try {
                    const loggedIn = await pollLoginPin(pinData.id, pinData.code, () => {
                        cleanup();
                        popup.close();
                    });
                    if (loggedIn) {
                        cleanup();
                        popup.close();
                    }
                } catch (e) {
                    console.error('Error checking PIN', e);
                } finally {
                    isPollingRef.current = false;
                }
            }, 2000);

            // Stop polling after 2 minutes
            timeoutRef.current = window.setTimeout(() => {
                cleanup();
                setLoading(false);
                setError('Login timed out.');
            }, 120000);

        } catch (e) {
            console.error(e);
            setError('Failed to initialize login.');
            setLoading(false);
        }
    };

    return (
        <div className="text-center">
            {error && <div className="alert alert-danger">{error}</div>}
            <button
                className="btn btn-primary btn-lg"
                onClick={handleLogin}
                disabled={loading}
            >
                {loading ? 'Waiting for Plex...' : 'Login with Plex'}
            </button>
        </div>
    );
};
