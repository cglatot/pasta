import type { PlexMetadata } from '../../../src/shared/types/plex.ts';
import { getMonitoredServer } from '../api/serverRoutes.ts';
import { broadcastSseEvent } from '../api/sse.ts';
import {
    getPmsLibraries,
    getPmsLibraryItemsPaginated,
    getPmsMetadata,
    serverPlexFetch,
    getPmsParams,
} from '../plex/client.ts';
import { getAllUserTokensForServer } from '../plex/userManager.ts';
import type { PlexMediaContainer } from '../../../src/shared/types/plex.ts';
import { getDatabase, withTransaction } from '../storage/db.ts';
import { recordDiagnosticEvent } from '../storage/diagnostics.ts';
import {
    applyReferenceStreamsToTargetEpisode,
    formatEpisodeLabel,
} from './eventBuffer.ts';
import { evaluateAutomationRule, evaluateForcedSubtitleRule } from './ruleEvaluator.ts';

// 5-second deduplication map for noisy TimelineEntry (state=5) events
const recentTimelineDedupe = new Map<string, number>();

export const getStoredEpisodePartId = (
    machineIdentifier: string,
    episodeRatingKey: string
): number | null => {
    const db = getDatabase();
    const row = db
        .prepare(
            'SELECT part_id FROM episode_parts WHERE machine_identifier = ? AND episode_rating_key = ?'
        )
        .get(machineIdentifier, episodeRatingKey) as { part_id: number } | undefined;
    return row ? row.part_id : null;
};

export const upsertStoredEpisodePartId = (
    machineIdentifier: string,
    episodeRatingKey: string,
    partId: number
): void => {
    const db = getDatabase();
    db.prepare(`
        INSERT INTO episode_parts (machine_identifier, episode_rating_key, part_id, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(machine_identifier, episode_rating_key) DO UPDATE SET
            part_id = excluded.part_id,
            updated_at = excluded.updated_at
    `).run(machineIdentifier, episodeRatingKey, partId, Date.now());
};

/**
 * One-time initial `part_id` seeding for a server using paginated JSON requests (`X-Plex-Container-Size=1000`).
 * Enables instant O(1) detection of file upgrades vs. newly added episodes.
 */
export const seedServerEpisodePartsIfNeeded = async (
    machineIdentifier: string,
    serverUrl: string,
    ownerToken: string
): Promise<void> => {
    const db = getDatabase();
    const countRow = db
        .prepare(
            'SELECT COUNT(*) as cnt FROM episode_parts WHERE machine_identifier = ?'
        )
        .get(machineIdentifier) as { cnt: number } | undefined;

    if (countRow && countRow.cnt > 0) {
        return; // Already seeded
    }

    const libraries = await getPmsLibraries(
        serverUrl,
        'PASTA-Server-Daemon',
        ownerToken
    ).catch(() => []);
    const tvLibraries = libraries.filter(l => l.type === 'show');

    for (const lib of tvLibraries) {
        const episodes = await getPmsLibraryItemsPaginated(
            serverUrl,
            lib.key,
            'PASTA-Server-Daemon',
            ownerToken,
            { type: 4, sort: 'addedAt:asc' },
            1000
        ).catch(() => []);

        if (episodes.length > 0) {
            const now = Date.now();
            withTransaction(txDb => {
                const stmt = txDb.prepare(`
                    INSERT OR REPLACE INTO episode_parts (machine_identifier, episode_rating_key, part_id, updated_at)
                    VALUES (?, ?, ?, ?)
                `);
                for (const ep of episodes) {
                    const partId = ep.Media?.[0]?.Part?.[0]?.id;
                    if (partId) {
                        stmt.run(machineIdentifier, ep.ratingKey, partId, now);
                    }
                }
            });
        }
    }
};

/**
 * Queries the single most recently watched episode of a TV show for a specific user
 * (`viewCount>=1&sort=lastViewedAt:desc&X-Plex-Container-Size=1`).
 */
export const findLastWatchedEpisodeForUser = async (params: {
    serverUrl: string;
    librarySectionId: number | string;
    showRatingKey: string;
    excludeEpisodeRatingKey: string;
    userToken: string;
}): Promise<PlexMetadata | null> => {
    const {
        serverUrl,
        librarySectionId,
        showRatingKey,
        excludeEpisodeRatingKey,
        userToken,
    } = params;

    try {
        const data = await serverPlexFetch<PlexMediaContainer<PlexMetadata>>(
            `${serverUrl}/library/sections/${librarySectionId}/all`,
            {
                params: {
                    type: 4,
                    'show.id': showRatingKey,
                    'viewCount>=': 1,
                    sort: 'lastViewedAt:desc',
                    'X-Plex-Container-Start': 0,
                    'X-Plex-Container-Size': 2,
                    ...getPmsParams('PASTA-Server-Daemon', userToken),
                },
            }
        );

        const candidates = (data.MediaContainer?.Metadata || []).filter(
            ep => ep.ratingKey !== excludeEpisodeRatingKey
        );
        if (candidates.length === 0) return null;

        const fullRef = await getPmsMetadata(
            serverUrl,
            candidates[0].ratingKey,
            'PASTA-Server-Daemon',
            userToken
        );
        return fullRef || null;
    } catch {
        return null;
    }
};

/**
 * Processes a newly added or file-upgraded TV episode (`TimelineEntry` with `state=5, type=4`),
 * matching tracks for each active viewer of the show based on their most recently watched episode.
 */
export const handleTimelineEpisodeFinished = async (params: {
    machineIdentifier: string;
    serverUrl: string;
    ownerToken: string;
    episodeRatingKey: string;
    metadataState?: string;
}): Promise<void> => {
    const {
        machineIdentifier,
        serverUrl,
        ownerToken,
        episodeRatingKey,
        metadataState,
    } = params;

    // 5-second deduplication window per (machineIdentifier, episodeRatingKey)
    const dedupeKey = `${machineIdentifier}:${episodeRatingKey}`;
    const now = Date.now();
    const lastSeen = recentTimelineDedupe.get(dedupeKey) || 0;
    if (now - lastSeen < 5000) {
        return;
    }
    recentTimelineDedupe.set(dedupeKey, now);

    const monitored = getMonitoredServer(machineIdentifier);
    if (!monitored || !monitored.is_monitoring_enabled || !monitored.trigger_on_scan) {
        return;
    }

    const episode = await getPmsMetadata(
        serverUrl,
        episodeRatingKey,
        'PASTA-Server-Daemon',
        ownerToken
    ).catch(() => undefined);
    if (!episode || episode.type !== 'episode') return;

    const currentPartId = episode.Media?.[0]?.Part?.[0]?.id;
    if (!currentPartId) return;

    const storedPartId = getStoredEpisodePartId(machineIdentifier, episode.ratingKey);
    const isNewEpisode = metadataState === 'created' || storedPartId === null;
    const isUpgradedFile = storedPartId !== null && storedPartId !== currentPartId;

    // Update stored part_id immediately
    upsertStoredEpisodePartId(machineIdentifier, episode.ratingKey, currentPartId);

    if (!isNewEpisode && !isUpgradedFile) {
        return; // Ordinary metadata refresh with unchanged media file part_id
    }

    const showRatingKey = episode.grandparentRatingKey;
    const librarySectionId = episode.librarySectionID || episode.librarySectionKey;
    if (!showRatingKey || !librarySectionId) return;

    const show = await getPmsMetadata(
        serverUrl,
        showRatingKey,
        'PASTA-Server-Daemon',
        ownerToken
    ).catch(() => null);

    const ruleCheck = evaluateAutomationRule(machineIdentifier, episode, show);
    if (!ruleCheck.allowed) {
        recordDiagnosticEvent(
            'RULE',
            `Skipped scan event for episode ${episode.ratingKey} (${episode.title || 'Unknown'}): ${ruleCheck.reason}`,
            { episodeRatingKey: episode.ratingKey, showTitle: show?.title || episode.grandparentTitle },
            machineIdentifier
        );
        return;
    }

    const userTargets = getAllUserTokensForServer(machineIdentifier);
    if (userTargets.length === 0) return;

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

    for (const userTarget of userTargets) {
        const refEp = await findLastWatchedEpisodeForUser({
            serverUrl,
            librarySectionId,
            showRatingKey,
            excludeEpisodeRatingKey: episode.ratingKey,
            userToken: userTarget.token,
        });

        if (!refEp) continue; // User hasn't watched this show yet

        const refStreams = refEp.Media?.[0]?.Part?.[0]?.Stream || [];
        const refAudio = refStreams.find(s => s.streamType === 2 && s.selected) || null;
        const refSub = refStreams.find(s => s.streamType === 3 && s.selected) || null;

        // Fetch target episode with this user's token so their current stream selections are accurate
        const userTargetEp = await getPmsMetadata(
            serverUrl,
            episode.ratingKey,
            'PASTA-Server-Daemon',
            userTarget.token
        ).catch(() => undefined);
        if (!userTargetEp) continue;

        const autoForcedAllowed = evaluateForcedSubtitleRule(
            machineIdentifier,
            Boolean(monitored.auto_forced_subtitles),
            userTargetEp,
            show
        );

        const res = await applyReferenceStreamsToTargetEpisode({
            machineIdentifier,
            serverUrl,
            plexUserId: userTarget.plexUserId,
            userToken: userTarget.token,
            refAudioStream: refAudio,
            refSubtitleStream: refSub,
            syncAudio: true,
            syncSubtitle: true,
            autoForcedSubtitles: autoForcedAllowed,
            targetEpisode: userTargetEp,
        });

        if (res.wasUpdated) {
            updatedCount++;
        } else {
            skippedCount++;
        }

        const refLabel = formatEpisodeLabel(refEp);
        drilldownRows.push({
            episodeRatingKey: episode.ratingKey,
            episodeLabel: `${formatEpisodeLabel(episode)} (Ref: ${refLabel})`,
            targetUsername: userTarget.username,
            changeApplied: res.changeApplied,
            matchReason: res.matchReason,
            wasUpdated: res.wasUpdated,
        });
    }

    if (updatedCount === 0 && skippedCount === 0) return;

    const triggerType = isUpgradedFile ? 'UPGRADED_FILE_SCAN' : 'NEW_EPISODE_SCAN';
    const showTitle = episode.grandparentTitle || episode.title || 'TV Show';
    const epShortLabel = formatEpisodeLabel(episode);
    const totalUsersCount = updatedCount + skippedCount;

    withTransaction(db => {
        const opRes = db
            .prepare(`
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
            `)
            .run(
                machineIdentifier,
                0,
                `Scanner (${totalUsersCount} ${totalUsersCount === 1 ? 'user' : 'users'})`,
                triggerType,
                showRatingKey,
                showTitle,
                episode.ratingKey,
                epShortLabel,
                null,
                null,
                updatedCount,
                skippedCount,
                Date.now()
            );

        const operationId = Number(opRes.lastInsertRowid);
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

        for (const r of drilldownRows) {
            insertEp.run(
                operationId,
                r.episodeRatingKey,
                r.episodeLabel,
                r.targetUsername,
                r.changeApplied,
                r.matchReason,
                r.wasUpdated ? 1 : 0
            );
        }
    });

    broadcastSseEvent('activity_update', {
        machineIdentifier,
        showTitle,
        updatedCount,
        skippedCount,
    });
    recordDiagnosticEvent(
        'SCANNER',
        `Processed ${triggerType} for ${showTitle} ${epShortLabel}: ${updatedCount} updated, ${skippedCount} skipped`,
        {
            triggerType,
            episodeRatingKey: episode.ratingKey,
            updatedCount,
            skippedCount,
        },
        machineIdentifier
    );
};

/**
 * Post-Reconnect & On-Demand Catch-Up:
 * Queries recently added/upgraded episodes since `last_event_timestamp` (capped to the last 24h)
 * so any episodes imported while the container or WebSocket was down are processed.
 */
export const catchUpMissedEpisodesSince = async (
    machineIdentifier: string,
    serverUrl: string,
    ownerToken: string,
    lastEventTimestampMs: number
): Promise<{ scannedCount: number; processedCount: number }> => {
    if (lastEventTimestampMs <= 0) {
        return { scannedCount: 0, processedCount: 0 };
    }

    const minCutoffSec = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
    const sinceSec = Math.max(minCutoffSec, Math.floor(lastEventTimestampMs / 1000));

    const libraries = await getPmsLibraries(
        serverUrl,
        'PASTA-Server-Daemon',
        ownerToken
    ).catch(() => []);
    const tvLibraries = libraries.filter(l => l.type === 'show');

    let scannedCount = 0;
    let processedCount = 0;

    for (const lib of tvLibraries) {
        const data = await serverPlexFetch<PlexMediaContainer<PlexMetadata>>(
            `${serverUrl}/library/sections/${lib.key}/all`,
            {
                params: {
                    type: 4,
                    sort: 'addedAt:desc',
                    'X-Plex-Container-Start': 0,
                    'X-Plex-Container-Size': 100,
                    ...getPmsParams('PASTA-Server-Daemon', ownerToken),
                },
            }
        ).catch(() => null);

        const recentEpisodes = (data?.MediaContainer?.Metadata || []).filter(
            ep => ep.addedAt >= sinceSec || (ep.updatedAt !== undefined && ep.updatedAt >= sinceSec)
        );

        for (const ep of recentEpisodes) {
            scannedCount++;
            const storedPart = getStoredEpisodePartId(machineIdentifier, ep.ratingKey);
            const currentPart = ep.Media?.[0]?.Part?.[0]?.id ?? null;
            const isNew = storedPart === null;
            const isUpgraded = storedPart !== null && currentPart !== null && currentPart !== storedPart;

            if (isNew || isUpgraded) {
                processedCount++;
                await handleTimelineEpisodeFinished({
                    machineIdentifier,
                    serverUrl,
                    ownerToken,
                    episodeRatingKey: ep.ratingKey,
                    metadataState: isNew ? 'created' : 'finished',
                });
            }
        }
    }

    recordDiagnosticEvent(
        'SCANNER',
        `Catch-up scan checked ${scannedCount} recent episode(s); processed ${processedCount} new/upgraded episode(s)`,
        { scannedCount, processedCount, tvLibraryCount: tvLibraries.length },
        machineIdentifier
    );

    return { scannedCount, processedCount };
};
