import {
    findForcedSubtitleForAudioLanguage,
    findMatchingStream,
    formatStreamName,
    getAllMediaParts,
    isCommentaryStream,
} from '../../../src/shared/smartMatch.ts';
import type { PlexMetadata, PlexStream } from '../../../src/shared/types/plex.ts';
import { getMonitoredServer } from '../api/serverRoutes.ts';
import { broadcastSseEvent } from '../api/sse.ts';
import {
    getPmsMetadata,
    getPmsMetadataChildren,
    updatePmsStream,
} from '../plex/client.ts';
import { upsertEpisodeBaseline } from '../plex/updater.ts';
import { withTransaction } from '../storage/db.ts';
import { registerDebounceSupersedeHook } from './queueManager.ts';
import { evaluateAutomationRule, evaluateForcedSubtitleRule } from './ruleEvaluator.ts';

export interface PendingDebouncedEvent {
    key: string;
    machineIdentifier: string;
    serverUrl: string;
    plexUserId: number;
    username: string;
    userToken: string;
    episodeRatingKey: string;
    showRatingKey?: string;
    triggerType: 'PLAYBACK_CHANGE' | 'PREPLAY_CHANGE';
    audioChanged: boolean;
    subtitleChanged: boolean;
    audioStreamId?: number;
    subtitleStreamId?: number;
    timer: ReturnType<typeof setTimeout>;
}

const pendingEvents = new Map<string, PendingDebouncedEvent>();

export const formatEpisodeLabel = (ep: PlexMetadata): string => {
    const s = ep.parentIndex !== undefined ? `S${String(ep.parentIndex).padStart(2, '0')}` : '';
    const e = ep.index !== undefined ? `E${String(ep.index).padStart(2, '0')}` : '';
    const prefix = s || e ? `${s}${e} - ` : '';
    return `${prefix}${ep.title || 'Episode'}`;
};

/**
 * Applies a reference episode's selected audio & subtitle streams to a single target episode
 * for a given user token, honoring:
 * - Multi-version (`Media[]`) and multi-part (`Part[]`) updates
 * - Commentary audio guardrail (skip subtitle update if reference audio is commentary and target lacks commentary audio)
 * - Automatic forced-subtitle-matching-audio transition rule (`autoForcedSubtitles`)
 */
export const applyReferenceStreamsToTargetEpisode = async (params: {
    machineIdentifier: string;
    serverUrl: string;
    plexUserId: number;
    userToken: string;
    refAudioStream: PlexStream | null;
    refSubtitleStream: PlexStream | null;
    syncAudio: boolean;
    syncSubtitle: boolean;
    autoForcedSubtitles: boolean;
    targetEpisode: PlexMetadata;
}): Promise<{
    wasUpdated: boolean;
    changeApplied: string;
    matchReason: string;
}> => {
    const {
        machineIdentifier,
        serverUrl,
        plexUserId,
        userToken,
        refAudioStream,
        refSubtitleStream,
        syncAudio,
        syncSubtitle,
        autoForcedSubtitles,
        targetEpisode,
    } = params;

    const parts = getAllMediaParts(targetEpisode);
    if (parts.length === 0) {
        return {
            wasUpdated: false,
            changeApplied: 'No media parts',
            matchReason: 'Skipped (No Streams)',
        };
    }

    const targetStateLines: string[] = [];
    const trackReasons: string[] = [];
    let anyUpdated = false;
    let primaryMatchedAudio: PlexStream | null = null;
    let primaryAudioMatchedCommentary = false;

    // 1. Audio stream matching across all parts
    if (syncAudio && refAudioStream) {
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const prevAudio = part.Stream.find(s => s.streamType === 2 && s.selected);
            const match = findMatchingStream(refAudioStream, part.Stream);

            if (match) {
                if (i === 0) {
                    primaryMatchedAudio = match.stream;
                    primaryAudioMatchedCommentary = isCommentaryStream(match.stream);
                }

                if (!match.stream.selected) {
                    await updatePmsStream(
                        serverUrl,
                        part.id,
                        match.stream.id,
                        'audio',
                        'PASTA-Server-Daemon',
                        userToken
                    );
                    anyUpdated = true;
                    if (i === 0) {
                        const prevName = prevAudio ? formatStreamName(prevAudio) : 'Default';
                        targetStateLines.push(
                            `Audio: ${prevName} → ${formatStreamName(match.stream)}`
                        );
                        trackReasons.push(match.matchReason);
                    }
                } else if (i === 0) {
                    targetStateLines.push(`Audio: → ${formatStreamName(match.stream)}`);
                    trackReasons.push('Already Set');
                }
                if (i === 0) {
                    upsertEpisodeBaseline(
                        machineIdentifier,
                        plexUserId,
                        targetEpisode.ratingKey,
                        'audio',
                        match.stream.id,
                        targetEpisode
                    );
                }
            } else if (i === 0) {
                const prevName = prevAudio ? formatStreamName(prevAudio) : 'Default';
                targetStateLines.push(`Audio: → ${prevName}`);
                trackReasons.push('No Match');
            }
        }
    } else {
        primaryMatchedAudio = parts[0].Stream.find(s => s.streamType === 2 && s.selected) || null;
        primaryAudioMatchedCommentary = isCommentaryStream(primaryMatchedAudio);
    }

    // 2. Subtitle stream matching across all parts (with Commentary Guardrail & Forced-Subtitle Transitions)
    const refAudioIsCommentary = isCommentaryStream(refAudioStream);
    const skipSubDueToCommentaryMismatch =
        refAudioIsCommentary && !primaryAudioMatchedCommentary;

    if (syncSubtitle && !skipSubDueToCommentaryMismatch) {
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const prevSub = part.Stream.find(s => s.streamType === 3 && s.selected);
            const prevSubName = prevSub ? formatStreamName(prevSub) : 'None';

            let targetSubId: number | null = null;
            let subName = 'None';
            let subReason = 'Exact Match (All Properties)';

            if (refSubtitleStream !== null) {
                const match = findMatchingStream(refSubtitleStream, part.Stream);
                if (match) {
                    // If reference subtitle was Forced, but the matched subtitle on target is NOT forced
                    // (e.g. only full dialogue subtitles exist on this episode), clear subtitles to None (0)
                    if (refSubtitleStream.forced && !match.stream.forced) {
                        targetSubId = 0;
                        subName = 'None (No Forced Sub)';
                        subReason = 'Forced Transition → None';
                    } else {
                        targetSubId = match.stream.id;
                        subName = formatStreamName(match.stream);
                        subReason = match.matchReason;
                    }
                } else if (refSubtitleStream.forced) {
                    targetSubId = 0;
                    subName = 'None';
                    subReason = 'Forced Transition → None';
                }
            } else {
                // Reference subtitle is None (0): check forced-subtitle-matching-audio rule
                const effectiveAudio =
                    primaryMatchedAudio ||
                    part.Stream.find(s => s.streamType === 2 && s.selected) ||
                    refAudioStream;
                const forcedMatch = autoForcedSubtitles
                    ? findForcedSubtitleForAudioLanguage(effectiveAudio, part.Stream)
                    : null;

                if (forcedMatch) {
                    targetSubId = forcedMatch.stream.id;
                    subName = `${formatStreamName(forcedMatch.stream)} (Forced)`;
                    subReason = forcedMatch.matchReason;
                } else {
                    targetSubId = 0;
                    subName = 'None';
                    subReason = 'Exact Match (All Properties)';
                }
            }

            if (targetSubId !== null) {
                const alreadySelected =
                    targetSubId === 0
                        ? !prevSub
                        : Boolean(prevSub && prevSub.id === targetSubId);

                if (!alreadySelected) {
                    await updatePmsStream(
                        serverUrl,
                        part.id,
                        targetSubId,
                        'subtitle',
                        'PASTA-Server-Daemon',
                        userToken
                    );
                    anyUpdated = true;
                    if (i === 0) {
                        targetStateLines.push(`Subtitles: ${prevSubName} → ${subName}`);
                        trackReasons.push(subReason);
                    }
                } else if (i === 0) {
                    targetStateLines.push(`Subtitles: → ${subName}`);
                    trackReasons.push('Already Set');
                }
                if (i === 0) {
                    upsertEpisodeBaseline(
                        machineIdentifier,
                        plexUserId,
                        targetEpisode.ratingKey,
                        'subtitle',
                        targetSubId,
                        targetEpisode
                    );
                }
            } else if (i === 0) {
                targetStateLines.push(`Subtitles: → ${prevSubName}`);
                trackReasons.push('No Match');
            }
        }
    }

    return {
        wasUpdated: anyUpdated,
        changeApplied: targetStateLines.join('\n') || 'Already Set',
        matchReason:
            trackReasons.join('\n') || (anyUpdated ? 'Matched' : 'Already Set'),
    };
};

/**
 * Executes an automated TV show/season track synchronization after the debounce timer fires.
 */
export const executeAutomatedTrackSync = async (
    evt: Omit<PendingDebouncedEvent, 'timer'>
): Promise<void> => {
    const {
        machineIdentifier,
        serverUrl,
        plexUserId,
        username,
        userToken,
        episodeRatingKey,
        triggerType,
        audioChanged,
        subtitleChanged,
    } = evt;

    const monitored = getMonitoredServer(machineIdentifier);
    if (!monitored || !monitored.is_monitoring_enabled) return;

    const refEpisode = await getPmsMetadata(
        serverUrl,
        episodeRatingKey,
        'PASTA-Server-Daemon',
        userToken
    );
    if (!refEpisode || refEpisode.type !== 'episode') return;

    // 1. Fetch parent Show metadata (for Show-level Plex Labels like PASTA_IGNORE) & evaluate automation rules
    const show = refEpisode.grandparentRatingKey
        ? await getPmsMetadata(
              serverUrl,
              refEpisode.grandparentRatingKey,
              'PASTA-Server-Daemon',
              userToken
          ).catch(() => null)
        : null;

    const ruleCheck = evaluateAutomationRule(machineIdentifier, refEpisode, show);
    if (!ruleCheck.allowed) {
        return;
    }

    const refStreams = refEpisode.Media?.[0]?.Part?.[0]?.Stream || [];
    const refAudioStream = refStreams.find(s => s.streamType === 2 && s.selected) || null;
    const refSubtitleStream = refStreams.find(s => s.streamType === 3 && s.selected) || null;

    // Update baseline for the reference episode itself
    if (refAudioStream) {
        upsertEpisodeBaseline(
            machineIdentifier,
            plexUserId,
            refEpisode.ratingKey,
            'audio',
            refAudioStream.id,
            refEpisode
        );
    }
    upsertEpisodeBaseline(
        machineIdentifier,
        plexUserId,
        refEpisode.ratingKey,
        'subtitle',
        refSubtitleStream ? refSubtitleStream.id : 0,
        refEpisode
    );

    // 2. Fetch candidate episodes according to update_level ('show' | 'season') and update_strategy ('next' | 'all')
    let candidateEpisodes: PlexMetadata[] = [];
    if (monitored.update_level === 'season' && refEpisode.parentRatingKey) {
        candidateEpisodes = await getPmsMetadataChildren(
            serverUrl,
            refEpisode.parentRatingKey,
            'PASTA-Server-Daemon',
            userToken
        );
    } else if (refEpisode.grandparentRatingKey) {
        const seasons = await getPmsMetadataChildren(
            serverUrl,
            refEpisode.grandparentRatingKey,
            'PASTA-Server-Daemon',
            userToken
        );
        const seasonLists = await Promise.all(
            seasons.map(s =>
                getPmsMetadataChildren(
                    serverUrl,
                    s.ratingKey,
                    'PASTA-Server-Daemon',
                    userToken
                )
            )
        );
        candidateEpisodes = seasonLists.flat();
    }

    const refSeasonNum = refEpisode.parentIndex ?? 0;
    const refEpNum = refEpisode.index ?? 0;

    const filteredTargets = candidateEpisodes.filter(ep => {
        if (ep.ratingKey === refEpisode.ratingKey) return false;
        // Skip Season 0 (Specials) unless the reference episode itself is in Season 0
        const sNum = ep.parentIndex ?? 0;
        if (sNum === 0 && refSeasonNum !== 0) return false;

        if (monitored.update_strategy === 'next') {
            const eNum = ep.index ?? 0;
            if (sNum < refSeasonNum) return false;
            if (sNum === refSeasonNum && eNum <= refEpNum) return false;
        }
        return true;
    });

    if (filteredTargets.length === 0) return;

    // 3. Fetch full metadata for target episodes and apply matching tracks
    const drilldownRows: Array<{
        episodeRatingKey: string;
        episodeLabel: string;
        targetUsername: string;
        changeApplied: string;
        matchReason: string;
        wasUpdated: boolean;
    }> = [];
    let updatedCount = 0;
    let skippedCount = 0;

    const BATCH_SIZE = 5;
    for (let i = 0; i < filteredTargets.length; i += BATCH_SIZE) {
        const slice = filteredTargets.slice(i, i + BATCH_SIZE);
        const fullEps = await Promise.all(
            slice.map(ep =>
                ep.Media?.[0]?.Part?.[0]?.Stream
                    ? Promise.resolve(ep)
                    : getPmsMetadata(
                          serverUrl,
                          ep.ratingKey,
                          'PASTA-Server-Daemon',
                          userToken
                      )
            )
        );

        for (const fullEp of fullEps) {
            if (!fullEp) continue;
            const epRule = evaluateAutomationRule(machineIdentifier, fullEp, show);
            if (!epRule.allowed) {
                skippedCount++;
                continue;
            }

            const autoForcedAllowed = evaluateForcedSubtitleRule(
                machineIdentifier,
                Boolean(monitored.auto_forced_subtitles),
                fullEp,
                show
            );

            const res = await applyReferenceStreamsToTargetEpisode({
                machineIdentifier,
                serverUrl,
                plexUserId,
                userToken,
                refAudioStream,
                refSubtitleStream,
                syncAudio: audioChanged || !subtitleChanged,
                syncSubtitle: subtitleChanged || !audioChanged,
                autoForcedSubtitles: autoForcedAllowed,
                targetEpisode: fullEp,
            });

            if (res.wasUpdated) {
                updatedCount++;
            } else {
                skippedCount++;
            }

            drilldownRows.push({
                episodeRatingKey: fullEp.ratingKey,
                episodeLabel: formatEpisodeLabel(fullEp),
                targetUsername: username,
                changeApplied: res.changeApplied,
                matchReason: res.matchReason,
                wasUpdated: res.wasUpdated,
            });
        }
    }

    if (updatedCount === 0 && skippedCount === 0) return;

    // 4. Persist parent operation + drill-down rows to SQLite
    const showTitle = refEpisode.grandparentTitle || refEpisode.title || 'TV Show';
    const showRatingKey = refEpisode.grandparentRatingKey || refEpisode.ratingKey;
    const refLabel = `S${String(refSeasonNum).padStart(2, '0')}E${String(refEpNum).padStart(2, '0')}`;
    const audioSummary = refAudioStream ? formatStreamName(refAudioStream) : 'Default';
    const subSummary = refSubtitleStream ? formatStreamName(refSubtitleStream) : 'None';

    withTransaction(db => {
        const insertOp = db.prepare(`
            INSERT INTO auto_operations (
                machine_identifier,
                plex_user_id,
                username,
                trigger_type,
                show_rating_key,
                show_title,
                reference_episode_key,
                reference_episode_label,
                audio_summary,
                subtitle_summary,
                updated_count,
                skipped_count,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const opResult = insertOp.run(
            machineIdentifier,
            plexUserId,
            username,
            triggerType,
            showRatingKey,
            showTitle,
            refEpisode.ratingKey,
            refLabel,
            audioSummary,
            subSummary,
            updatedCount,
            skippedCount,
            Date.now()
        );

        const operationId = Number(opResult.lastInsertRowid);
        const insertEp = db.prepare(`
            INSERT INTO auto_operation_episodes (
                operation_id,
                episode_rating_key,
                episode_label,
                target_username,
                change_applied,
                match_reason,
                was_updated
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        for (const row of drilldownRows) {
            insertEp.run(
                operationId,
                row.episodeRatingKey,
                row.episodeLabel,
                row.targetUsername,
                row.changeApplied,
                row.matchReason,
                row.wasUpdated ? 1 : 0
            );
        }
    });

    broadcastSseEvent('activity_update', {
        machineIdentifier,
        showTitle,
        updatedCount,
        skippedCount,
    });
};

/**
 * Schedules or resets a debounced automated track change in the debounce event buffer.
 */
export const scheduleDebouncedTrackChange = (params: {
    machineIdentifier: string;
    serverUrl: string;
    plexUserId: number;
    username: string;
    userToken: string;
    episodeRatingKey: string;
    showRatingKey?: string;
    triggerType: 'PLAYBACK_CHANGE' | 'PREPLAY_CHANGE';
    audioChanged: boolean;
    subtitleChanged: boolean;
    audioStreamId?: number;
    subtitleStreamId?: number;
    debounceSeconds: number;
}): void => {
    const key = `${params.machineIdentifier}:${params.plexUserId}:${params.episodeRatingKey}`;
    const existing = pendingEvents.get(key);

    // If a debounce timer is already counting down for the exact same stream IDs on this episode,
    // do not reset the timer on 10-second playback progress heartbeats.
    if (
        existing &&
        params.audioStreamId !== undefined &&
        params.subtitleStreamId !== undefined &&
        existing.audioStreamId === params.audioStreamId &&
        existing.subtitleStreamId === params.subtitleStreamId
    ) {
        if (params.triggerType === 'PLAYBACK_CHANGE') {
            existing.triggerType = 'PLAYBACK_CHANGE';
        }
        return;
    }

    if (existing) {
        clearTimeout(existing.timer);
    }

    const delayMs = Math.max(1000, params.debounceSeconds * 1000);
    const timer = setTimeout(() => {
        const entry = pendingEvents.get(key);
        if (!entry) return;
        pendingEvents.delete(key);
        void executeAutomatedTrackSync(entry).catch(err => {
            console.error('[PASTA Daemon] Automated track sync failed:', err);
        });
    }, delayMs);

    pendingEvents.set(key, {
        key,
        machineIdentifier: params.machineIdentifier,
        serverUrl: params.serverUrl,
        plexUserId: params.plexUserId,
        username: params.username,
        userToken: params.userToken,
        episodeRatingKey: params.episodeRatingKey,
        showRatingKey: params.showRatingKey || existing?.showRatingKey,
        triggerType:
            existing?.triggerType === 'PLAYBACK_CHANGE'
                ? 'PLAYBACK_CHANGE'
                : params.triggerType,
        audioChanged: params.audioChanged,
        subtitleChanged: params.subtitleChanged,
        audioStreamId: params.audioStreamId,
        subtitleStreamId: params.subtitleStreamId,
        timer,
    });
};

/**
 * Cancels a pending debounced event if the user switches the episode's tracks back to the baseline
 * before the debounce timer fires.
 */
export const cancelPendingDebounceForEpisode = (
    machineIdentifier: string,
    plexUserId: number,
    episodeRatingKey: string
): void => {
    const key = `${machineIdentifier}:${plexUserId}:${episodeRatingKey}`;
    const existing = pendingEvents.get(key);
    if (!existing) return;
    clearTimeout(existing.timer);
    pendingEvents.delete(key);
};

/**
 * Immediately flushes a pending debounced event when the user stops playback (`state === 'stopped'`).
 */
export const flushDebouncedEventOnStop = async (
    machineIdentifier: string,
    plexUserId: number,
    episodeRatingKey: string
): Promise<void> => {
    const key = `${machineIdentifier}:${plexUserId}:${episodeRatingKey}`;
    const existing = pendingEvents.get(key);
    if (!existing) return;

    clearTimeout(existing.timer);
    pendingEvents.delete(key);
    await executeAutomatedTrackSync(existing);
};

/**
 * Flushes any pending debounced event for an episode when `state === 'stopped'` arrives
 * after Plex has already removed the session from `/status/sessions`.
 */
export const flushDebouncedEventOnStopByEpisode = async (
    machineIdentifier: string,
    episodeRatingKey: string
): Promise<void> => {
    for (const [key, entry] of pendingEvents.entries()) {
        if (
            entry.machineIdentifier === machineIdentifier &&
            entry.episodeRatingKey === episodeRatingKey
        ) {
            clearTimeout(entry.timer);
            pendingEvents.delete(key);
            await executeAutomatedTrackSync(entry);
        }
    }
};

/**
 * Cancels any pending 30s debounce timers superseded by a manual UI batch job.
 */
export const cancelPendingDebounceForShow = (
    machineIdentifier: string,
    showRatingKey?: string
): void => {
    for (const [key, entry] of pendingEvents.entries()) {
        if (entry.machineIdentifier !== machineIdentifier) continue;
        if (!showRatingKey || entry.showRatingKey === showRatingKey) {
            clearTimeout(entry.timer);
            pendingEvents.delete(key);
        }
    }
};

// Register the supersede hook with queueManager
registerDebounceSupersedeHook(cancelPendingDebounceForShow);

/**
 * Flushes all pending debounced events on SIGTERM / SIGINT container shutdown.
 */
export const flushAllPendingEvents = async (): Promise<void> => {
    const entries = Array.from(pendingEvents.values());
    pendingEvents.clear();
    for (const entry of entries) {
        clearTimeout(entry.timer);
        await executeAutomatedTrackSync(entry).catch(() => {});
    }
};
