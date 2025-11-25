import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { ServerSelection } from './ServerSelection';
import { MediaBrowser } from './MediaBrowser';
import { ManagedUserSelection } from './Auth/ManagedUserSelection';
import { getHomeUsers } from '../services/plex';
import type { PlexHomeUser } from '../types/plex';
import { Header } from './Layout/Header';

import { useQueryClient } from '@tanstack/react-query';
import { plexKeys } from '../hooks/usePlexQueries';

export const MainApp: React.FC = () => {
    const { serverUrl, clientIdentifier, accessToken, switchUser, adminToken, isSharedServer } = useAuth();
    const [homeUsers, setHomeUsers] = useState<PlexHomeUser[]>([]);
    const [isUserSelectionPhase, setIsUserSelectionPhase] = useState(false);
    const queryClient = useQueryClient();

    // Reset user selection phase when server is cleared
    useEffect(() => {
        if (!serverUrl) {
            setIsUserSelectionPhase(false);
        }
    }, [serverUrl]);

    const handleServerConnect = async () => {
        // Server is connected, serverUrl is set.
        // Skip home users check for shared servers (user doesn't have permission)
        if (isSharedServer) {
            return; // Just proceed to MediaBrowser
        }

        // Now check for home users.
        if (accessToken && clientIdentifier) {
            try {
                const users = await queryClient.fetchQuery({
                    queryKey: [...plexKeys.all, 'users'],
                    queryFn: () => getHomeUsers(clientIdentifier, accessToken),
                    staleTime: 1000 * 60 * 5,
                });

                if (users.length > 0) {
                    setHomeUsers(users);

                    // If there's only one user and they're not protected, skip user selection
                    if (users.length === 1 && !users[0].protected) {
                        // User is already authenticated, just proceed
                    } else {
                        // Multiple users or single protected user - show selection screen
                        setIsUserSelectionPhase(true);
                    }
                }
            } catch (e) {
                // Proceed to MediaBrowser (no home users)
            }
        }
    };

    const handleUserSelect = async (targetUser: PlexHomeUser, pin?: string) => {
        try {
            await switchUser(targetUser, pin);
            setIsUserSelectionPhase(false);
        } catch (e) {
            alert('Failed to switch user. Please check PIN.');
        }
    };

    const handleCancelUserSelection = () => {
        setIsUserSelectionPhase(false);
    };

    const handleRequestUserSwitch = async () => {
        // Fetch users when requested from header dropdown
        // Use adminToken if available for proper permissions
        const tokenToUse = adminToken || accessToken;
        if (tokenToUse && clientIdentifier) {
            try {
                const users = await queryClient.fetchQuery({
                    queryKey: [...plexKeys.all, 'users'],
                    queryFn: () => getHomeUsers(clientIdentifier, tokenToUse),
                    staleTime: 1000 * 60 * 5,
                });

                if (users.length > 0) {
                    setHomeUsers(users);
                    setIsUserSelectionPhase(true);
                }
            } catch (e) {
                // Failed to fetch home users
            }
        }
    };

    // Render Logic

    // 1. User Selection Phase (Happens after server connect if users exist)
    if (isUserSelectionPhase) {
        return (
            <>
                <Header />
                <div className="container mt-5">
                    <div className="row justify-content-center">
                        <div className="col-md-8 col-lg-6">
                            <ManagedUserSelection
                                users={homeUsers}
                                onSelect={handleUserSelect}
                                onCancel={handleCancelUserSelection}
                            />
                        </div>
                    </div>
                </div>
            </>
        );
    }

    // 2. Connected (MediaBrowser)
    if (serverUrl) {
        return (
            <>
                <Header onSwitchUser={handleRequestUserSwitch} />
                <div className="container-fluid py-2">
                    <MediaBrowser />
                </div>
            </>
        );
    }

    // 3. Not Connected (Server Selection)
    return (
        <>
            <Header />
            <div className="container mt-5">
                <div className="row justify-content-center">
                    <div className="col-md-8 col-lg-6">
                        <ServerSelection onConnect={handleServerConnect} />
                    </div>
                </div>
            </div>
        </>
    );
};
