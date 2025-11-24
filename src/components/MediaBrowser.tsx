import React, { useState, Suspense } from 'react';
import { useMediaBrowser } from '../hooks/useMediaBrowser';
import { useBatchUpdater } from '../hooks/useBatchUpdater';
import { LibraryList } from './Media/LibraryList';
import { ShowList } from './Media/ShowList';
import { SeasonList } from './Media/SeasonList';
import { EpisodeList } from './Media/EpisodeList';
import { AudioTable } from './Tracks/AudioTable';
import { SubtitleTable } from './Tracks/SubtitleTable';

// Lazy load ProgressModal
const ProgressModal = React.lazy(() => import('./Layout/ProgressModal').then(module => ({ default: module.ProgressModal })));
import { LoadingSpinner } from './Layout/LoadingSpinner';
import { ErrorMessage } from './Layout/ErrorMessage';

export const MediaBrowser: React.FC = () => {
    const {
        libraries,
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

    // Breadcrumb / Header Logic
    const renderHeader = () => {
        const isMovie = selectedLibrary?.type === 'movie';

        return (
            <div className="row">
                <div className="col-12">
                    <nav aria-label="breadcrumb" className="mb-2">
                        <ol className="breadcrumb">
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
                    <LibraryList
                        libraries={libraries}
                        selectedLibrary={selectedLibrary}
                        onSelect={selectLibrary}
                    />

                    {selectedLibrary && (
                        <ShowList
                            shows={shows}
                            selectedShow={selectedShow}
                            onSelect={selectShow}
                            libraryType={selectedLibrary.type}
                        />
                    )}

                    {selectedShow && seasons.length > 0 && (
                        <SeasonList
                            seasons={seasons}
                            selectedSeason={selectedSeason}
                            onSelect={selectSeason}
                        />
                    )}

                    {selectedSeason && (
                        <EpisodeList
                            episodes={episodes}
                            selectedEpisode={selectedEpisode}
                            onSelect={selectEpisode}
                        />
                    )}
                </div>

                {/* Content Column */}
                <div className="col-md-9 position-relative">
                    {loading && <LoadingSpinner overlay message="Loading content..." />}

                    {selectedEpisode ? (
                        <div>
                            <div className="d-flex justify-content-between align-items-center mb-4">
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
                            <h4>Select an episode to view tracks</h4>
                            <p>Navigate using the menu on the left</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
