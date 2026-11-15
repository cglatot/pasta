import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useMediaBrowser } from '../hooks/useMediaBrowser';
import { useBatchUpdater, useBatchModalVisibility } from '../hooks/useBatchUpdater';
import { MediaNavigation } from './Media/MediaNavigation';
import { AudioTable } from './Tracks/AudioTable';
import { SubtitleTable } from './Tracks/SubtitleTable';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuth } from '../context/AuthContext';
import type { TargetUsersSelection } from '../types/batchTypes';

// Lazy load ProgressModal
const ProgressModal = React.lazy(() =>
    import('./Layout/ProgressModal').then(module => ({ default: module.ProgressModal }))
);
import { LoadingOverlay } from './Layout/LoadingOverlay';
import { ErrorMessage } from './Layout/ErrorMessage';
import { WarningModal } from './Layout/WarningModal';
import { NoticeModal } from './Layout/NoticeModal';
import { useSettings } from '../context/SettingsContext';

interface ServerUserOption {
    plexUserId: number;
    username: string;
    title: string;
    isServerOwner: boolean;
    isHomeUser: boolean;
    isPastaAdmin: boolean;
}

export const MediaBrowser: React.FC = () => {
    const isMobile = useIsMobile();
    const { navWidth } = useSettings();
    const {
        clearServer,
        logout,
        serverUrl,
        isServerMode,
        pastaRole,
        machineIdentifier,
        user,
    } = useAuth();
    const {
        libraries,
        serverName,
        selectedLibrary,
        browseMode,
        setBrowseMode,
        shows,
        selectedShow,
        selectedCollection,
        seasons,
        selectedSeason,
        episodes,
        selectedEpisode,
        loading,
        error,
        isConnectionError,
        isReconnecting,
        handleRetryConnection,
        selectLibrary,
        selectShow,
        selectSeason,
        selectEpisode,
        refreshEpisode,
    } = useMediaBrowser();

    const {
        progress,
        batchNotice,
        clearBatchNotice,
        updateSeason,
        updateShow,
        updateCollection,
        updateLibrary,
        updateSingleEpisode,
        resetProgress,
        cancelBatch,
        cancelQueuedBatch,
    } = useBatchUpdater();
    const { isMinimized, minimizeModal } = useBatchModalVisibility();

    const [audioKeyword, setAudioKeyword] = useState<string>('');
    const [subtitleKeyword, setSubtitleKeyword] = useState<string>('');
    const [isLibraryMode, setIsLibraryMode] = useState(false);
    const [showWarning, setShowWarning] = useState(false);
    const [uiNotice, setUiNotice] = useState<string | null>(null);

    // Progressive-Disclosure Target Users Selector (Admin/Owner only in Server Mode)
    const canSelectTargetUsers =
        isServerMode && (pastaRole === 'owner' || pastaRole === 'admin');
    const [serverUsers, setServerUsers] = useState<ServerUserOption[]>([]);
    const [targetUsersMode, setTargetUsersMode] = useState<'single' | 'all' | 'specific'>('single');
    const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
    const [draftUserIds, setDraftUserIds] = useState<number[]>([]);
    const [showTargetUsersMenu, setShowTargetUsersMenu] = useState(false);
    const [showSpecificUsersChecklist, setShowSpecificUsersChecklist] = useState(false);
    const targetUsersRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!canSelectTargetUsers || !machineIdentifier) {
            setServerUsers([]);
            setTargetUsersMode('single');
            return;
        }
        let cancelled = false;
        fetch(`/api/admin/${encodeURIComponent(machineIdentifier)}/users`, {
            credentials: 'same-origin',
        })
            .then(res => (res.ok ? res.json() : []))
            .then((data: ServerUserOption[]) => {
                if (!cancelled && Array.isArray(data)) {
                    setServerUsers(data);
                    if (user?.id) {
                        setSelectedUserIds([user.id]);
                        setDraftUserIds([user.id]);
                    }
                }
            })
            .catch(() => {
                // Ignore if user list cannot be loaded
            });
        return () => {
            cancelled = true;
        };
    }, [canSelectTargetUsers, machineIdentifier, user?.id]);

    // Close Target Users dropdown when clicking outside
    useEffect(() => {
        if (!showTargetUsersMenu) return;
        const handleOutside = (e: MouseEvent) => {
            if (targetUsersRef.current && !targetUsersRef.current.contains(e.target as Node)) {
                setShowTargetUsersMenu(false);
                setShowSpecificUsersChecklist(false);
            }
        };
        document.addEventListener('mousedown', handleOutside);
        return () => document.removeEventListener('mousedown', handleOutside);
    }, [showTargetUsersMenu]);

    // Reset Library Mode when navigating
    useEffect(() => {
        setIsLibraryMode(false);
    }, [
        selectedLibrary?.key,
        selectedShow?.ratingKey,
        selectedSeason?.ratingKey,
        selectedEpisode?.ratingKey,
        serverName,
    ]);

    // Auto-scroll to top on desktop when an episode is selected
    useEffect(() => {
        if (!isMobile && selectedEpisode) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }, [selectedEpisode, isMobile]);

    const getTargetUsersLabel = (): string => {
        const currentUsername = user?.username || user?.title || 'Me';
        if (targetUsersMode === 'all') {
            return `All Users (${serverUsers.length || 'All'})`;
        }
        if (targetUsersMode === 'specific' && selectedUserIds.length > 0) {
            const names = serverUsers
                .filter(u => selectedUserIds.includes(u.plexUserId))
                .map(u => u.title || u.username);
            if (names.length <= 2 && names.length > 0) {
                return `Users: ${names.join(', ')}`;
            }
            return `Specific Users (${selectedUserIds.length})`;
        }
        return `Current User (${currentUsername})`;
    };

    const getEffectiveTargetUsers = (): TargetUsersSelection | undefined => {
        if (!canSelectTargetUsers) return undefined;
        const label = getTargetUsersLabel();
        if (targetUsersMode === 'all') {
            return { mode: 'all', userIds: [], label };
        }
        if (targetUsersMode === 'specific' && selectedUserIds.length > 0) {
            return { mode: 'specific', userIds: selectedUserIds, label };
        }
        return {
            mode: 'single',
            userIds: user?.id ? [user.id] : [],
            label,
        };
    };

    const toggleDraftUser = (plexUserId: number) => {
        setDraftUserIds(prev =>
            prev.includes(plexUserId)
                ? prev.filter(id => id !== plexUserId)
                : [...prev, plexUserId]
        );
    };

    const applySpecificUsers = () => {
        if (draftUserIds.length === 0) return;
        setSelectedUserIds(draftUserIds);
        setTargetUsersMode('specific');
        setShowTargetUsersMenu(false);
        setShowSpecificUsersChecklist(false);
    };

    const handleStreamUpdate = async (
        streamId: number,
        scope: 'episode' | 'season' | 'show' | 'collection' | 'library',
        type: 'audio' | 'subtitle'
    ) => {
        if (!selectedEpisode) return;

        const part = selectedEpisode.Media?.[0]?.Part?.[0];
        if (!part) return;

        const targetStream =
            streamId === 0 ? null : part.Stream?.find(s => s.id === streamId) || null;

        const keyword = type === 'audio' ? audioKeyword : subtitleKeyword;
        const targetUsers = getEffectiveTargetUsers();

        if (scope === 'episode') {
            await updateSingleEpisode(
                selectedEpisode,
                targetStream,
                type,
                keyword,
                false,
                true,
                targetUsers
            );
            await refreshEpisode();
        } else if (scope === 'season') {
            if (selectedSeason) {
                await updateSeason(selectedSeason, targetStream, type, keyword, targetUsers);
                await refreshEpisode();
            } else {
                setUiNotice('No season selected.');
            }
        } else if (scope === 'show') {
            if (selectedShow) {
                await updateShow(selectedShow, targetStream, type, keyword, targetUsers);
                await refreshEpisode();
            } else {
                setUiNotice('No show selected.');
            }
        } else if (scope === 'collection') {
            if (selectedCollection) {
                await updateCollection(
                    selectedCollection,
                    targetStream,
                    type,
                    keyword,
                    targetUsers
                );
                await refreshEpisode();
            } else {
                setUiNotice('No collection selected.');
            }
        } else if (scope === 'library') {
            if (selectedLibrary) {
                await updateLibrary(selectedLibrary, targetStream, type, keyword, targetUsers);
                await refreshEpisode();
            } else {
                setUiNotice('No library selected.');
            }
        }
    };

    const toggleLibraryMode = () => {
        if (!isLibraryMode) {
            const dismissed = localStorage.getItem('pasta_library_warning_dismissed');
            if (dismissed === 'true') {
                setIsLibraryMode(true);
            } else {
                setShowWarning(true);
            }
        } else {
            setIsLibraryMode(false);
        }
    };

    // Determine loading message based on what's being loaded
    const getLoadingMessage = () => {
        if (isReconnecting) return 'Reconnecting to server...';
        if (!selectedLibrary) return 'Loading libraries...';
        if (browseMode === 'collections' && !selectedShow) return 'Loading collections...';
        if (!selectedShow && selectedLibrary.type !== 'movie') return 'Loading shows...';
        if (selectedLibrary.type === 'movie') return 'Loading movies...';
        if (!selectedSeason) return 'Loading seasons...';
        if (!selectedEpisode) return 'Loading episodes...';
        return 'Loading track information...';
    };

    // Breadcrumb / Header Logic
    const renderHeader = () => {
        const isMovie = selectedLibrary?.type === 'movie' && browseMode === 'all';

        return (
            <div className="row">
                <div className="col-12">
                    <nav aria-label="breadcrumb" className="mb-2">
                        <ol className="breadcrumb mb-0" style={{ padding: '6px 4px' }}>
                            <li className={`breadcrumb-item ${!selectedLibrary ? 'active' : ''}`}>
                                {serverName || 'Server'}
                            </li>
                            {selectedLibrary && (
                                <li
                                    className={`breadcrumb-item ${
                                        (!selectedShow && !isMovie) || isMovie ? 'active' : ''
                                    }`}
                                >
                                    {selectedLibrary.title}
                                </li>
                            )}
                            {!isMovie && selectedShow && (
                                <li
                                    className={`breadcrumb-item ${
                                        !selectedSeason ? 'active' : ''
                                    }`}
                                >
                                    {selectedShow.title}
                                </li>
                            )}
                            {!isMovie && selectedSeason && (
                                <li className="breadcrumb-item active" aria-current="page">
                                    {selectedSeason.title}
                                </li>
                            )}
                        </ol>
                    </nav>
                </div>
            </div>
        );
    };

    // Server connection failure state
    if (isConnectionError && !loading) {
        return (
            <div className="container py-4">
                <div className="card border-warning my-4 p-4 text-center">
                    <div className="card-body">
                        <i className="fas fa-server fa-3x text-warning mb-3"></i>
                        <h4 className="card-title text-warning">Unable to Connect to Server</h4>
                        <p className="card-text text-light">
                            Could not reach <strong>{serverName || 'Plex Server'}</strong>
                            {serverUrl && !isServerMode ? (
                                <>
                                    {' '}
                                    at <code>{serverUrl}</code>
                                </>
                            ) : null}
                            .
                            <br />
                            The server may be offline, its IP address may have changed, or your
                            connection may be blocked.
                        </p>

                        <div className="d-flex justify-content-center gap-3 my-4 flex-wrap">
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={handleRetryConnection}
                                disabled={isReconnecting}
                            >
                                <i
                                    className={`fas fa-sync-alt me-2 ${
                                        isReconnecting ? 'fa-spin' : ''
                                    }`}
                                ></i>
                                {isReconnecting ? 'Reconnecting...' : 'Retry Connection'}
                            </button>
                            <button
                                type="button"
                                className="btn btn-outline-secondary"
                                onClick={clearServer}
                            >
                                <i className="fas fa-exchange-alt me-2"></i>
                                Change Server
                            </button>
                            <button
                                type="button"
                                className="btn btn-outline-danger"
                                onClick={logout}
                            >
                                <i className="fas fa-sign-out-alt me-2"></i>
                                Logout
                            </button>
                        </div>

                        {/* Troubleshooting Hints */}
                        <div
                            className="alert alert-secondary text-start mx-auto mt-3"
                            style={{ maxWidth: '650px' }}
                        >
                            <h6 className="fw-bold mb-2">
                                <i className="fas fa-info-circle me-2 text-warning"></i>
                                Troubleshooting Tips
                            </h6>
                            <ul className="mb-0 small text-muted">
                                <li>
                                    <strong>Ad & Privacy Blockers:</strong> Extensions like{' '}
                                    <em>uBlock Origin</em>, <em>Privacy Badger</em>, or{' '}
                                    <em>Brave Shields</em> can block direct browser calls to{' '}
                                    <code>*.plex.direct</code>. Try whitelisting this site.
                                </li>
                                <li>
                                    <strong>DNS Rebinding:</strong> Add <code>plex.direct</code> to
                                    your router&apos;s DNS rebinding exception list.
                                </li>
                                <li>
                                    <strong>LAN Access:</strong> If connecting locally, check that
                                    your Plex Server has <em>Secure connections</em> set to
                                    Preferred rather than Required, or access PASTA over plain HTTP.
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const showModal =
        !isMinimized &&
        (progress.isProcessing || (progress.results.length > 0 && progress.total > 0));

    return (
        <div className="container-fluid">
            {loading && (
                <LoadingOverlay message={getLoadingMessage()} onChangeServer={clearServer} />
            )}
            <NoticeModal
                show={Boolean(batchNotice || uiNotice)}
                title={uiNotice ? 'Selection Required' : 'Batch Update Notice'}
                message={uiNotice || batchNotice}
                onClose={() => {
                    setUiNotice(null);
                    clearBatchNotice();
                }}
            />
            <Suspense fallback={null}>
                <ProgressModal
                    show={showModal}
                    title="Updating Tracks..."
                    progress={progress}
                    onClose={() => {
                        if (isServerMode && progress.isProcessing) {
                            minimizeModal();
                        } else {
                            resetProgress();
                        }
                    }}
                    onMinimize={isServerMode ? minimizeModal : undefined}
                    onCancel={cancelBatch}
                    onCancelQueuedJob={isServerMode ? cancelQueuedBatch : undefined}
                />
            </Suspense>

            {error && !isConnectionError && <ErrorMessage message={error} />}

            <WarningModal
                show={showWarning}
                onAccept={dontShowAgain => {
                    if (dontShowAgain) {
                        localStorage.setItem('pasta_library_warning_dismissed', 'true');
                    }
                    setShowWarning(false);
                    setIsLibraryMode(true);
                }}
                onCancel={() => {
                    setShowWarning(false);
                    setIsLibraryMode(false);
                }}
            />

            {renderHeader()}

            <div className="row">
                {/* Navigation Column */}
                <div
                    className={`${isMobile ? 'col-12 mb-4 px-3' : ''}`}
                    style={
                        !isMobile
                            ? { width: `${navWidth}%`, flex: `0 0 ${navWidth}%` }
                            : undefined
                    }
                >
                    <MediaNavigation
                        libraries={libraries}
                        selectedLibrary={selectedLibrary}
                        onSelectLibrary={selectLibrary}
                        browseMode={browseMode}
                        onBrowseModeChange={setBrowseMode}
                        shows={shows}
                        selectedShow={selectedShow}
                        onSelectShow={selectShow}
                        seasons={seasons}
                        selectedSeason={selectedSeason}
                        onSelectSeason={selectSeason}
                        episodes={episodes}
                        selectedEpisode={selectedEpisode}
                        onSelectEpisode={selectEpisode}
                    />
                </div>

                {/* Content Column */}
                <div className={`${isMobile ? 'col-12 px-3' : 'col'} position-relative`}>
                    {selectedEpisode ? (
                        <div>
                            <div className="d-flex flex-wrap justify-content-between align-items-center mb-2 gap-3">
                                <h3 className="mb-0">{selectedEpisode.title}</h3>
                                <div className="d-flex flex-wrap align-items-center gap-4">
                                    {canSelectTargetUsers && serverUsers.length > 0 && (
                                        <div
                                            className="position-relative d-flex align-items-center gap-2"
                                            ref={targetUsersRef}
                                        >
                                            <span className="fw-bold small text-light">
                                                Target Users:
                                            </span>
                                            <button
                                                type="button"
                                                className="btn btn-outline-primary btn-sm d-flex align-items-center gap-2"
                                                onClick={() => {
                                                    const nextOpen = !showTargetUsersMenu;
                                                    setShowTargetUsersMenu(nextOpen);
                                                    if (!nextOpen) {
                                                        setShowSpecificUsersChecklist(false);
                                                    }
                                                }}
                                            >
                                                <span>{getTargetUsersLabel()}</span>
                                                <i className="fas fa-chevron-down small"></i>
                                            </button>

                                            {showTargetUsersMenu && (
                                                <div
                                                    className="dropdown-menu dropdown-menu-end show p-0"
                                                    style={{
                                                        position: 'absolute',
                                                        right: 0,
                                                        top: '100%',
                                                        marginTop: '4px',
                                                        minWidth: '250px',
                                                        zIndex: 1050,
                                                    }}
                                                >
                                                    <button
                                                        type="button"
                                                        className="dropdown-item d-flex justify-content-between align-items-center py-2"
                                                        onClick={() => {
                                                            setTargetUsersMode('single');
                                                            setShowTargetUsersMenu(false);
                                                            setShowSpecificUsersChecklist(false);
                                                        }}
                                                    >
                                                        <span>
                                                            Current User (
                                                            {user?.username ||
                                                                user?.title ||
                                                                'Me'}
                                                            )
                                                        </span>
                                                        {targetUsersMode === 'single' && (
                                                            <span style={{ color: '#F39C12' }}>
                                                                ✓
                                                            </span>
                                                        )}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="dropdown-item d-flex justify-content-between align-items-center py-2"
                                                        onClick={() => {
                                                            setTargetUsersMode('all');
                                                            setShowTargetUsersMenu(false);
                                                            setShowSpecificUsersChecklist(false);
                                                        }}
                                                    >
                                                        <span>
                                                            All Users ({serverUsers.length})
                                                        </span>
                                                        {targetUsersMode === 'all' && (
                                                            <span style={{ color: '#F39C12' }}>
                                                                ✓
                                                            </span>
                                                        )}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="dropdown-item d-flex justify-content-between align-items-center py-2"
                                                        onClick={() => {
                                                            setDraftUserIds(
                                                                selectedUserIds.length > 0
                                                                    ? selectedUserIds
                                                                    : user?.id
                                                                      ? [user.id]
                                                                      : []
                                                            );
                                                            setShowSpecificUsersChecklist(true);
                                                        }}
                                                    >
                                                        <span>Specific Users...</span>
                                                        <span
                                                            style={{
                                                                color:
                                                                    targetUsersMode === 'specific'
                                                                        ? '#F39C12'
                                                                        : '#aaa',
                                                            }}
                                                        >
                                                            {targetUsersMode === 'specific'
                                                                ? '✓'
                                                                : '▸'}
                                                        </span>
                                                    </button>

                                                    {showSpecificUsersChecklist && (
                                                        <div className="px-3 py-2 border-top border-secondary">
                                                            <div className="small text-muted fw-bold mb-2">
                                                                Select users to update:
                                                            </div>
                                                            <div
                                                                style={{
                                                                    maxHeight: '180px',
                                                                    overflowY: 'auto',
                                                                }}
                                                            >
                                                                {serverUsers.map(su => (
                                                                    <div
                                                                        key={su.plexUserId}
                                                                        className="form-check mb-1"
                                                                    >
                                                                        <input
                                                                            className="form-check-input"
                                                                            type="checkbox"
                                                                            id={`target-user-${su.plexUserId}`}
                                                                            checked={draftUserIds.includes(
                                                                                su.plexUserId
                                                                            )}
                                                                            onChange={() =>
                                                                                toggleDraftUser(
                                                                                    su.plexUserId
                                                                                )
                                                                            }
                                                                        />
                                                                        <label
                                                                            className="form-check-label small"
                                                                            htmlFor={`target-user-${su.plexUserId}`}
                                                                        >
                                                                            {su.title || su.username}
                                                                        </label>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                            <button
                                                                type="button"
                                                                className="btn btn-primary btn-sm w-100 mt-2"
                                                                disabled={draftUserIds.length === 0}
                                                                onClick={applySpecificUsers}
                                                            >
                                                                Apply Specific Users
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <div className="form-check form-switch d-flex align-items-center ps-0 gap-2 mb-0">
                                        <input
                                            className="form-check-input ms-0 mt-0"
                                            type="checkbox"
                                            role="switch"
                                            id="libraryModeSwitch"
                                            checked={isLibraryMode}
                                            onChange={toggleLibraryMode}
                                        />
                                        <label
                                            className="form-check-label fw-bold"
                                            htmlFor="libraryModeSwitch"
                                            style={{ fontSize: '1rem' }}
                                        >
                                            Apply to Library
                                        </label>
                                    </div>
                                </div>
                            </div>

                            {selectedEpisode.Media?.[0]?.Part?.[0]?.Stream ? (
                                <div className="row">
                                    <div className={isMobile ? 'col-12' : 'col-md-6'}>
                                        <AudioTable
                                            streams={selectedEpisode.Media[0].Part[0].Stream}
                                            onSelect={(id, scope) =>
                                                handleStreamUpdate(id, scope, 'audio')
                                            }
                                            keyword={audioKeyword}
                                            onKeywordChange={setAudioKeyword}
                                            isMovie={selectedLibrary?.type === 'movie'}
                                            isLibraryMode={isLibraryMode}
                                            isCollectionsMode={browseMode === 'collections'}
                                        />
                                    </div>
                                    <div className={isMobile ? 'col-12' : 'col-md-6'}>
                                        <SubtitleTable
                                            streams={selectedEpisode.Media[0].Part[0].Stream}
                                            onSelect={(id, scope) =>
                                                handleStreamUpdate(id, scope, 'subtitle')
                                            }
                                            keyword={subtitleKeyword}
                                            onKeywordChange={setSubtitleKeyword}
                                            isMovie={selectedLibrary?.type === 'movie'}
                                            isLibraryMode={isLibraryMode}
                                            isCollectionsMode={browseMode === 'collections'}
                                        />
                                    </div>
                                </div>
                            ) : (
                                <div className="alert alert-warning">
                                    No media information found for this episode.
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="text-center text-muted my-5">
                            <h4>
                                {!selectedLibrary
                                    ? 'Select a Library'
                                    : browseMode === 'collections' && !selectedShow
                                      ? 'Select a Collection'
                                      : selectedLibrary.type === 'movie' && !selectedEpisode
                                        ? 'Select a Movie'
                                        : !selectedShow
                                          ? 'Select a Show'
                                          : !selectedSeason
                                            ? 'Select a Season'
                                            : 'Select an Episode'}
                            </h4>
                            <p>
                                <span className="d-md-none">Navigate using the menu above</span>
                                <span className="d-none d-md-inline">
                                    Navigate using the menu on the left
                                </span>
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
