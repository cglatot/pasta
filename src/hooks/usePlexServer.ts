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

        // Filter connections based on preference and protocol
        const connections = server.connections.filter(c => {
            // Protocol check (HTTPS vs HTTP)
            if (window.location.protocol === 'https:' && c.protocol !== 'https') return false;

            // Local address check
            if (useLocalAddress) {
                return c.local === true;
            } else {
                return c.local === false;
            }
        });

        if (connections.length === 0) {
            setConnectionError(`No ${useLocalAddress ? 'local' : 'remote'} connections found for this server.`);
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
