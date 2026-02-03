import { useState } from 'react';
import { checkServerIdentity } from '../services/plex';
import { useAuth } from '../context/AuthContext';
import { usePlexResources } from './usePlexQueries';
import type { PlexResource } from '../types/plex';

export const usePlexServer = () => {
    const { clientIdentifier, accessToken, setServerUrl, login } = useAuth();
    const { data: resources, isLoading: loading, error: queryError, refetch } = usePlexResources(clientIdentifier, accessToken);

    const [connecting, setConnecting] = useState(false);
    const [connectionError, setConnectionError] = useState<string | null>(null);

    const servers = resources?.filter(r => r.product === 'Plex Media Server') || [];
    const error = queryError ? 'Failed to load servers.' : connectionError;

    const fetchServers = async () => {
        await refetch();
    };

    const connectToServer = async (server: PlexResource, useLocalAddress: boolean) => {
        setConnecting(true);
        setConnectionError(null);

        // Filter connections based on protocol, then prioritize based on preference
        let connections = server.connections.filter(c => {
            // Protocol check (HTTPS vs HTTP)
            if (window.location.protocol === 'https:' && c.protocol !== 'https') return false;
            return true;
        });

        // Sort based on preference
        connections.sort((a, b) => {
            if (useLocalAddress) {
                // Prefer local: true < false (sort a before b if a is local)
                return (a.local === b.local) ? 0 : (a.local ? -1 : 1);
            } else {
                // Prefer remote: false < true (sort a before b if a is remote)
                return (a.local === b.local) ? 0 : (!a.local ? -1 : 1);
            }
        });

        if (connections.length === 0) {
            setConnectionError(`No secure connections found for this server. enable 'Secure connections' in your Plex Media Server settings.`);
            setConnecting(false);
            return false;
        }

        // Create abort controllers for each connection attempt
        const abortControllers = connections.map(() => new AbortController());

        // Try all connections in parallel and use the first one that succeeds
        const connectionPromises = connections.map(async (conn, index) => {
            try {
                const identity = await checkServerIdentity(
                    conn.uri,
                    clientIdentifier,
                    server.accessToken,
                    abortControllers[index].signal
                );

                // If successful, cancel all other pending requests
                abortControllers.forEach((controller, i) => {
                    if (i !== index) {
                        controller.abort();
                    }
                });

                const machineId = identity.MediaContainer.machineIdentifier;

                return {
                    success: true,
                    uri: conn.uri,
                    machineId
                };
            } catch (e: any) {
                // Don't log if it was aborted (expected when another connection succeeds first)
                if (e.name !== 'CanceledError' && e.code !== 'ERR_CANCELED') {
                    console.warn(`Failed to connect to ${conn.uri}`, e);
                }
                return {
                    success: false,
                    uri: conn.uri
                };
            }
        });

        // Wait for all promises and find the first successful one
        const results = await Promise.all(connectionPromises);
        const successfulConnection = results.find(r => r.success);

        if (successfulConnection) {
            setServerUrl(successfulConnection.uri, successfulConnection.machineId, server.name);

            if (server.accessToken !== accessToken) {
                await login(server.accessToken, !server.owned);
            }
            setConnecting(false);
            return true;
        }

        setConnectionError('Could not connect to this server. Please check your network connection.');
        setConnecting(false);
        return false;
    };

    return {
        servers,
        loading,
        connecting,
        error,
        connectToServer,
        fetchServers
    };
};
