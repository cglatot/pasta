/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useUser, plexKeys } from '../hooks/usePlexQueries';
import type { PlexUser, PlexHomeUser } from '../types/plex';
import { useQueryClient } from '@tanstack/react-query';
import { usePastaProvider } from '../providers/PastaProvider';
import {
    disconnectServerMode,
    fetchServerSession,
    loginManualServerMode,
    logoutServerMode,
    switchUserServerMode,
    verifyAdminPinServerMode,
    type ServerSessionState,
} from '../providers/server/ServerProvider';
import type { PastaUserRole } from '../providers/types';

// crypto.randomUUID is only exposed in secure contexts (HTTPS / localhost).
// Self-hosted PASTA is often opened over plain HTTP on a LAN IP, so fall back to getRandomValues.
const generateUUID = (): string => {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const readStoredUser = (): PlexUser | null => {
    const storedUser = localStorage.getItem('plexUser');
    if (!storedUser) return null;
    try {
        return JSON.parse(storedUser);
    } catch {
        localStorage.removeItem('plexUser');
        return null;
    }
};

export interface AuthContextType {
    clientIdentifier: string;
    accessToken: string | null;
    serverUrl: string | null;
    serverName: string | null;
    machineIdentifier: string | null;
    user: PlexUser | null;
    isAuthenticated: boolean;
    isServerConnected: boolean;
    isServerMode: boolean;
    pastaRole: PastaUserRole;
    isInstanceOwner: boolean;
    managedServers: ServerSessionState['managedServers'];
    isLoading: boolean;
    login: (token: string, isShared?: boolean) => Promise<void>;
    createLoginPin: () => Promise<{ id: number; code: string }>;
    pollLoginPin: (pinId: number, code: string, onClaimed?: () => void) => Promise<boolean>;
    loginManual: (url: string, token: string) => Promise<void>;
    getSwitchableUsers: () => Promise<PlexHomeUser[]>;
    refreshServerSession: () => Promise<void>;
    logout: () => void;
    setServerUrl: (url: string, machineId?: string, name?: string) => void;
    clearServer: () => void;
    switchUser: (user: PlexHomeUser, pin?: string) => Promise<void>;
    verifyAdminPin: (pin: string) => Promise<void>;
    reconnectServer: () => Promise<void>;
    setActiveServerToken: (token: string) => void;
    adminToken: string | null;
    isSharedServer: boolean;
    isManagedUser: boolean;
    requiresAdminPin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const provider = usePastaProvider();
    const isServerMode = provider.mode === 'server';

    const [clientIdentifier, setClientIdentifier] = useState<string>('');
    const [accessToken, setAccessToken] = useState<string | null>(
        isServerMode ? null : localStorage.getItem('plexToken')
    );
    const [serverUrl, setServerUrlState] = useState<string | null>(
        isServerMode ? null : localStorage.getItem('plexServerUrl')
    );
    const [serverName, setServerName] = useState<string | null>(
        isServerMode ? null : localStorage.getItem('plexServerName')
    );
    const [machineIdentifier, setMachineIdentifier] = useState<string | null>(
        isServerMode ? null : localStorage.getItem('plexMachineId')
    );
    const [user, setUser] = useState<PlexUser | null>(isServerMode ? null : readStoredUser);
    const [pastaRole, setPastaRole] = useState<PastaUserRole>(null);
    const [isInstanceOwner, setIsInstanceOwner] = useState<boolean>(false);
    const [managedServers, setManagedServers] = useState<ServerSessionState['managedServers']>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [adminToken, setAdminToken] = useState<string | null>(
        isServerMode ? null : localStorage.getItem('plexAdminToken')
    );
    const [isSharedServer, setIsSharedServer] = useState<boolean>(
        isServerMode ? false : localStorage.getItem('isSharedServer') === 'true'
    );
    const [isManagedUser, setIsManagedUser] = useState<boolean>(
        isServerMode ? false : localStorage.getItem('isManagedUser') === 'true'
    );
    // Server Mode only: derived from the server session (primary account PIN not yet verified).
    // In Client Mode the Admin PIN is verified by plex.tv when the Admin profile is selected.
    const [requiresAdminPin, setRequiresAdminPin] = useState<boolean>(false);
    const queryClient = useQueryClient();

    const applyServerSession = useCallback((session: ServerSessionState) => {
        if (!session.authenticated || !session.user) {
            setUser(null);
            setMachineIdentifier(null);
            setServerName(null);
            setServerUrlState(null);
            setAccessToken(null);
            setPastaRole(null);
            setIsInstanceOwner(false);
            setManagedServers([]);
            setIsSharedServer(false);
            setIsManagedUser(false);
            setRequiresAdminPin(false);
            return;
        }

        setUser(session.user);
        setMachineIdentifier(session.machineIdentifier);
        setServerName(session.serverName);
        setServerUrlState(session.machineIdentifier ? `server://${session.machineIdentifier}` : null);
        // Synthetic session key for React Query user-scoped cache differentiation (never a real Plex token)
        setAccessToken(`session-user-${session.user.id}`);
        setPastaRole(session.pastaRole);
        setIsInstanceOwner(session.isInstanceOwner);
        setManagedServers(session.managedServers || []);
        setIsSharedServer(session.isSharedServer);
        setIsManagedUser(session.isManagedUser);
        setRequiresAdminPin(Boolean(session.requiresAdminPin));
    }, []);

    const refreshServerSession = useCallback(async () => {
        if (!isServerMode) return;
        try {
            const session = await fetchServerSession();
            applyServerSession(session);
        } catch {
            applyServerSession({
                authenticated: false,
                user: null,
                machineIdentifier: null,
                serverName: null,
                isSharedServer: false,
                isManagedUser: false,
                pastaRole: null,
                isInstanceOwner: false,
                managedServers: [],
            });
        } finally {
            setIsLoading(false);
        }
    }, [isServerMode, applyServerSession]);

    const logout = useCallback(() => {
        sessionStorage.removeItem('pasta_profile_selected');
        if (isServerMode) {
            void logoutServerMode();
        } else {
            localStorage.removeItem('plexToken');
            localStorage.removeItem('plexServerUrl');
            localStorage.removeItem('plexServerName');
            localStorage.removeItem('plexAdminToken');
            localStorage.removeItem('plexPrimaryUserId');
            localStorage.removeItem('plexMachineId');
            localStorage.removeItem('plexUser');
            localStorage.removeItem('isManagedUser');
            localStorage.removeItem('isSharedServer');
        }
        queryClient.clear();
        setAccessToken(null);
        setServerUrlState(null);
        setServerName(null);
        setMachineIdentifier(null);
        setUser(null);
        setAdminToken(null);
        setPastaRole(null);
        setIsInstanceOwner(false);
        setManagedServers([]);
        setIsSharedServer(false);
        setIsManagedUser(false);
        setRequiresAdminPin(false);
    }, [isServerMode, queryClient]);

    const reconnectServer = useCallback(async () => {
        if (isServerMode) {
            await refreshServerSession();
        } else {
            const storedUrl = localStorage.getItem('plexServerUrl');
            const storedMachineId = localStorage.getItem('plexMachineId');
            const storedServerName = localStorage.getItem('plexServerName');
            const storedToken = localStorage.getItem('plexToken');

            setServerUrlState(storedUrl);
            setMachineIdentifier(storedMachineId);
            setServerName(storedServerName);
            if (storedToken) setAccessToken(storedToken);
        }

        await queryClient.cancelQueries({ queryKey: plexKeys.all });
        await queryClient.resetQueries({ queryKey: plexKeys.all });
    }, [queryClient, isServerMode, refreshServerSession]);

    const { data: userData, error: userError } = useUser(
        clientIdentifier,
        accessToken,
        !isServerMode && !isSharedServer && !isManagedUser
    );

    useEffect(() => {
        if (isServerMode) {
            void refreshServerSession();
            return;
        }

        if (!isManagedUser && !isSharedServer && userData) {
            setUser(userData);
            localStorage.setItem('plexUser', JSON.stringify(userData));
            localStorage.setItem('plexPrimaryUserId', String(userData.id));
            setIsLoading(false);
        } else if (userError && !isManagedUser && !isSharedServer) {
            console.error('Session validation failed', userError);
            logout();
            setIsLoading(false);
        } else if (!accessToken || isSharedServer || isManagedUser) {
            setIsLoading(false);
        }
    }, [userData, userError, accessToken, logout, isSharedServer, isManagedUser, isServerMode, refreshServerSession]);

    useEffect(() => {
        let cid = localStorage.getItem('clientIdentifier');
        if (!cid) {
            cid = `PASTA-${generateUUID()}`;
            localStorage.setItem('clientIdentifier', cid);
        }
        setClientIdentifier(cid);
    }, []);

    const login = async (token: string, isShared: boolean = false) => {
        if (isServerMode) {
            await refreshServerSession();
            return;
        }

        setIsLoading(true);
        try {
            if (isShared) {
                localStorage.setItem('isSharedServer', 'true');
                setIsSharedServer(true);
            } else {
                localStorage.removeItem('isSharedServer');
                setIsSharedServer(false);
            }
            if (!adminToken) {
                localStorage.setItem('plexAdminToken', token);
                setAdminToken(token);
            }

            localStorage.setItem('plexToken', token);
            localStorage.removeItem('isManagedUser');
            setIsManagedUser(false);
            setAccessToken(token);
        } catch (error) {
            console.error('Login failed', error);
            logout();
        }
    };

    const setServerUrl = (url: string, machineId?: string, name?: string) => {
        if (!isServerMode) {
            localStorage.setItem('plexServerUrl', url);
            if (machineId) localStorage.setItem('plexMachineId', machineId);
            if (name) localStorage.setItem('plexServerName', name);
        }
        setServerUrlState(url);
        if (machineId) setMachineIdentifier(machineId);
        if (name) setServerName(name);
        if (isServerMode) {
            void refreshServerSession();
        }
    };

    const clearServer = () => {
        if (isServerMode) {
            setServerUrlState(null);
            setServerName(null);
            setMachineIdentifier(null);
            void disconnectServerMode().then(() => refreshServerSession());
            return;
        }

        localStorage.removeItem('plexServerUrl');
        localStorage.removeItem('plexServerName');
        localStorage.removeItem('plexMachineId');
        localStorage.removeItem('isSharedServer');
        setServerUrlState(null);
        setServerName(null);
        setMachineIdentifier(null);
        setIsSharedServer(false);
        if (adminToken) {
            localStorage.setItem('plexToken', adminToken);
            setAccessToken(adminToken);
        }
    };

    /**
     * Client Mode: applies the server-specific access token for the active profile after connecting
     * (Managed Users have a per-server token from plex.tv shared_servers). No-op in Server Mode,
     * where the backend session holds the real tokens.
     */
    const setActiveServerToken = (token: string) => {
        if (isServerMode) return;
        localStorage.setItem('plexToken', token);
        setAccessToken(token);
    };

    const createLoginPin = async () => {
        return provider.auth.createPin(clientIdentifier);
    };

    const pollLoginPin = async (pinId: number, code: string, onClaimed?: () => void): Promise<boolean> => {
        const result = await provider.auth.checkPin(pinId, clientIdentifier, code);
        if (result.authToken) {
            onClaimed?.();
            sessionStorage.removeItem('pasta_profile_selected');
            await login(result.authToken);
            return true;
        }
        return false;
    };

    const loginManual = async (cleanUrl: string, cleanToken: string): Promise<void> => {
        sessionStorage.removeItem('pasta_profile_selected');
        if (isServerMode) {
            setIsLoading(true);
            try {
                const session = await loginManualServerMode(cleanUrl, cleanToken, clientIdentifier);
                applyServerSession(session);
            } finally {
                setIsLoading(false);
            }
            return;
        }

        if (cleanUrl) {
            try {
                const identity = await provider.auth.checkIdentity(cleanUrl, clientIdentifier, cleanToken);
                const machineId = identity.machineIdentifier;
                const resolvedName = identity.friendlyName || 'Plex Server';
                setServerUrl(cleanUrl, machineId, resolvedName);
            } catch {
                setServerUrl(cleanUrl, undefined, 'Plex Server');
            }
        }
        await login(cleanToken);
    };

    // Pure lookup with no side effects. Memoized so components can safely use it as an effect dependency.
    const getSwitchableUsers = useCallback(async (): Promise<PlexHomeUser[]> => {
        const tokenToUse = adminToken || accessToken;
        if (!clientIdentifier || (!tokenToUse && !isServerMode)) {
            return [];
        }
        return queryClient.fetchQuery({
            queryKey: [...plexKeys.all, 'users', machineIdentifier ?? null],
            queryFn: () =>
                provider.auth.getSwitchableUsers(clientIdentifier, tokenToUse || '', machineIdentifier),
            staleTime: 0,
        });
    }, [adminToken, accessToken, clientIdentifier, isServerMode, machineIdentifier, provider, queryClient]);

    /**
     * Switches the active Plex Home profile. Both modes share identical semantics
     * (mirroring POST /api/auth/switch-user on the PASTA Server):
     *  - PIN-protected profiles are verified with plex.tv
     *  - the active server is always disconnected, returning the user to Server Selection
     *  - Managed Users' per-server tokens are resolved when connecting to a server (usePlexServer)
     *
     * Deliberately does NOT toggle the global `isLoading` flag: that flag unmounts <MainApp />
     * (see App.tsx), which would discard the caller's in-flight UI state mid-switch.
     * The user selection screen shows its own "Switching user..." overlay instead.
     */
    const switchUser = async (targetUser: PlexHomeUser, pin?: string) => {
        if (isServerMode) {
            const session = await switchUserServerMode(
                targetUser,
                pin,
                machineIdentifier,
                clientIdentifier
            );
            applyServerSession(session);
            void queryClient.invalidateQueries({ queryKey: plexKeys.server(machineIdentifier) });
            return;
        }

        const primaryToken = adminToken || accessToken;
        if (!primaryToken) {
            throw new Error('Cannot switch user: missing Plex account token. Please sign in again.');
        }

        if (targetUser.protected) {
            // Throws on an incorrect PIN, leaving the current profile untouched
            await provider.auth.verifyHomeUserPin(
                targetUser.uuid,
                clientIdentifier,
                primaryToken,
                pin ?? ''
            );
        }

        const primaryId = localStorage.getItem('plexPrimaryUserId');
        const isSwitchingToAdmin =
            Boolean(targetUser.admin) || (primaryId !== null && String(targetUser.id) === primaryId);

        // Disconnect from the current server (same as Server Mode)
        clearServer();

        // Until a server is chosen, plex.tv calls (resources, home users) use the primary account token.
        // A Managed User's server-specific token is resolved in usePlexServer.connectToServer.
        localStorage.setItem('plexToken', primaryToken);
        setAccessToken(primaryToken);

        localStorage.removeItem('isSharedServer');
        setIsSharedServer(false);

        if (isSwitchingToAdmin) {
            localStorage.removeItem('isManagedUser');
            setIsManagedUser(false);
        } else {
            localStorage.setItem('isManagedUser', 'true');
            setIsManagedUser(true);
        }

        const newUser: PlexUser = {
            id: targetUser.id,
            uuid: targetUser.uuid,
            username: targetUser.username || targetUser.title,
            title: targetUser.title,
            email: targetUser.email,
            thumb: targetUser.thumb,
            home: true,
            protected: targetUser.protected,
        };
        setUser(newUser);
        localStorage.setItem('plexUser', JSON.stringify(newUser));
    };

    const verifyAdminPin = async (pin: string) => {
        // Admin Settings (and therefore this PIN gate) only exist in Server Mode
        if (!isServerMode) return;
        const session = await verifyAdminPinServerMode(pin, clientIdentifier);
        applyServerSession(session);
    };

    const isServerConnected = isServerMode ? Boolean(machineIdentifier) : Boolean(serverUrl);

    return (
        <AuthContext.Provider
            value={{
                clientIdentifier,
                accessToken,
                serverUrl,
                serverName,
                machineIdentifier,
                user,
                isAuthenticated: !!user,
                isServerConnected,
                isServerMode,
                pastaRole,
                isInstanceOwner,
                managedServers,
                isLoading,
                login,
                createLoginPin,
                pollLoginPin,
                loginManual,
                getSwitchableUsers,
                refreshServerSession,
                logout,
                setServerUrl,
                clearServer,
                switchUser,
                verifyAdminPin,
                reconnectServer,
                setActiveServerToken,
                adminToken,
                isSharedServer,
                isManagedUser,
                requiresAdminPin,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
