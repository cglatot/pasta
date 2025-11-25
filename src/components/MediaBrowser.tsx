import React, { useState, Suspense } from 'react';
import { useMediaBrowser } from '../hooks/useMediaBrowser';
import { useBatchUpdater } from '../hooks/useBatchUpdater';
import { MediaNavigation } from './Media/MediaNavigation';
import { AudioTable } from './Tracks/AudioTable';
import { SubtitleTable } from './Tracks/SubtitleTable';

// Lazy load ProgressModal
const ProgressModal = React.lazy(() => import('./Layout/ProgressModal').then(module => ({ default: module.ProgressModal })));
import { LoadingOverlay } from './Layout/LoadingOverlay';
import { ErrorMessage } from './Layout/ErrorMessage';

export const MediaBrowser: React.FC = () => {
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
        selectLibrary,
        selectShow,
        selectSeason,
        selectEpisode,
        refreshEpisode
    } = useMediaBrowser();

    const { progress, updateSeason, updateShow, updateSingleEpisode, resetProgress } = useBatchUpdater();
    const [audioKeyword, setAudioKeyword] = useState<string>('');
    const [subtitleKeyword, setSubtitleKeyword] = useState<string>('');

    const handleStreamUpdate = async (streamId: number, scope: 'episode' | 'season' | 'show', type: 'audio' | 'subtitle') => {
        if (!selectedEpisode) return;

        const part = selectedEpisode.Media?.[0]?.Part?.[0];
        if (!part) return;

        const targetStream = streamId === 0
            ? null
            : part.Stream.find(s => s.id === streamId) || null;

        const keyword = type === 'audio' ? audioKeyword : subtitleKeyword;

        if (scope === 'episode') {
            await updateSingleEpisode(selectedEpisode, targetStream, type, keyword);
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
        }
    };

    // Determine loading message based on what's being loaded
    const getLoadingMessage = () => {
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

    return (
        <div className="container-fluid">
            {loading && <LoadingOverlay message={getLoadingMessage()} />}
            <Suspense fallback={null}>
                <ProgressModal
                    show={progress.isProcessing || (progress.results.length > 0 && progress.current === progress.total)}
                    title="Updating Tracks..."
                    progress={progress}
                    onClose={() => {
                        resetProgress();
                    }}
                />
            </Suspense>

            {error && <ErrorMessage message={error} />}

            {renderHeader()}

            <div className="row">
                {/* Navigation Column */}
                <div className="col-md-3">
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
                <div className="col-md-9 position-relative">

                    {selectedEpisode ? (
                        <div>
                            <div className="d-flex justify-content-between align-items-center mb-1">
                                <h3>{selectedEpisode.title}</h3>
                            </div>

                            {selectedEpisode.Media?.[0]?.Part?.[0]?.Stream ? (
                                <div className="row">
                                    <div className="col-md-6">
                                        <AudioTable
                                            streams={selectedEpisode.Media[0].Part[0].Stream}
                                            onSelect={(id, scope) => handleStreamUpdate(id, scope, 'audio')}
                                            keyword={audioKeyword}
                                            onKeywordChange={setAudioKeyword}
                                            isMovie={selectedLibrary?.type === 'movie'}
                                        />
                                    </div>
                                    <div className="col-md-6">
                                        <SubtitleTable
                                            streams={selectedEpisode.Media[0].Part[0].Stream}
                                            onSelect={(id, scope) => handleStreamUpdate(id, scope, 'subtitle')}
                                            keyword={subtitleKeyword}
                                            onKeywordChange={setSubtitleKeyword}
                                            isMovie={selectedLibrary?.type === 'movie'}
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
