/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { getSharedServers } from '../services/plex';
import { useUser, plexKeys } from '../hooks/usePlexQueries';
import type { PlexUser, PlexHomeUser } from '../types/plex';
import { useQueryClient } from '@tanstack/react-query';

interface AuthContextType {
    clientIdentifier: string;
    accessToken: string | null;
    serverUrl: string | null;
    serverName: string | null;
    machineIdentifier: string | null;
    user: PlexUser | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    login: (token: string, isShared?: boolean) => Promise<void>;
    logout: () => void;
    setServerUrl: (url: string, machineId?: string, name?: string) => void;
    clearServer: () => void;
    switchUser: (user: PlexHomeUser, pin?: string) => Promise<void>;
    adminToken: string | null;
    isSharedServer: boolean;
    isManagedUser: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [clientIdentifier, setClientIdentifier] = useState<string>('');
    const [accessToken, setAccessToken] = useState<string | null>(localStorage.getItem('plexToken'));
    const [serverUrl, setServerUrlState] = useState<string | null>(localStorage.getItem('plexServerUrl'));
    const [serverName, setServerName] = useState<string | null>(localStorage.getItem('plexServerName'));
    const [machineIdentifier, setMachineIdentifier] = useState<string | null>(localStorage.getItem('plexMachineId'));
    const [user, setUser] = useState<PlexUser | null>(() => {
        const storedUser = localStorage.getItem('plexUser');
        return storedUser ? JSON.parse(storedUser) : null;
    });
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [adminToken, setAdminToken] = useState<string | null>(localStorage.getItem('plexAdminToken'));
    const [isSharedServer, setIsSharedServer] = useState<boolean>(localStorage.getItem('isSharedServer') === 'true');
    const [isManagedUser, setIsManagedUser] = useState<boolean>(localStorage.getItem('isManagedUser') === 'true');
    const queryClient = useQueryClient();

    const logout = useCallback(() => {
        localStorage.removeItem('plexToken');
        localStorage.removeItem('plexServerUrl');
        localStorage.removeItem('plexServerName');
        localStorage.removeItem('plexAdminToken');
        localStorage.removeItem('plexMachineId');
        localStorage.removeItem('plexUser');
        localStorage.removeItem('isManagedUser');
        localStorage.removeItem('isSharedServer');
        setAccessToken(null);
        setServerUrlState(null);
        setServerName(null);
        setMachineIdentifier(null);
        setUser(null);
        setAdminToken(null);
        setIsSharedServer(false);
        setIsManagedUser(false);
    }, []);

    const { data: userData, error: userError } = useUser(clientIdentifier, accessToken, !isSharedServer && !isManagedUser);

    useEffect(() => {
        if (userData) {
            setUser(userData);
            localStorage.setItem('plexUser', JSON.stringify(userData));
            setIsLoading(false);
        } else if (userError) {
            console.error('Session validation failed', userError);
            logout();
            setIsLoading(false);
        } else if (!accessToken || isSharedServer || isManagedUser) {
            setIsLoading(false);
        }
    }, [userData, userError, accessToken, logout, isSharedServer, isManagedUser]);

    useEffect(() => {
        // Initialize Client Identifier
        let cid = localStorage.getItem('clientIdentifier');
        if (!cid) {
            cid = `PASTA-${uuidv4()}`;
            localStorage.setItem('clientIdentifier', cid);
        }
        setClientIdentifier(cid);
    }, []);

    const login = async (token: string, isShared: boolean = false) => {
        setIsLoading(true);
        try {
            if (isShared) {
                localStorage.setItem('isSharedServer', 'true');
                setIsSharedServer(true);
            } else {
                localStorage.removeItem('isSharedServer');
                setIsSharedServer(false);
            }
            // If this is the first login (no adminToken), set it.
            // This assumes the first login is always the admin/main user.
            if (!adminToken) {
                localStorage.setItem('plexAdminToken', token);
                setAdminToken(token);
            }

            localStorage.setItem('plexToken', token);
            setAccessToken(token);

            // We assume standard login is ALWAYS an admin/regular user who can be validated
            localStorage.removeItem('isManagedUser');

            // The useUser hook will automatically pick up the new token and validate
        } catch (error) {
            console.error('Login failed', error);
            logout();
        }
    };

    const setServerUrl = (url: string, machineId?: string, name?: string) => {
        localStorage.setItem('plexServerUrl', url);
        setServerUrlState(url);
        if (machineId) {
            localStorage.setItem('plexMachineId', machineId);
            setMachineIdentifier(machineId);
        }
        if (name) {
            localStorage.setItem('plexServerName', name);
            setServerName(name);
        }
    };

    const clearServer = () => {
        localStorage.removeItem('plexServerUrl');
        localStorage.removeItem('plexServerName');
        localStorage.removeItem('plexMachineId');
        setServerUrlState(null);
        setServerName(null);
        setMachineIdentifier(null);

        // If we're currently a managed user or on a shared server, revert to admin user
        const isManagedUserLocal = localStorage.getItem('isManagedUser') === 'true';
        if ((isManagedUserLocal || isSharedServer) && adminToken) {
            localStorage.removeItem('isManagedUser');
            localStorage.removeItem('isSharedServer');
            setIsSharedServer(false);
            setIsManagedUser(false);
            localStorage.setItem('plexToken', adminToken);
            setAccessToken(adminToken);

            // The useUser hook will automatically pick up the new token and validate
        }
    };

    const switchUser = async (targetUser: PlexHomeUser, _pin?: string) => {
        if (!machineIdentifier) {
            console.error('Cannot switch user: Missing machineIdentifier');
            alert('Error: Server machine identifier missing. Please reconnect to the server.');
            return;
        }

        const tokenToUse = adminToken || accessToken;

        if (!tokenToUse) {
            console.error('Cannot switch user: Missing auth token');
            return;
        }

        try {
            setIsLoading(true);

            let newToken = '';
            let isManaged = false;

            // Check if target is the Admin user
            if (targetUser.username) {
                newToken = tokenToUse;
                if (adminToken) {
                    newToken = adminToken;
                }
                isManaged = false;
            } else {
                const sharedServersData = await queryClient.fetchQuery({
                    queryKey: [...plexKeys.all, 'shared_servers', machineIdentifier],
                    queryFn: () => getSharedServers(machineIdentifier, clientIdentifier, tokenToUse),
                    staleTime: 1000 * 60 * 5 // 5 minutes
                });

                let xmlString = '';
                if (typeof sharedServersData === 'string') {
                    xmlString = sharedServersData;
                }

                if (xmlString) {
                    const parser = new DOMParser();
                    const xmlDoc = parser.parseFromString(xmlString, "text/xml");
                    const sharedServers = xmlDoc.getElementsByTagName("SharedServer");

                    for (let i = 0; i < sharedServers.length; i++) {
                        const server = sharedServers[i];
                        if (server.getAttribute("userID") === targetUser.id.toString()) {
                            newToken = server.getAttribute("accessToken") || '';
                            break;
                        }
                    }
                }

                if (!newToken) {
                    throw new Error(`Could not find access token for managed user ${targetUser.title} (ID: ${targetUser.id})`);
                }
                isManaged = true;
            }

            // Update State Directly - DO NOT CALL LOGIN (which validates)

            // 1. Set Token
            localStorage.setItem('plexToken', newToken);
            setAccessToken(newToken);

            // 2. Set Managed Flag
            if (isManaged) {
                localStorage.setItem('isManagedUser', 'true');
                setIsManagedUser(true);
            } else {
                localStorage.removeItem('isManagedUser');
                setIsManagedUser(false);
            }

            // 3. Set User Object
            // We need to convert PlexHomeUser to PlexUser format
            const newUser: PlexUser = {
                id: targetUser.id,
                uuid: targetUser.uuid,
                username: targetUser.username || targetUser.title, // Managed users might not have username, use title
                title: targetUser.title,
                email: targetUser.email,
                thumb: targetUser.thumb,
                home: true,
                protected: targetUser.protected
            };

            setUser(newUser);
            localStorage.setItem('plexUser', JSON.stringify(newUser));

            // If switching to admin, we *could* validate, but we just set the token and user.
            // If we refresh, it will validate because isManagedUser is false.

        } catch (error) {
            console.error('Failed to switch user', error);
            throw error;
        } finally {
            setIsLoading(false);
        }
    };

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
                isLoading,
                login,
                logout,
                setServerUrl,
                clearServer,
                switchUser,
                adminToken,
                isSharedServer,
                isManagedUser
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
