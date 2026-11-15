import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useAuth } from '../../context/AuthContext';
import { isUnmountedConfigFallback } from '../../providers/PastaProvider';
import { useHomeUsers } from '../../hooks/usePlexQueries';
import { useIsMobile } from '../../hooks/useIsMobile';
import {
    syncModalVisibilityWithServerEvent,
    useBatchModalVisibility,
} from '../../hooks/useBatchUpdater';
import {
    cancelServerBatchJob,
    dismissServerBatchJob,
    fetchActiveServerBatch,
    resetServerBatchEventStream,
    subscribeToServerBatchEvents,
    type ServerBatchProgressEvent,
} from '../../providers/server/sseClient';
import { ModalDialog } from './ModalDialog';
import { SettingsModal } from './SettingsModal';

const ProgressModal = React.lazy(() =>
    import('./ProgressModal').then(module => ({ default: module.ProgressModal }))
);

export type AppScreenPhase =
    | 'server-selection'
    | 'user-selection'
    | 'pin-verification'
    | 'browser'
    | 'logs'
    | 'admin';

interface Props {
    currentScreen?: AppScreenPhase;
    onSwitchUser?: () => void;
    onReconnectServer?: () => void;
    onChangeServer?: () => void;
    onOpenBrowser?: () => void;
    onOpenLogs?: () => void;
    onOpenAdminSettings?: () => void;
}

export const Header: React.FC<Props> = ({
    currentScreen = 'browser',
    onSwitchUser,
    onReconnectServer,
    onChangeServer,
    onOpenBrowser,
    onOpenLogs,
    onOpenAdminSettings,
}) => {
    const {
        user,
        logout,
        clearServer,
        isAuthenticated,
        isServerConnected,
        isServerMode,
        pastaRole,
        managedServers,
        clientIdentifier,
        accessToken,
        adminToken,
        isSharedServer,
        isManagedUser,
        machineIdentifier,
    } = useAuth();
    const [showHelpModal, setShowHelpModal] = useState(false);
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const [hasManagedUsers, setHasManagedUsers] = useState(false);
    const [activeBatch, setActiveBatch] = useState<ServerBatchProgressEvent | null>(null);
    const { isMinimized, minimizeModal, reopenModal } = useBatchModalVisibility();
    const isMobile = useIsMobile();
    const dropdownRef = useRef<HTMLDivElement>(null);

    const isUnmountedFallback = !isServerMode && isUnmountedConfigFallback();
    const bannerStorageKey = isUnmountedFallback
        ? 'pasta_v3_unmounted_banner_dismissed'
        : 'pasta_v3_client_banner_dismissed';
    const [isBannerDismissed, setIsBannerDismissed] = useState(() => {
        try {
            return localStorage.getItem(bannerStorageKey) === 'true';
        } catch {
            return false;
        }
    });

    const handleDismissBanner = () => {
        try {
            localStorage.setItem(bannerStorageKey, 'true');
        } catch {
            // Ignore localStorage quota/privacy errors
        }
        setIsBannerDismissed(true);
    };

    const canAccessAdminSettings =
        isServerMode &&
        (pastaRole === 'owner' ||
            pastaRole === 'admin' ||
            (managedServers && managedServers.length > 0));

    // Close the user dropdown when clicking anywhere outside it or pressing Escape
    useEffect(() => {
        if (!showDropdown) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setShowDropdown(false);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setShowDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [showDropdown]);

    // Subscribe to live server batch events for the Header Status Pill
    useEffect(() => {
        if (!isServerMode || !isAuthenticated) return;
        resetServerBatchEventStream();
        void fetchActiveServerBatch(machineIdentifier);
        return subscribeToServerBatchEvents(evt => {
            syncModalVisibilityWithServerEvent(evt);
            setActiveBatch(evt);
        });
    }, [isServerMode, isAuthenticated, machineIdentifier, user?.id]);

    const { data: homeUsers } = useHomeUsers(
        clientIdentifier,
        adminToken || accessToken,
        machineIdentifier
    );

    useEffect(() => {
        if (homeUsers) {
            setHasManagedUsers(homeUsers.length > 1);
        }
    }, [homeUsers]);

    const showStatusPill =
        isServerMode &&
        isMinimized &&
        activeBatch &&
        (activeBatch.progress.isProcessing ||
            (activeBatch.progress.results.length > 0 &&
                activeBatch.progress.total > 0));

    // Determine which profile menu items belong to the current screen phase
    const isProfileActivePhase =
        currentScreen === 'browser' ||
        currentScreen === 'logs' ||
        currentScreen === 'admin';

    const showReconnectServer =
        currentScreen === 'browser' && isServerConnected && Boolean(onReconnectServer);
    const showChangeServer =
        isProfileActivePhase &&
        !isManagedUser &&
        (isServerConnected || currentScreen === 'admin' || currentScreen === 'logs');
    const showSwitchUser =
        (isProfileActivePhase || currentScreen === 'server-selection') &&
        hasManagedUsers &&
        Boolean(onSwitchUser) &&
        (!isSharedServer || isServerMode);

    const showMediaBrowserItem =
        (currentScreen === 'logs' || currentScreen === 'admin') &&
        Boolean(onOpenBrowser);
    const showUserSettings = currentScreen === 'browser' && isServerConnected;
    const showLogs =
        isProfileActivePhase &&
        currentScreen !== 'logs' &&
        isServerMode &&
        Boolean(onOpenLogs);
    const showAdminSettings =
        (isProfileActivePhase || currentScreen === 'server-selection') &&
        currentScreen !== 'admin' &&
        canAccessAdminSettings &&
        Boolean(onOpenAdminSettings);

    const hasServerGroup = showReconnectServer || showChangeServer || showSwitchUser;
    const hasViewGroup =
        showMediaBrowserItem || showUserSettings || showLogs || showAdminSettings;

    return (
        <>
            <nav className="navbar navbar-expand-lg navbar-dark static-top" style={{ backgroundColor: '#0d0d0d' }}>
                <div className={`container-fluid ${isMobile ? 'flex-column' : 'd-flex justify-content-between'} px-5`}>
                    <div className={isMobile ? 'w-100 text-center mb-2' : 'd-flex align-items-end'}>
                        <a className="navbar-brand" href="/" style={isMobile ? { marginRight: 0 } : undefined}>
                            <img src="/images/Logo_Title_Large.png" alt="PASTA" height="50" />
                        </a>
                    </div>

                    <div className={`d-flex align-items-center ${isMobile ? 'w-100 justify-content-center flex-wrap gap-2' : ''}`}>
                        {showStatusPill && activeBatch && (
                            <button
                                type="button"
                                className="btn btn-outline-primary btn-sm me-3 d-flex align-items-center"
                                onClick={() => (isMinimized ? reopenModal() : minimizeModal())}
                                title={
                                    isMinimized
                                        ? 'Click to open batch progress'
                                        : 'Click to minimize batch progress'
                                }
                            >
                                <i
                                    className={`fas ${
                                        activeBatch.progress.isProcessing
                                            ? 'fa-sync-alt fa-spin'
                                            : 'fa-check-circle'
                                    } me-2`}
                                ></i>
                                <span>
                                    {activeBatch.progress.total > 0
                                        ? `Updating ${activeBatch.targetTitle}: ${activeBatch.progress.current} / ${activeBatch.progress.total}`
                                        : `Queued: ${activeBatch.targetTitle}`}
                                    {activeBatch.progress.queuedJobs &&
                                    activeBatch.progress.queuedJobs.length > 0
                                        ? ` (+${activeBatch.progress.queuedJobs.length} queued)`
                                        : ''}
                                </span>
                            </button>
                        )}

                        {isAuthenticated && user && (
                            <div className="dropdown me-3" ref={dropdownRef}>
                                <button
                                    type="button"
                                    aria-haspopup="menu"
                                    aria-expanded={showDropdown}
                                    className="btn btn-link text-light text-decoration-none d-flex align-items-center p-0"
                                    onClick={() => setShowDropdown(!showDropdown)}
                                >
                                    <img
                                        src={user.thumb}
                                        alt={user.username}
                                        className="rounded-circle me-2"
                                        style={{ width: 32, height: 32 }}
                                    />
                                    <span>{user.username || user.title}</span>
                                    <i className={`fas fa-chevron-${showDropdown ? 'up' : 'down'} ms-2 small`} aria-hidden="true"></i>
                                </button>
                                {showDropdown && (
                                    <ul role="menu" className="dropdown-menu dropdown-menu-end show" style={{ position: 'absolute', right: 0 }}>
                                        {showReconnectServer && onReconnectServer && (
                                            <li>
                                                <button className="dropdown-item" onClick={() => { onReconnectServer(); setShowDropdown(false); }}>
                                                    <i className="fas fa-sync-alt me-2"></i>
                                                    Reconnect Server
                                                </button>
                                            </li>
                                        )}
                                        {showChangeServer && (
                                            <li>
                                                <button
                                                    className="dropdown-item"
                                                    onClick={() => {
                                                        clearServer();
                                                        onChangeServer?.();
                                                        setShowDropdown(false);
                                                    }}
                                                >
                                                    <i className="fas fa-server me-2"></i>
                                                    Change Server
                                                </button>
                                            </li>
                                        )}
                                        {showSwitchUser && onSwitchUser && (
                                            <li>
                                                <button className="dropdown-item" onClick={() => { onSwitchUser(); setShowDropdown(false); }}>
                                                    <i className="fas fa-user-friends me-2"></i>
                                                    Switch User
                                                </button>
                                            </li>
                                        )}
                                        {hasServerGroup && hasViewGroup && (
                                            <li><hr className="dropdown-divider" /></li>
                                        )}
                                        {showMediaBrowserItem && onOpenBrowser && (
                                            <li>
                                                <button
                                                    className="dropdown-item"
                                                    onClick={() => {
                                                        onOpenBrowser();
                                                        setShowDropdown(false);
                                                    }}
                                                >
                                                    <i className="fas fa-film me-2"></i>
                                                    Media Browser
                                                </button>
                                            </li>
                                        )}
                                        {showUserSettings && (
                                            <li>
                                                <button
                                                    className="dropdown-item"
                                                    onClick={() => {
                                                        setShowSettingsModal(true);
                                                        setShowDropdown(false);
                                                    }}
                                                >
                                                    <i className="fas fa-sliders-h me-2"></i>
                                                    User Settings
                                                </button>
                                            </li>
                                        )}
                                        {showLogs && onOpenLogs && (
                                            <li>
                                                <button
                                                    className="dropdown-item"
                                                    onClick={() => {
                                                        onOpenLogs();
                                                        setShowDropdown(false);
                                                    }}
                                                >
                                                    <i className="fas fa-list-ul me-2"></i>
                                                    Logs
                                                </button>
                                            </li>
                                        )}
                                        {showAdminSettings && onOpenAdminSettings && (
                                            <li>
                                                <button
                                                    className="dropdown-item"
                                                    style={{ color: '#F39C12' }}
                                                    onClick={() => {
                                                        onOpenAdminSettings();
                                                        setShowDropdown(false);
                                                    }}
                                                >
                                                    <i className="fas fa-shield-alt me-2"></i>
                                                    Admin Settings
                                                </button>
                                            </li>
                                        )}
                                        {(hasServerGroup || hasViewGroup) && (
                                            <li><hr className="dropdown-divider" /></li>
                                        )}
                                        <li>
                                            <button className="dropdown-item text-danger" onClick={() => { logout(); setShowDropdown(false); }}>
                                                <i className="fas fa-sign-out-alt me-2"></i>
                                                Logout
                                            </button>
                                        </li>
                                    </ul>
                                )}
                            </div>
                        )}

                        <a href="https://ko-fi.com/cglatot" target="_blank" rel="noreferrer" className="text-warning ms-3">
                            <i className="fas fa-mug-hot fa-lg"></i>
                        </a>
                        <a href="https://hub.docker.com/r/cglatot/pasta" target="_blank" rel="noreferrer" className="text-warning ms-3">
                            <i className="fab fa-docker fa-lg"></i>
                        </a>
                        <a href="https://github.com/cglatot/pasta" target="_blank" rel="noreferrer" className="text-warning ms-3">
                            <i className="fab fa-github fa-lg"></i>
                        </a>
                        <button
                            onClick={() => setShowHelpModal(true)}
                            className="btn btn-link text-warning ms-3 p-0"
                            style={{ border: 'none', background: 'none' }}
                        >
                            <i className="far fa-circle-question fa-lg"></i>
                        </button>
                    </div>
                </div>
            </nav>

            {!isServerMode && !isBannerDismissed && (
                <div
                    className="container-fluid py-2 px-3 mb-3 border-bottom"
                    style={{
                        backgroundColor: isUnmountedFallback
                            ? 'rgba(243, 156, 18, 0.14)'
                            : 'rgba(243, 156, 18, 0.09)',
                        borderColor: 'rgba(243, 156, 18, 0.35)',
                    }}
                    role="region"
                    aria-label="PASTA Server Mode Notice"
                >
                    <div className="container d-flex align-items-center justify-content-between gap-3">
                        <div className="small text-light">
                            {isUnmountedFallback ? (
                                <>
                                    <i
                                        className="fas fa-exclamation-triangle me-2"
                                        style={{ color: '#F39C12' }}
                                        aria-hidden="true"
                                    ></i>
                                    <strong>Server Mode Available (Setup Required):</strong> PASTA
                                    3.0 now includes Server Mode for automatic background audio
                                    &amp; subtitle updates, but your container is currently running
                                    in <strong>Client Mode</strong> because <code>/config</code> is
                                    not mapped to persistent storage. To enable Server Mode, add a{' '}
                                    <code>/config</code> path mapping (e.g.{' '}
                                    <code>/mnt/user/appdata/pasta</code> on Unraid) and ensure{' '}
                                    <code>PASTA_MODE=server</code> is set in your container settings
                                    (or re-pull the updated PASTA template in Unraid Community
                                    Applications).{' '}
                                    <a
                                        href="https://github.com/cglatot/pasta#installation"
                                        target="_blank"
                                        rel="noreferrer"
                                        className="fw-bold text-decoration-underline"
                                        style={{ color: '#F39C12' }}
                                    >
                                        Setup Guide ↗
                                    </a>
                                </>
                            ) : (
                                <>
                                    <i
                                        className="fas fa-bolt me-2"
                                        style={{ color: '#F39C12' }}
                                        aria-hidden="true"
                                    ></i>
                                    <strong>New in PASTA 3.0 - Server Mode:</strong> You can now
                                    self-host PASTA in <strong>Server Mode</strong> (via Docker or
                                    Unraid) for automatic background audio &amp; subtitle updates
                                    across all of your devices and users!{' '}
                                    <a
                                        href="https://github.com/cglatot/pasta#readme"
                                        target="_blank"
                                        rel="noreferrer"
                                        className="fw-bold text-decoration-underline"
                                        style={{ color: '#F39C12' }}
                                    >
                                        Learn more on GitHub ↗
                                    </a>
                                </>
                            )}
                        </div>
                        <button
                            type="button"
                            className="btn-close flex-shrink-0"
                            onClick={handleDismissBanner}
                            aria-label="Dismiss notice"
                            title="Dismiss"
                        ></button>
                    </div>
                </div>
            )}

            <SettingsModal show={showSettingsModal} onClose={() => setShowSettingsModal(false)} />

            <ModalDialog
                show={showHelpModal}
                dialogClassName="modal-xl"
                onClose={() => setShowHelpModal(false)}
                closeOnBackdrop
            >
                <div className="modal-content">
                    <div className="modal-header">
                        <h5 className="modal-title">Help & About</h5>
                        <button
                            type="button"
                            className="btn-close"
                            onClick={() => setShowHelpModal(false)}
                            aria-label="Close"
                        ></button>
                    </div>
                            <div className="modal-body">
                                <p>
                                    Version:{' '}
                                    <a href="https://github.com/cglatot/pasta/releases" target="_blank" rel="noreferrer">
                                        v{__APP_VERSION__}
                                    </a>{' '}
                                    ({isServerMode ? 'Server Mode' : 'Client Mode'}) &bull;{' '}
                                    <a href="https://github.com/cglatot/pasta#readme" target="_blank" rel="noreferrer">
                                        Documentation &amp; Setup Guide
                                    </a>
                                </p>
                                <p>Encountered a bug, or have a feature request? Log it here:
                                    <a href="https://github.com/cglatot/pasta/issues" target="_blank" rel="noreferrer"> https://github.com/cglatot/pasta/issues</a>
                                </p>
                                <h3>What is PASTA?</h3>
                                <p>Do you watch TV Shows with multiple languages and subtitles and wish you could change them for the
                                    entire show, rather than needing to do it for <em>every. single. episode</em>?
                                    Or maybe you aren't sure what the difference is between those 2 <strong>English (SRT)</strong> and
                                    <strong> English (SRT)</strong> subtitle files. Then PASTA is for you!
                                    <br />PASTA allows you to connect to your Plex server and view more details about the audio tracks and
                                    subtitles, as well as set the tracks and subtitles for entire libraries, collections, shows, seasons, or single episodes very quickly.
                                </p>
                                <h3>How do I use PASTA?</h3>
                                <ol>
                                    <li><strong>Select a Library &amp; Media:</strong> Choose a TV Show, Movie, or Collection, then pick an episode or movie to inspect its audio and subtitle streams.</li>
                                    <li><strong>Choose Your Tracks:</strong> Click the audio track or subtitle you want to set (or use the keyword filter to narrow down tracks across episodes).</li>
                                    <li><strong>Choose the Scope:</strong> Apply your selection to just that <strong>Episode</strong>, the entire <strong>Season</strong>, the <strong>Entire Show</strong>, the <strong>Entire Collection</strong>, or the <strong>Entire Library</strong>.</li>
                                    {isServerMode && (
                                        <li>
                                            <strong>Target Users:</strong> Use the <em>Target Users</em> selector in the confirmation dialog to apply track changes to the <strong>Current User</strong>, <strong>All Users</strong>, or <strong>Specific Users</strong> who have access to that library.
                                        </li>
                                    )}
                                </ol>
                                {isServerMode ? (
                                    <>
                                        <h3>Server Mode &amp; Admin Settings</h3>
                                        <ul>
                                            <li><strong>Admin Settings:</strong> Server Owners and designated PASTA Admins can open <strong>Admin Settings</strong> from the user menu (or server selection screen) to configure TV track automation, per-library and per-show language/keyword rules, forced subtitle handling, and user permissions.</li>
                                            <li><strong>Logs:</strong> View your manual batch update history via <strong>Logs</strong> in the user menu, or inspect automated background scan activity inside <strong>Admin Settings &rarr; Logs</strong>.</li>
                                        </ul>
                                    </>
                                ) : (
                                    <>
                                        <h3>Want Background Automation? (Server Mode)</h3>
                                        <ul>
                                            <li>You are currently using PASTA in browser-only <strong>Client Mode</strong>.</li>
                                            <li>PASTA can also be run locally in <strong>Server Mode</strong> (via Docker or Unraid Community Applications) to automatically apply audio and subtitle preferences whenever new or upgraded TV episodes are added to Plex, batch-update tracks across all of your Plex Home &amp; Shared users at once, and manage per-library/per-show automation rules.</li>
                                            <li>See the <a href="https://github.com/cglatot/pasta#readme" target="_blank" rel="noreferrer">GitHub README</a> for full documentation and self-hosting instructions.</li>
                                        </ul>
                                    </>
                                )}
                                <h3>About PASTA</h3>
                                <p>When I first began developing this for myself, I was calling it <em>Audio Track Automation for Plex</em>,
                                    so adding "subtitles" to it, and rearranging the letters gave birth to PASTA.
                                </p>
                                <p>PASTA was born out of a desire, one that I had seen others have as well, but that I had only
                                    seen one other solution for. However, it was in command line and I wanted something a bit more appealing to look at, and something I could
                                    use from anywhere.
                                    Initially I was only building this for myself but I thought that others might find use for
                                    it as well, so here we are!
                                </p>
                                {isServerMode ? (
                                    <p>
                                        This instance is running in self-hosted <strong>Server Mode</strong>, communicating directly between your local PASTA container and your Plex server. Feel free to visit the{' '}
                                        <a href="https://github.com/cglatot/pasta" target="_blank" rel="noreferrer">GitHub repository</a> to read the full documentation, check for updates, or make suggestions.
                                    </p>
                                ) : (
                                    <p>
                                        In Client Mode, PASTA runs entirely in your browser. This means that you are not passing anything to someone's
                                        server to do this (other than the Plex Server), and it also means I don't
                                        have to worry about standing up a server to do that side of things either :). Feel free to visit the{' '}
                                        <a href="https://github.com/cglatot/pasta" target="_blank" rel="noreferrer">GitHub repository</a> to download it yourself, run it locally in Client or Server Mode, or make suggestions.
                                    </p>
                                )}
                                <h3>Cookie Policy</h3>
                                <p>The site uses some minor technical cookies and local browser storage to help improve your experience (for example, remembering your session if you choose that option).
                                    Third-party tracking cookies are not used on this site. By continuing to use this site, you agree to the use of these functional cookies.
                                </p>
                                <div className="text-center my-3">
                                    <a href="https://ko-fi.com/cglatot" target="_blank" rel="noreferrer" className="btn btn-warning btn-lg text-dark fw-bold">
                                        <i className="fas fa-mug-hot me-2"></i>
                                        Buy me a coffee on Ko-fi
                                    </a>
                                </div>
                                <p className="mb-0">Enjoying the tool? Consider adding to my coffee funds :)</p>
                            </div>
                        </div>
            </ModalDialog>

            {isServerMode && currentScreen !== 'browser' && activeBatch && (
                <Suspense fallback={null}>
                    <ProgressModal
                        show={
                            !isMinimized &&
                            (activeBatch.progress.isProcessing ||
                                (activeBatch.progress.results.length > 0 &&
                                    activeBatch.progress.total > 0))
                        }
                        title="Updating Tracks..."
                        progress={activeBatch.progress}
                        onMinimize={minimizeModal}
                        onCancel={() => void cancelServerBatchJob(activeBatch.jobId)}
                        onCancelQueuedJob={jobId => void cancelServerBatchJob(jobId)}
                        onClose={() => {
                            if (activeBatch.progress.isProcessing) {
                                minimizeModal();
                            } else {
                                void dismissServerBatchJob(activeBatch.jobId);
                                minimizeModal();
                            }
                        }}
                    />
                </Suspense>
            )}
        </>
    );
};
