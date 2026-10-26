import { useState, useRef, useCallback } from 'react';
import { checkServerIdentity, isAbortError } from '../services/plex';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { usePlexResources } from './usePlexQueries';
import type { PlexResource } from '../types/plex';

export const usePlexServer = () => {
    const { clientIdentifier, accessToken, setServerUrl, login } = useAuth();
    const { connectionTimeout } = useSettings();
    const { data: resources, isLoading: loading, error: queryError, refetch } = usePlexResources(clientIdentifier, accessToken);

    const [connecting, setConnecting] = useState(false);
    const [connectionError, setConnectionError] = useState<string | null>(null);
    const activeControllersRef = useRef<AbortController[]>([]);

    const servers = resources?.filter(r => r.product === 'Plex Media Server') || [];
    const error = queryError ? 'Failed to load servers.' : connectionError;

    const fetchServers = async () => {
        await refetch();
    };

    const cancelConnect = useCallback(() => {
        activeControllersRef.current.forEach(c => c.abort());
        activeControllersRef.current = [];
        setConnecting(false);
        setConnectionError('Connection cancelled.');
    }, []);

    const connectToServer = async (server: PlexResource, useLocalAddress: boolean) => {
        setConnecting(true);
        setConnectionError(null);

        // Filter connections based on protocol
        const connections = server.connections.filter(c => {
            // When on HTTPS, browsers block mixed content (plain HTTP requests)
            if (window.location.protocol === 'https:' && c.protocol !== 'https') return false;
            return true;
        });

        // Sort connections based on preference (local first or remote first)
        connections.sort((a, b) => {
            if (useLocalAddress) {
                // Prefer local: true before false
                return (a.local === b.local) ? 0 : (a.local ? -1 : 1);
            } else {
                // Prefer remote: false before true
                return (a.local === b.local) ? 0 : (!a.local ? -1 : 1);
            }
        });

        if (connections.length === 0) {
            setConnectionError(`No secure connections found for this server. Please enable 'Secure connections' in your Plex Media Server settings.`);
            setConnecting(false);
            return false;
        }

        // Create abort controllers for each connection attempt
        const abortControllers = connections.map(() => new AbortController());
        activeControllersRef.current = abortControllers;

        // Try connections in parallel; the first successful connection cancels all others for instant resolution
        const connectionPromises = connections.map(async (conn, index) => {
            try {
                const identity = await checkServerIdentity(
                    conn.uri,
                    clientIdentifier,
                    server.accessToken,
                    abortControllers[index].signal,
                    connectionTimeout * 1000
                );

                // As soon as this connection succeeds, cancel all other in-flight requests immediately
                abortControllers.forEach((controller, i) => {
                    if (i !== index) {
                        controller.abort();
                    }
                });

                const machineId = identity?.MediaContainer?.machineIdentifier || server.clientIdentifier;

                return {
                    success: true,
                    uri: conn.uri,
                    machineId
                };
            } catch (e: unknown) {
                if (!isAbortError(e)) {
                    console.warn(`Failed to connect to ${conn.uri}`, e);
                }
                return {
                    success: false,
                    uri: conn.uri
                };
            }
        });

        const results = await Promise.all(connectionPromises);
        activeControllersRef.current = [];

        const successfulConnection = results.find(r => r.success);

        if (successfulConnection) {
            setServerUrl(successfulConnection.uri, successfulConnection.machineId, server.name);

            if (server.accessToken !== accessToken) {
                await login(server.accessToken, !server.owned);
            }
            setConnecting(false);
            return true;
        }

        let errMsg = 'Could not connect to this server. Please check your network connection.';
        if (server.dnsRebindingProtection) {
            errMsg += ' Your router or ISP may have DNS Rebinding Protection blocking *.plex.direct.';
        }

        setConnectionError(errMsg);
        setConnecting(false);
        return false;
    };

    return {
        servers,
        loading,
        connecting,
        error,
        connectToServer,
        cancelConnect,
        fetchServers
    };
};
