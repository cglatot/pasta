import { useState, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { usePlexResources } from './usePlexQueries';
import { usePastaProvider } from '../providers/PastaProvider';
import type { PlexResource } from '../types/plex';

export const usePlexServer = () => {
    const provider = usePastaProvider();
    const {
        clientIdentifier,
        accessToken,
        adminToken,
        isManagedUser,
        user,
        setServerUrl,
        login,
        setActiveServerToken,
    } = useAuth();
    const { connectionTimeout } = useSettings();
    const { data: resources, isLoading: loading, error: queryError, refetch } = usePlexResources(
        clientIdentifier,
        adminToken || accessToken,
        user?.id
    );

    const [connecting, setConnecting] = useState(false);
    const [connectionError, setConnectionError] = useState<string | null>(null);
    const activeControllersRef = useRef<AbortController[]>([]);

    const rawServers = resources?.filter(r => r.product === 'Plex Media Server') || [];
    // Managed accounts cannot access shared servers - filter strictly to owned servers
    const servers = isManagedUser
        ? rawServers.filter(r => r.owned)
        : rawServers;
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

        let serverToConnect = server;
        let effectiveToken = server.accessToken;

        // In Client Mode, resolve the Managed User's token for this server from shared_servers
        if (provider.mode === 'client' && isManagedUser && user?.id) {
            try {
                const tokenToUse = adminToken || accessToken || server.accessToken;
                effectiveToken = await provider.auth.resolveManagedUserToken(
                    server.clientIdentifier,
                    user.id,
                    clientIdentifier,
                    tokenToUse || ''
                );
                serverToConnect = { ...server, accessToken: effectiveToken };
            } catch (err) {
                setConnecting(false);
                setConnectionError(
                    err instanceof Error
                        ? err.message
                        : `Could not resolve access token for managed user ${user.title || user.username}`
                );
                return false;
            }
        }

        const result = await provider.servers.connectToServer(serverToConnect, {
            useLocalAddress,
            clientIdentifier,
            timeoutMs: connectionTimeout * 1000,
            onRegisterAbortControllers: (controllers) => {
                activeControllersRef.current = controllers;
            },
        });

        activeControllersRef.current = [];

        if (result.success && result.uri) {
            setServerUrl(result.uri, result.machineId || server.clientIdentifier, server.name);

            if (provider.mode === 'client') {
                if (isManagedUser) {
                    setActiveServerToken(effectiveToken);
                } else if (server.accessToken !== accessToken) {
                    await login(server.accessToken, !server.owned);
                }
            }
            setConnecting(false);
            return true;
        }

        setConnectionError(
            result.errorMessage || 'Could not connect to this server. Please check your network connection.'
        );
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
