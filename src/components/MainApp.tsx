import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { usePastaProvider } from '../providers/PastaProvider';
import { ServerSelection } from './ServerSelection';
import { MediaBrowser } from './MediaBrowser';
import { ManagedUserSelection, PinVerificationCard } from './Auth/ManagedUserSelection';
import { BatchHistory } from './Admin/BatchHistory';
import { AdminConsole } from './Admin/AdminConsole';
import { LoadingOverlay } from './Layout/LoadingOverlay';
import type { PlexHomeUser } from '../types/plex';
import { Header, type AppScreenPhase } from './Layout/Header';

type ActiveView = 'browser' | 'logs' | 'admin';

export const MainApp: React.FC = () => {
    const provider = usePastaProvider();
    const { connectionTimeout } = useSettings();
    const {
        user,
        clientIdentifier,
        machineIdentifier,
        managedServers,
        isServerConnected,
        isManagedUser,
        switchUser,
        verifyAdminPin,
        requiresAdminPin,
        reconnectServer,
        getSwitchableUsers,
        setServerUrl,
    } = useAuth();
    const [homeUsers, setHomeUsers] = useState<PlexHomeUser[]>([]);
    const [isUserSelectionPhase, setIsUserSelectionPhase] = useState(false);
    const [hasSelectedProfile, setHasSelectedProfile] = useState(() => {
        if (requiresAdminPin) return false;
        if (isManagedUser || isServerConnected) return true;
        return sessionStorage.getItem('pasta_profile_selected') === 'true';
    });
    const [checkingInitialUsers, setCheckingInitialUsers] = useState(
        () => !hasSelectedProfile
    );
    const [isAdminPinPhase, setIsAdminPinPhase] = useState(false);
    const [activeView, setActiveView] = useState<ActiveView>('browser');
    const [adminMachineId, setAdminMachineId] = useState<string | null>(null);
    const [connectingFromMenu, setConnectingFromMenu] = useState(false);

    // Prompt for Plex Home User Selection FIRST (before Server Selection) when logging in
    // or if the page is refreshed before a PIN-protected Admin profile has been verified.
    useEffect(() => {
        if (hasSelectedProfile && !requiresAdminPin) {
            setCheckingInitialUsers(false);
            return;
        }

        let cancelled = false;
        setCheckingInitialUsers(true);
        void getSwitchableUsers()
            .then(users => {
                if (cancelled) return;
                if (users.length > 0) {
                    setHomeUsers(users);
                    if (users.length === 1 && !users[0].protected && !requiresAdminPin) {
                        sessionStorage.setItem('pasta_profile_selected', 'true');
                        setHasSelectedProfile(true);
                    } else {
                        setIsUserSelectionPhase(true);
                    }
                } else if (!requiresAdminPin) {
                    sessionStorage.setItem('pasta_profile_selected', 'true');
                    setHasSelectedProfile(true);
                }
            })
            .catch(() => {
                if (!cancelled && !requiresAdminPin) {
                    setHasSelectedProfile(true);
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setCheckingInitialUsers(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [hasSelectedProfile, requiresAdminPin, getSwitchableUsers]);

    const handleServerConnect = () => {
        setActiveView('browser');
        setHasSelectedProfile(true);
    };

    const handleUserSelect = async (targetUser: PlexHomeUser, pin?: string) => {
        await switchUser(targetUser, pin);
        sessionStorage.setItem('pasta_profile_selected', 'true');
        setHasSelectedProfile(true);
        setIsUserSelectionPhase(false);
        setActiveView('browser');
    };

    const handleCancelUserSelection = () => {
        setIsUserSelectionPhase(false);
    };

    const handleRequestUserSwitch = async () => {
        setIsUserSelectionPhase(true);
        try {
            const users = await getSwitchableUsers();
            if (users.length > 0) {
                setHomeUsers(users);
            }
        } catch {
            // Failed to fetch switchable users
        }
    };

    const effectiveAdminMachineId =
        adminMachineId || machineIdentifier || managedServers[0]?.machineIdentifier || null;
    const hasTargetServer = isServerConnected || Boolean(effectiveAdminMachineId);

    const handleOpenAdminSettings = (machineId?: string) => {
        if (machineId) {
            setAdminMachineId(machineId);
        } else if (!adminMachineId && (machineIdentifier || managedServers[0]?.machineIdentifier)) {
            setAdminMachineId(machineIdentifier || managedServers[0]?.machineIdentifier || null);
        }
        if (requiresAdminPin) {
            setIsAdminPinPhase(true);
            return;
        }
        setActiveView('admin');
    };

    const handleOpenBrowserFromMenu = async () => {
        if (isServerConnected || !effectiveAdminMachineId) {
            setActiveView('browser');
            return;
        }

        const targetManaged = managedServers.find(
            s => s.machineIdentifier === effectiveAdminMachineId
        );
        const storedLocal = localStorage.getItem('useLocalAddress');
        const useLocalAddress = storedLocal === null ? true : storedLocal === 'true';

        setConnectingFromMenu(true);
        try {
            const result = await provider.servers.connectToServer(
                {
                    name: targetManaged?.serverName || 'Plex Server',
                    product: 'Plex Media Server',
                    productVersion: '',
                    platform: '',
                    platformVersion: '',
                    device: '',
                    clientIdentifier: effectiveAdminMachineId,
                    createdAt: '',
                    lastSeenAt: '',
                    provides: 'server',
                    ownerId: '',
                    sourceTitle: '',
                    publicAddress: '',
                    accessToken: '',
                    owned: true,
                    home: false,
                    synced: false,
                    relay: false,
                    presence: true,
                    httpsRequired: false,
                    publicAddressMatches: false,
                    dnsRebindingProtection: false,
                    natLoopbackSupported: false,
                    connections: [],
                },
                {
                    useLocalAddress,
                    clientIdentifier,
                    timeoutMs: connectionTimeout * 1000,
                }
            );
            if (result.success && result.uri) {
                setServerUrl(
                    result.uri,
                    result.machineId || effectiveAdminMachineId,
                    targetManaged?.serverName || 'Plex Server'
                );
            }
        } finally {
            setConnectingFromMenu(false);
            setActiveView('browser');
        }
    };

    const isShowingUserSelection =
        isUserSelectionPhase ||
        checkingInitialUsers ||
        !hasSelectedProfile ||
        requiresAdminPin;

    const currentScreen: AppScreenPhase = isAdminPinPhase
        ? 'pin-verification'
        : isShowingUserSelection
          ? 'user-selection'
          : activeView === 'admin'
            ? 'admin'
            : activeView === 'logs' && hasTargetServer
              ? 'logs'
              : isServerConnected
                ? 'browser'
                : 'server-selection';

    const headerProps = {
        currentScreen,
        onSwitchUser: handleRequestUserSwitch,
        onReconnectServer: isServerConnected ? reconnectServer : undefined,
        onChangeServer: () => setActiveView('browser'),
        onOpenBrowser: hasTargetServer ? () => void handleOpenBrowserFromMenu() : undefined,
        onOpenLogs: hasTargetServer ? () => setActiveView('logs') : undefined,
        onOpenAdminSettings: () => handleOpenAdminSettings(),
    };

    let content: React.ReactNode;

    // 0. Admin PIN Gate (When Admin account has a PIN and opens Admin Settings before verifying PIN)
    if (isAdminPinPhase) {
        content = (
            <div className="container mt-5">
                <div className="row justify-content-center">
                    <div className="col-md-8 col-lg-6">
                        <PinVerificationCard
                            title={`Enter PIN for ${user?.title || user?.username || 'Admin'}`}
                            backLabel="Cancel"
                            loadingMessage="Verifying Admin PIN..."
                            onVerify={async pin => {
                                await verifyAdminPin(pin);
                                sessionStorage.setItem('pasta_profile_selected', 'true');
                                setHasSelectedProfile(true);
                                setIsAdminPinPhase(false);
                                setActiveView('admin');
                            }}
                            onBack={() => setIsAdminPinPhase(false)}
                        />
                    </div>
                </div>
            </div>
        );
    } else if (isShowingUserSelection) {
        // 1. User Selection Phase (Happens FIRST after login before Server Selection, or when clicking Switch User)
        content = (
            <div className="container mt-5">
                <div className="row justify-content-center">
                    <div className="col-md-8 col-lg-6">
                        {(checkingInitialUsers || isUserSelectionPhase) && homeUsers.length === 0 ? (
                            <div className="text-center py-5">
                                <div className="spinner-border text-warning" role="status" />
                            </div>
                        ) : (
                            <ManagedUserSelection
                                users={homeUsers}
                                onSelect={handleUserSelect}
                                onCancel={
                                    hasSelectedProfile && !requiresAdminPin
                                        ? handleCancelUserSelection
                                        : undefined
                                }
                            />
                        )}
                    </div>
                </div>
            </div>
        );
    } else if (activeView === 'admin') {
        // 2. Admin Settings View (Accessible from Profile Dropdown or ServerSelection row)
        content = (
            <AdminConsole
                initialMachineIdentifier={adminMachineId}
                onSelectMachineIdentifier={setAdminMachineId}
                onBack={() => setActiveView('browser')}
            />
        );
    } else if (activeView === 'logs' && hasTargetServer) {
        // 3. Manual Batch Logs View (Accessible from Profile Dropdown)
        content = (
            <BatchHistory
                machineIdentifierOverride={effectiveAdminMachineId}
                onBack={() => setActiveView('browser')}
            />
        );
    } else if (isServerConnected) {
        // 4. Connected (MediaBrowser)
        content = (
            <div className="container-fluid py-2">
                <MediaBrowser />
            </div>
        );
    } else {
        // 5. Not Connected (Server Selection)
        content = (
            <div className="container mt-5">
                <div className="row justify-content-center">
                    <div className="col-md-8 col-lg-6">
                        <ServerSelection
                            onConnect={handleServerConnect}
                            onOpenAdminSettings={handleOpenAdminSettings}
                        />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <>
            <Header {...headerProps} />
            {connectingFromMenu && <LoadingOverlay message="Connecting to server..." />}
            {content}
        </>
    );
};
