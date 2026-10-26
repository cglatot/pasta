import React, { useState, Suspense } from 'react';
import { useMediaBrowser } from '../hooks/useMediaBrowser';
import { useBatchUpdater } from '../hooks/useBatchUpdater';
import { MediaNavigation } from './Media/MediaNavigation';
import { AudioTable } from './Tracks/AudioTable';
import { SubtitleTable } from './Tracks/SubtitleTable';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuth } from '../context/AuthContext';

// Lazy load ProgressModal
const ProgressModal = React.lazy(() => import('./Layout/ProgressModal').then(module => ({ default: module.ProgressModal })));
import { LoadingOverlay } from './Layout/LoadingOverlay';
import { ErrorMessage } from './Layout/ErrorMessage';
import { WarningModal } from './Layout/WarningModal';
import { useSettings } from '../context/SettingsContext';

export const MediaBrowser: React.FC = () => {
    const isMobile = useIsMobile();
    const { navWidth } = useSettings();
    const { clearServer, logout, serverUrl } = useAuth();
    const {
        libraries,
        serverName,
        selectedLibrary,
        shows,
        selectedShow,
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
        refreshEpisode
    } = useMediaBrowser();

    const { progress, updateSeason, updateShow, updateLibrary, updateSingleEpisode, resetProgress, cancelBatch } = useBatchUpdater();
    const [audioKeyword, setAudioKeyword] = useState<string>('');
    const [subtitleKeyword, setSubtitleKeyword] = useState<string>('');
    const [isLibraryMode, setIsLibraryMode] = useState(false);
    const [showWarning, setShowWarning] = useState(false);

    // Reset Library Mode when navigating
    React.useEffect(() => {
        setIsLibraryMode(false);
    }, [selectedLibrary?.key, selectedShow?.ratingKey, selectedSeason?.ratingKey, selectedEpisode?.ratingKey, serverName]);

    // Auto-scroll to top on desktop when an episode is selected
    React.useEffect(() => {
        if (!isMobile && selectedEpisode) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }, [selectedEpisode, isMobile]);

    const handleStreamUpdate = async (streamId: number, scope: 'episode' | 'season' | 'show' | 'library', type: 'audio' | 'subtitle') => {
        if (!selectedEpisode) return;

        const part = selectedEpisode.Media?.[0]?.Part?.[0];
        if (!part) return;

        const targetStream = streamId === 0
            ? null
            : part.Stream?.find(s => s.id === streamId) || null;

        const keyword = type === 'audio' ? audioKeyword : subtitleKeyword;

        if (scope === 'episode') {
            await updateSingleEpisode(selectedEpisode, targetStream, type, keyword, false, true);
            await refreshEpisode();
        } else if (scope === 'season') {
            if (selectedSeason) {
                await updateSeason(selectedSeason, targetStream, type, keyword);
                await refreshEpisode();
            } else {
                alert('No season selected');
            }
        } else if (scope === 'show') {
            if (selectedShow) {
                await updateShow(selectedShow, targetStream, type, keyword);
                await refreshEpisode();
            } else {
                alert('No show selected');
            }
        } else if (scope === 'library') {
            if (selectedLibrary) {
                await updateLibrary(selectedLibrary, targetStream, type, keyword);
                await refreshEpisode();
            } else {
                alert('No library selected');
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
        if (!selectedShow && selectedLibrary.type !== 'movie') return 'Loading shows...';
        if (selectedLibrary.type === 'movie') return 'Loading movies...';
        if (!selectedSeason) return 'Loading seasons...';
        if (!selectedEpisode) return 'Loading episodes...';
        return 'Loading track information...';
    };

    // Breadcrumb / Header Logic
    const renderHeader = () => {
        const isMovie = selectedLibrary?.type === 'movie';

        return (
            <div className="row">
                <div className="col-12">
                    <nav aria-label="breadcrumb" className="mb-2">
                        <ol className="breadcrumb mb-0" style={{ padding: '6px 4px' }}>
                            <li className={`breadcrumb-item ${!selectedLibrary ? 'active' : ''}`}>
                                {serverName || 'Server'}
                            </li>
                            {selectedLibrary && (
                                <li className={`breadcrumb-item ${(!selectedShow && !isMovie) || isMovie ? 'active' : ''}`}>
                                    {selectedLibrary.title}
                                </li>
                            )}
                            {!isMovie && selectedShow && (
                                <li className={`breadcrumb-item ${!selectedSeason ? 'active' : ''}`}>
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
                            Could not reach <strong>{serverName || 'Plex Server'}</strong>{serverUrl ? <> at <code>{serverUrl}</code></> : null}.
                            <br />
                            The server may be offline, its IP address may have changed, or your connection may be blocked.
                        </p>

                        <div className="d-flex justify-content-center gap-3 my-4 flex-wrap">
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={handleRetryConnection}
                                disabled={isReconnecting}
                            >
                                <i className={`fas fa-sync-alt me-2 ${isReconnecting ? 'fa-spin' : ''}`}></i>
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
                        <div className="alert alert-secondary text-start mx-auto mt-3" style={{ maxWidth: '650px' }}>
                            <h6 className="fw-bold mb-2">
                                <i className="fas fa-info-circle me-2 text-warning"></i>
                                Troubleshooting Tips
                            </h6>
                            <ul className="mb-0 small text-muted">
                                <li>
                                    <strong>Ad & Privacy Blockers:</strong> Extensions like <em>uBlock Origin</em>, <em>Privacy Badger</em>, or <em>Brave Shields</em> can block direct browser calls to <code>*.plex.direct</code>. Try whitelisting this site.
                                </li>
                                <li>
                                    <strong>DNS Rebinding:</strong> Add <code>plex.direct</code> to your router&apos;s DNS rebinding exception list.
                                </li>
                                <li>
                                    <strong>LAN Access:</strong> If connecting locally, check that your Plex Server has <em>Secure connections</em> set to Preferred rather than Required, or access PASTA over plain HTTP.
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="container-fluid">
            {loading && <LoadingOverlay message={getLoadingMessage()} onChangeServer={clearServer} />}
            <Suspense fallback={null}>
                <ProgressModal
                    show={progress.isProcessing || (progress.results.length > 0 && progress.current === progress.total)}
                    title="Updating Tracks..."
                    progress={progress}
                    onClose={() => {
                        resetProgress();
                    }}
                    onCancel={cancelBatch}
                />
            </Suspense>

            {error && !isConnectionError && <ErrorMessage message={error} />}

            <WarningModal
                show={showWarning}
                onAccept={(dontShowAgain) => {
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
                    style={!isMobile ? { width: `${navWidth}%`, flex: `0 0 ${navWidth}%` } : undefined}
                >
                    <MediaNavigation
                        libraries={libraries}
                        selectedLibrary={selectedLibrary}
                        onSelectLibrary={selectLibrary}
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
                            <div className="d-flex justify-content-between align-items-center mb-1">
                                <h3>{selectedEpisode.title}</h3>
                                <div className="form-check form-switch d-flex align-items-center ps-0 gap-2">
                                    <input
                                        className="form-check-input ms-0 mt-0"
                                        type="checkbox"
                                        role="switch"
                                        id="libraryModeSwitch"
                                        checked={isLibraryMode}
                                        onChange={toggleLibraryMode}
                                    />
                                    <label className="form-check-label fw-bold" htmlFor="libraryModeSwitch" style={{ fontSize: '1rem' }}>
                                        Apply to Library
                                    </label>
                                </div>
                            </div>

                            {selectedEpisode.Media?.[0]?.Part?.[0]?.Stream ? (
                                <div className="row">
                                    <div className={isMobile ? 'col-12' : 'col-md-6'}>
                                        <AudioTable
                                            streams={selectedEpisode.Media[0].Part[0].Stream}
                                            onSelect={(id, scope) => handleStreamUpdate(id, scope, 'audio')}
                                            keyword={audioKeyword}
                                            onKeywordChange={setAudioKeyword}
                                            isMovie={selectedLibrary?.type === 'movie'}
                                            isLibraryMode={isLibraryMode}
                                        />
                                    </div>
                                    <div className={isMobile ? 'col-12' : 'col-md-6'}>
                                        <SubtitleTable
                                            streams={selectedEpisode.Media[0].Part[0].Stream}
                                            onSelect={(id, scope) => handleStreamUpdate(id, scope, 'subtitle')}
                                            keyword={subtitleKeyword}
                                            onKeywordChange={setSubtitleKeyword}
                                            isMovie={selectedLibrary?.type === 'movie'}
                                            isLibraryMode={isLibraryMode}
                                        />
                                    </div>
                                </div>
                            ) : (
                                <div className="alert alert-warning">No media information found for this episode.</div>
                            )}
                        </div>
                    ) : (
                        <div className="text-center text-muted my-5">
                            <h4>
                                {!selectedLibrary ? 'Select a Library' :
                                    selectedLibrary.type === 'movie' && !selectedEpisode ? 'Select a Movie' :
                                        !selectedShow ? 'Select a Show' :
                                            !selectedSeason ? 'Select a Season' :
                                                'Select an Episode'}
                            </h4>
                            <p>
                                <span className="d-md-none">Navigate using the menu above</span>
                                <span className="d-none d-md-inline">Navigate using the menu on the left</span>
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
