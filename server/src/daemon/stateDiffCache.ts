import type { PlexMetadata } from '../../../src/shared/types/plex.ts';
import { getEpisodeBaseline, upsertEpisodeBaseline } from '../plex/updater.ts';

export interface StreamDiffResult {
    changed: boolean;
    audioChanged: boolean;
    subtitleChanged: boolean;
    audioStreamId: number;
    subtitleStreamId: number;
    wasColdCacheSeeded: boolean;
}

/**
 * Extracts the currently selected audioStreamId and subtitleStreamId (0 if None)
 * from an episode's primary Media Part.
 */
export const extractSelectedStreamIds = (
    episode: PlexMetadata
): { audioStreamId: number; subtitleStreamId: number } | null => {
    const streams = episode.Media?.[0]?.Part?.[0]?.Stream;
    if (!streams || !Array.isArray(streams)) {
        return null;
    }

    const selectedAudio = streams.find(s => s.streamType === 2 && s.selected);
    const selectedSubtitle = streams.find(s => s.streamType === 3 && s.selected);

    return {
        audioStreamId: selectedAudio ? selectedAudio.id : 0,
        subtitleStreamId: selectedSubtitle ? selectedSubtitle.id : 0,
    };
};

/**
 * Compares the currently selected streams on an episode against the persisted baseline
 * in `episode_baselines`.
 *
 * Solves both:
 * 1. The 10-Second Heartbeat Storm: Identical stream IDs during playback return `changed: false` immediately.
 * 2. The TV Pre-Play Blind Spot: If PASTA previously pre-seeded `episode_baselines` for this episode,
 *    changing tracks on a TV pre-play screen before pressing Play is caught on the very first `playing` event!
 */
export const diffAndRecordEpisodeStreams = (params: {
    machineIdentifier: string;
    plexUserId: number;
    episode: PlexMetadata;
    source: 'playing' | 'activity';
}): StreamDiffResult => {
    const { machineIdentifier, plexUserId, episode, source } = params;
    const current = extractSelectedStreamIds(episode);

    if (!current) {
        return {
            changed: false,
            audioChanged: false,
            subtitleChanged: false,
            audioStreamId: 0,
            subtitleStreamId: 0,
            wasColdCacheSeeded: false,
        };
    }

    const baseline = getEpisodeBaseline(machineIdentifier, plexUserId, episode.ratingKey);

    // Cold cache miss: first time PASTA has ever observed this episode for this user
    if (!baseline) {
        const streams = episode.Media?.[0]?.Part?.[0]?.Stream || [];
        const selectedAudio = streams.find(s => s.streamType === 2 && s.selected);
        const selectedSubtitle = streams.find(s => s.streamType === 3 && s.selected);
        const defaultAudio =
            streams.find(s => s.streamType === 2 && s.default) ||
            streams.find(s => s.streamType === 2);
        const nonDefaultAudioChosen = Boolean(
            selectedAudio && defaultAudio && selectedAudio.id !== defaultAudio.id
        );
        const nonForcedSubChosen = Boolean(selectedSubtitle && !selectedSubtitle.forced);

        if (source === 'playing' && (nonDefaultAudioChosen || nonForcedSubChosen)) {
            // Seed baseline with the default streams so the non-default selection remains a true diff
            // until executeAutomatedTrackSync completes and commits the new baseline.
            upsertEpisodeBaseline(
                machineIdentifier,
                plexUserId,
                episode.ratingKey,
                'audio',
                defaultAudio ? defaultAudio.id : current.audioStreamId,
                episode
            );
            upsertEpisodeBaseline(
                machineIdentifier,
                plexUserId,
                episode.ratingKey,
                'subtitle',
                0,
                episode
            );
            return {
                changed: true,
                audioChanged: nonDefaultAudioChosen,
                subtitleChanged: nonForcedSubChosen,
                audioStreamId: current.audioStreamId,
                subtitleStreamId: current.subtitleStreamId,
                wasColdCacheSeeded: true,
            };
        }

        upsertEpisodeBaseline(
            machineIdentifier,
            plexUserId,
            episode.ratingKey,
            'audio',
            current.audioStreamId,
            episode
        );
        upsertEpisodeBaseline(
            machineIdentifier,
            plexUserId,
            episode.ratingKey,
            'subtitle',
            current.subtitleStreamId,
            episode
        );

        return {
            changed: false,
            audioChanged: false,
            subtitleChanged: false,
            audioStreamId: current.audioStreamId,
            subtitleStreamId: current.subtitleStreamId,
            wasColdCacheSeeded: true,
        };
    }

    if (baseline.audio_stream_id === 0 && current.audioStreamId > 0) {
        upsertEpisodeBaseline(
            machineIdentifier,
            plexUserId,
            episode.ratingKey,
            'audio',
            current.audioStreamId,
            episode
        );
        baseline.audio_stream_id = current.audioStreamId;
    }

    const audioChanged = current.audioStreamId !== baseline.audio_stream_id;
    const subtitleChanged = current.subtitleStreamId !== baseline.subtitle_stream_id;

    if (!audioChanged && !subtitleChanged) {
        // 10s playback progress heartbeat with zero stream changes (or user reverted to baseline): drop silently
        return {
            changed: false,
            audioChanged: false,
            subtitleChanged: false,
            audioStreamId: current.audioStreamId,
            subtitleStreamId: current.subtitleStreamId,
            wasColdCacheSeeded: false,
        };
    }

    // Stream change detected! Note: we intentionally do NOT overwrite `episode_baselines` here
    // before the debounce timer fires; `executeAutomatedTrackSync` commits the new baseline
    // once the sync actually executes.
    return {
        changed: true,
        audioChanged,
        subtitleChanged,
        audioStreamId: current.audioStreamId,
        subtitleStreamId: current.subtitleStreamId,
        wasColdCacheSeeded: false,
    };
};
