import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { resolveEpisodePartUpdates } from '../../../src/shared/smartMatch.ts';
import type { PlexMedia, PlexMetadata, PlexPart, PlexStream } from '../../../src/shared/types/plex.ts';
import { ApiRouter } from '../api/httpServer.ts';
import {
    catchUpMissedEpisodesSince,
    getStoredEpisodePartId,
    handleTimelineEpisodeFinished,
} from '../daemon/scanner.ts';
import { setServerPlexFetchInterceptorForTests } from '../plex/client.ts';
import {
    encryptToken,
    getOrInitRawSecret,
    isPathMountedInMountInfo,
} from '../storage/crypto.ts';
import { closeDatabase, getDatabase } from '../storage/db.ts';
import {
    initDebugLoggingFromDb,
    isDebugForcedByEnv,
    isDebugLoggingEnabled,
    setUiDebugLoggingEnabled,
} from '../storage/diagnostics.ts';

const makePart = (id: number, file: string, streams: PlexStream[]): PlexPart => ({
    id,
    key: `/library/parts/${id}`,
    duration: 1440000,
    file,
    size: 1024 * 1024 * 500,
    container: 'mkv',
    videoProfile: 'main 10',
    Stream: streams,
});

const makeMedia = (id: number, parts: PlexPart[]): PlexMedia => ({
    id,
    duration: 1440000,
    bitrate: 8000,
    width: 1920,
    height: 1080,
    aspectRatio: 1.78,
    audioChannels: 2,
    audioCodec: 'aac',
    videoCodec: 'hevc',
    videoResolution: '1080',
    container: 'mkv',
    videoFrameRate: '24p',
    Part: parts,
});

describe('PASTA Server Scanner & SmartMatch Simulation Suite', () => {
    let tempDataDir = '';
    const mockPmsUrl = 'http://127.0.0.1:32400';

    // Track every POST /library/parts/:partId request sent to our mock PMS
    interface PartUpdateCall {
        partId: number;
        token: string;
        audioStreamID?: string;
        subtitleStreamID?: string;
    }
    const recordedPartUpdates: PartUpdateCall[] = [];

    // Mutable state for episode 502 (S01E02) to simulate a Sonarr file upgrade (Part.id change)
    let ep502PartId = 9001;
    let ep502AudioEngId = 101;
    let ep502AudioJpnId = 102;
    let ep502SubEngFullId = 201;
    let ep502SubEngForcedId = 202;

    // Mutable state for episode 503 (S01E03) to simulate an episode added during container downtime
    const ep503AddedAtSec = Math.floor(Date.now() / 1000) - 300; // Added 5 minutes ago

    const buildEpisode501ForUser = (token: string): PlexMetadata => {
        // User 1 (owner-token): watched S01E01 with Japanese Audio (102) + English Full Subtitles (201)
        // User 2 (managed-token): watched S01E01 with English Audio (101) + None Subtitles (no subtitle selected)
        const isOwner = token === 'owner-token';
        const streams: PlexStream[] = [
            {
                id: 101,
                index: 1,
                streamType: 2,
                codec: 'aac',
                language: 'English',
                languageCode: 'eng',
                displayTitle: 'English (AAC Stereo)',
                title: 'English',
                channels: 2,
                selected: !isOwner,
            },
            {
                id: 102,
                index: 2,
                streamType: 2,
                codec: 'aac',
                language: 'Japanese',
                languageCode: 'jpn',
                displayTitle: 'Japanese (AAC Stereo)',
                title: 'Japanese',
                channels: 2,
                selected: isOwner,
            },
            {
                id: 201,
                index: 3,
                streamType: 3,
                codec: 'ass',
                language: 'English',
                languageCode: 'eng',
                displayTitle: 'English (ASS)',
                title: 'Full Subtitles',
                forced: false,
                selected: isOwner,
            },
            {
                id: 202,
                index: 4,
                streamType: 3,
                codec: 'ass',
                language: 'English',
                languageCode: 'eng',
                displayTitle: 'English Forced (ASS)',
                title: 'Signs & Songs',
                forced: true,
                selected: false,
            },
        ];

        return {
            ratingKey: '501',
            key: '/library/metadata/501',
            guid: 'plex://episode/501',
            type: 'episode',
            title: 'Episode 1',
            grandparentRatingKey: '100',
            grandparentTitle: 'Oshi no Ko',
            parentRatingKey: '101',
            parentIndex: 1,
            index: 1,
            librarySectionID: 1,
            addedAt: ep503AddedAtSec - 86400,
            updatedAt: ep503AddedAtSec - 86400,
            Media: [
                makeMedia(5001, [
                    makePart(9000, '/media/TV/Oshi no Ko/Season 01/S01E01.mkv', streams),
                ]),
            ],
        };
    };

    const buildUntouchedTargetEpisode = (
        ratingKey: string,
        episodeNum: number,
        partId: number,
        audioEngId: number,
        audioJpnId: number,
        subFullId: number,
        subForcedId: number
    ): PlexMetadata => {
        // Default untouched state on PMS: English Audio selected, no subtitle selected
        const streams: PlexStream[] = [
            {
                id: audioEngId,
                index: 1,
                streamType: 2,
                codec: 'aac',
                language: 'English',
                languageCode: 'eng',
                displayTitle: 'English (AAC Stereo)',
                title: 'English',
                channels: 2,
                selected: true,
            },
            {
                id: audioJpnId,
                index: 2,
                streamType: 2,
                codec: 'aac',
                language: 'Japanese',
                languageCode: 'jpn',
                displayTitle: 'Japanese (AAC Stereo)',
                title: 'Japanese',
                channels: 2,
                selected: false,
            },
            {
                id: subFullId,
                index: 3,
                streamType: 3,
                codec: 'ass',
                language: 'English',
                languageCode: 'eng',
                displayTitle: 'English (ASS)',
                title: 'Full Subtitles',
                forced: false,
                selected: false,
            },
            {
                id: subForcedId,
                index: 4,
                streamType: 3,
                codec: 'ass',
                language: 'English',
                languageCode: 'eng',
                displayTitle: 'English Forced (ASS)',
                title: 'Signs & Songs',
                forced: true,
                selected: false,
            },
        ];

        return {
            ratingKey,
            key: `/library/metadata/${ratingKey}`,
            guid: `plex://episode/${ratingKey}`,
            type: 'episode',
            title: `Episode ${episodeNum}`,
            grandparentRatingKey: '100',
            grandparentTitle: 'Oshi no Ko',
            parentRatingKey: '101',
            parentIndex: 1,
            index: episodeNum,
            librarySectionID: 1,
            addedAt: ep503AddedAtSec,
            updatedAt: ep503AddedAtSec,
            Media: [
                makeMedia(5000 + episodeNum, [
                    makePart(partId, `/media/TV/Oshi no Ko/Season 01/S01E0${episodeNum}.mkv`, streams),
                ]),
            ],
        };
    };

    before(() => {
        tempDataDir = mkdtempSync(join(tmpdir(), 'pasta-scanner-test-'));
        process.env.PASTA_DATA_DIR = tempDataDir;

        getOrInitRawSecret();
        const db = getDatabase();

        // Install in-memory mock PMS interceptor
        setServerPlexFetchInterceptorForTests((parsedUrl, options) => {
            const method = options.method || 'GET';
            const pathname = parsedUrl.pathname;
            const token =
                parsedUrl.searchParams.get('X-Plex-Token') ||
                options.headers?.['X-Plex-Token'] ||
                '';

            // 1. POST /library/parts/:partId (Stream update)
            if (method === 'POST' && pathname.startsWith('/library/parts/')) {
                const partId = Number.parseInt(pathname.split('/').pop() || '0', 10);
                recordedPartUpdates.push({
                    partId,
                    token,
                    audioStreamID: parsedUrl.searchParams.get('audioStreamID') ?? undefined,
                    subtitleStreamID: parsedUrl.searchParams.get('subtitleStreamID') ?? undefined,
                });
                return { ok: true };
            }

            // 2. GET /library/sections (Libraries list)
            if (method === 'GET' && pathname === '/library/sections') {
                return {
                    MediaContainer: {
                        size: 1,
                        Directory: [
                            {
                                key: '1',
                                title: 'Anime',
                                type: 'show',
                                agent: 'tv.plex.agents.series',
                                scanner: 'Plex TV Series',
                                language: 'en-US',
                                uuid: 'lib-1',
                                updatedAt: 1000,
                                createdAt: 1000,
                                scannedAt: 1000,
                                content: true,
                                directory: true,
                                contentChangedAt: 1000,
                                hidden: 0,
                            },
                        ],
                    },
                };
            }

            // 3. GET /library/sections/1/all (Recently watched query OR catch-up query)
            if (method === 'GET' && pathname === '/library/sections/1/all') {
                const viewCountFilter = parsedUrl.searchParams.get('viewCount>=');
                if (viewCountFilter === '1') {
                    // User 3 (unwatched-token) has never watched this show
                    if (token === 'unwatched-token') {
                        return { MediaContainer: { size: 0, Metadata: [] } };
                    }
                    // Owner and Managed User both watched S01E01 (ratingKey 501) most recently
                    return {
                        MediaContainer: {
                            size: 1,
                            Metadata: [buildEpisode501ForUser(token)],
                        },
                    };
                }

                // Catch-up query (sort=addedAt:desc)
                const ep502 = buildUntouchedTargetEpisode(
                    '502',
                    2,
                    ep502PartId,
                    ep502AudioEngId,
                    ep502AudioJpnId,
                    ep502SubEngFullId,
                    ep502SubEngForcedId
                );
                const ep503 = buildUntouchedTargetEpisode('503', 3, 9003, 101, 102, 201, 202);
                return {
                    MediaContainer: {
                        size: 2,
                        Metadata: [ep503, ep502],
                    },
                };
            }

            // 4. GET /library/metadata/:ratingKey
            if (method === 'GET' && pathname.startsWith('/library/metadata/')) {
                const ratingKey = pathname.split('/').pop() || '';
                if (ratingKey === '100') {
                    return {
                        MediaContainer: {
                            size: 1,
                            Metadata: [
                                {
                                    ratingKey: '100',
                                    key: '/library/metadata/100',
                                    guid: 'plex://show/100',
                                    type: 'show',
                                    title: 'Oshi no Ko',
                                    librarySectionID: 1,
                                    addedAt: ep503AddedAtSec - 86400,
                                    updatedAt: ep503AddedAtSec - 86400,
                                },
                            ],
                        },
                    };
                }
                if (ratingKey === '501') {
                    return {
                        MediaContainer: {
                            size: 1,
                            Metadata: [buildEpisode501ForUser(token)],
                        },
                    };
                }
                if (ratingKey === '502') {
                    return {
                        MediaContainer: {
                            size: 1,
                            Metadata: [
                                buildUntouchedTargetEpisode(
                                    '502',
                                    2,
                                    ep502PartId,
                                    ep502AudioEngId,
                                    ep502AudioJpnId,
                                    ep502SubEngFullId,
                                    ep502SubEngForcedId
                                ),
                            ],
                        },
                    };
                }
                if (ratingKey === '503') {
                    return {
                        MediaContainer: {
                            size: 1,
                            Metadata: [
                                buildUntouchedTargetEpisode('503', 3, 9003, 101, 102, 201, 202),
                            ],
                        },
                    };
                }
            }

            throw new Error(`Unhandled mock PMS route: ${method} ${pathname}`);
        });

        // Seed monitored server and 3 users in SQLite
        const now = Date.now();
        db.prepare(`
            INSERT INTO monitored_servers (
                machine_identifier,
                server_name,
                server_url,
                owner_plex_user_id,
                encrypted_owner_token,
                auth_status,
                is_monitoring_enabled,
                trigger_on_play,
                trigger_on_scan,
                trigger_on_activity,
                auto_forced_subtitles,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, 'OK', 1, 1, 1, 1, 1, ?)
        `).run('srv-test-1', 'Test Plex Server', mockPmsUrl, 1, encryptToken('owner-token'), now);

        const insertUser = db.prepare(`
            INSERT INTO server_users (
                machine_identifier,
                plex_user_id,
                uuid,
                username,
                title,
                email,
                thumb,
                is_home_user,
                is_protected,
                is_server_owner,
                is_pasta_admin,
                encrypted_access_token,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, '', '', 1, 0, ?, ?, ?, ?)
        `);

        insertUser.run('srv-test-1', 1, 'u-1', 'cglatot', 'cglatot', 1, 1, encryptToken('owner-token'), now);
        insertUser.run('srv-test-1', 2, 'u-2', 'ManagedKid', 'ManagedKid', 0, 0, encryptToken('managed-token'), now);
        insertUser.run('srv-test-1', 3, 'u-3', 'NeverWatched', 'NeverWatched', 0, 0, encryptToken('unwatched-token'), now);
    });

    after(() => {
        setServerPlexFetchInterceptorForTests(null);
        closeDatabase();
        if (tempDataDir) {
            rmSync(tempDataDir, { recursive: true, force: true });
        }
    });

    it('1. NEW_EPISODE_SCAN: propagates each active viewer’s last-watched tracks (including Auto-Forced Subtitles) and skips unwatched users', async () => {
        recordedPartUpdates.length = 0;

        await handleTimelineEpisodeFinished({
            machineIdentifier: 'srv-test-1',
            serverUrl: mockPmsUrl,
            ownerToken: 'owner-token',
            episodeRatingKey: '502',
            metadataState: 'created',
        });

        // Verify stored part_id was seeded as 9001
        assert.equal(getStoredEpisodePartId('srv-test-1', '502'), 9001);

        // User 1 (owner-token): Japanese Audio (102) + English Full Subtitles (201)
        const ownerCalls = recordedPartUpdates.filter(c => c.token === 'owner-token');
        assert.equal(ownerCalls.length, 2);
        assert.deepEqual(
            ownerCalls.map(c => ({ partId: c.partId, audio: c.audioStreamID, sub: c.subtitleStreamID })),
            [
                { partId: 9001, audio: '102', sub: undefined },
                { partId: 9001, audio: undefined, sub: '201' },
            ]
        );

        // User 2 (managed-token): English Audio (101) was already selected on target,
        // and because reference Sub was None with auto_forced_subtitles=1, English Forced (202) is automatically selected!
        const managedCalls = recordedPartUpdates.filter(c => c.token === 'managed-token');
        assert.equal(managedCalls.length, 1);
        assert.deepEqual(managedCalls[0], {
            partId: 9001,
            token: 'managed-token',
            audioStreamID: undefined,
            subtitleStreamID: '202',
        });

        // User 3 (unwatched-token): 0 calls
        const unwatchedCalls = recordedPartUpdates.filter(c => c.token === 'unwatched-token');
        assert.equal(unwatchedCalls.length, 0);

        // Verify Activity Log entry in SQLite
        const db = getDatabase();
        const op = db
            .prepare('SELECT * FROM auto_operations WHERE reference_episode_key = ? ORDER BY id DESC LIMIT 1')
            .get('502') as {
            id: number;
            trigger_type: string;
            updated_count: number;
            skipped_count: number;
        };
        assert.ok(op);
        assert.equal(op.trigger_type, 'NEW_EPISODE_SCAN');
        assert.equal(op.updated_count, 2);
        assert.equal(op.skipped_count, 0);

        const epRows = db
            .prepare('SELECT target_username, was_updated FROM auto_operation_episodes WHERE operation_id = ? ORDER BY id ASC')
            .all(op.id) as Array<{ target_username: string; was_updated: number }>;
        assert.deepEqual(
            epRows.map(r => ({ ...r })),
            [
                { target_username: 'cglatot', was_updated: 1 },
                { target_username: 'ManagedKid', was_updated: 1 },
            ]
        );
    });

    it('2. UPGRADED_FILE_SCAN: detects Sonarr file replacement (Part.id change) and restores user streams on the new media part', async () => {
        recordedPartUpdates.length = 0;

        const realDateNow = Date.now;
        let fakeNow = realDateNow() + 10_000;
        Date.now = () => fakeNow;

        try {
            // First, verify an ordinary metadata refresh with the SAME part_id (9001) is a complete no-op
            await handleTimelineEpisodeFinished({
                machineIdentifier: 'srv-test-1',
                serverUrl: mockPmsUrl,
                ownerToken: 'owner-token',
                episodeRatingKey: '502',
            });
            assert.equal(recordedPartUpdates.length, 0);

            // Now simulate Sonarr upgrading S01E02: Part.id changes from 9001 -> 9999 with new stream IDs
            fakeNow += 10_000;
            ep502PartId = 9999;
            ep502AudioEngId = 1101;
            ep502AudioJpnId = 1102;
            ep502SubEngFullId = 1201;
            ep502SubEngForcedId = 1202;

            await handleTimelineEpisodeFinished({
                machineIdentifier: 'srv-test-1',
                serverUrl: mockPmsUrl,
                ownerToken: 'owner-token',
                episodeRatingKey: '502',
            });

            // Verify stored part_id updated to 9999
            assert.equal(getStoredEpisodePartId('srv-test-1', '502'), 9999);

            // Verify streams were applied to the new part 9999
            const ownerCalls = recordedPartUpdates.filter(c => c.token === 'owner-token');
            assert.equal(ownerCalls.length, 2);
            assert.deepEqual(
                ownerCalls.map(c => ({ partId: c.partId, audio: c.audioStreamID, sub: c.subtitleStreamID })),
                [
                    { partId: 9999, audio: '1102', sub: undefined },
                    { partId: 9999, audio: undefined, sub: '1201' },
                ]
            );

            const managedCalls = recordedPartUpdates.filter(c => c.token === 'managed-token');
            assert.equal(managedCalls.length, 1);
            assert.deepEqual(managedCalls[0], {
                partId: 9999,
                token: 'managed-token',
                audioStreamID: undefined,
                subtitleStreamID: '1202',
            });

            // Verify Activity Log recorded UPGRADED_FILE_SCAN
            const db = getDatabase();
            const op = db
                .prepare('SELECT * FROM auto_operations WHERE reference_episode_key = ? ORDER BY id DESC LIMIT 1')
                .get('502') as {
                trigger_type: string;
                updated_count: number;
            };
            assert.equal(op.trigger_type, 'UPGRADED_FILE_SCAN');
            assert.equal(op.updated_count, 2);
        } finally {
            Date.now = realDateNow;
        }
    });

    it('3. Downtime Catch-Up (catchUpMissedEpisodesSince): discovers and processes episodes added while container was offline', async () => {
        recordedPartUpdates.length = 0;

        // Episode 503 has not been seen yet (storedPartId is null) and was added 5 minutes ago
        assert.equal(getStoredEpisodePartId('srv-test-1', '503'), null);

        // Run catch-up for events since 1 hour ago
        const oneHourAgoMs = Date.now() - 60 * 60 * 1000;
        await catchUpMissedEpisodesSince('srv-test-1', mockPmsUrl, 'owner-token', oneHourAgoMs);

        // Episode 503 should now be seeded in episode_parts (partId 9003) and updated for both viewers
        assert.equal(getStoredEpisodePartId('srv-test-1', '503'), 9003);
        assert.equal(recordedPartUpdates.length, 3); // 2 updates for cglatot + 1 update for ManagedKid on part 9003
        assert.ok(recordedPartUpdates.every(c => c.partId === 9003));

        // Running catch-up a second time should be a complete no-op because Episode 503 is now in episode_parts
        recordedPartUpdates.length = 0;
        await catchUpMissedEpisodesSince('srv-test-1', mockPmsUrl, 'owner-token', oneHourAgoMs);
        assert.equal(recordedPartUpdates.length, 0);
    });

    it('4. Multi-Version (4K + 1080p in Media[]) Resolution: matches and updates streams across all merged versions', () => {
        const refStream: PlexStream = {
            id: 102,
            index: 2,
            streamType: 2,
            codec: 'eac3',
            language: 'Japanese',
            languageCode: 'jpn',
            displayTitle: 'Japanese (EAC3 5.1)',
            title: 'Japanese',
            channels: 6,
            selected: true,
        };

        const mergedMultiVersionEpisode: PlexMetadata = {
            ratingKey: '777',
            key: '/library/metadata/777',
            guid: 'plex://episode/777',
            type: 'episode',
            title: 'Multi-Version Episode',
            addedAt: 1000,
            updatedAt: 1000,
            Media: [
                // Version 1: 4K Remux (Part 7001)
                makeMedia(1, [
                    makePart(7001, '/media/4K/Ep1.mkv', [
                        {
                            id: 7101,
                            index: 1,
                            streamType: 2,
                            codec: 'truehd',
                            language: 'English',
                            languageCode: 'eng',
                            displayTitle: 'English (TrueHD 7.1)',
                            selected: true,
                        },
                        {
                            id: 7102,
                            index: 2,
                            streamType: 2,
                            codec: 'flac',
                            language: 'Japanese',
                            languageCode: 'jpn',
                            displayTitle: 'Japanese (FLAC 2.0)',
                            selected: false,
                        },
                    ]),
                ]),
                // Version 2: 1080p Web-DL (Part 8001)
                makeMedia(2, [
                    makePart(8001, '/media/1080p/Ep1.mkv', [
                        {
                            id: 8101,
                            index: 1,
                            streamType: 2,
                            codec: 'aac',
                            language: 'English',
                            languageCode: 'eng',
                            displayTitle: 'English (AAC 2.0)',
                            selected: true,
                        },
                        {
                            id: 8102,
                            index: 2,
                            streamType: 2,
                            codec: 'eac3',
                            language: 'Japanese',
                            languageCode: 'jpn',
                            displayTitle: 'Japanese (EAC3 5.1)',
                            selected: false,
                        },
                    ]),
                ]),
            ],
        };

        const resolution = resolveEpisodePartUpdates(mergedMultiVersionEpisode, refStream, 'audio');
        assert.equal(resolution.hasStreams, true);
        assert.equal(resolution.allAlreadyMatched, false);
        assert.deepEqual(resolution.partUpdates, [
            { partId: 7001, streamId: 7102, alreadySelected: false },
            { partId: 8001, streamId: 8102, alreadySelected: false },
        ]);
    });

    it('5. PASTA_MODE (server vs client): injects __PASTA_SERVER_MODE__ in server mode and serves pure client SPA in client mode', async () => {
        const fakeDistDir = mkdtempSync(join(tmpdir(), 'pasta-dist-test-'));
        try {
            writeFileSync(
                join(fakeDistDir, 'index.html'),
                '<!doctype html><html><head><title>PASTA</title></head><body><div id="root"></div></body></html>',
                'utf8'
            );

            const router = new ApiRouter();
            const invokeRouter = async (
                urlPath: string,
                injectServerMode: boolean,
                unmountedConfigFallback: boolean = false
            ): Promise<{ statusCode: number; body: string }> => {
                let body = '';
                const req = {
                    method: 'GET',
                    url: urlPath,
                    headers: { host: 'localhost' },
                } as unknown as IncomingMessage;
                const res = {
                    statusCode: 200,
                    writableEnded: false,
                    setHeader: () => {},
                    end: (chunk?: string | Buffer) => {
                        if (chunk) body += chunk.toString();
                    },
                } as unknown as ServerResponse;

                await router.handle(
                    req,
                    res,
                    fakeDistDir,
                    injectServerMode,
                    unmountedConfigFallback
                );
                return { statusCode: res.statusCode, body };
            };

            // Server Mode (default): injects window.__PASTA_SERVER_MODE__ = true
            const serverHtmlRes = await invokeRouter('/', true, false);
            assert.equal(serverHtmlRes.statusCode, 200);
            assert.ok(serverHtmlRes.body.includes('window.__PASTA_SERVER_MODE__ = true;'));

            // Client Mode (PASTA_MODE=client): does NOT inject window.__PASTA_SERVER_MODE__ and blocks /api/*
            const clientHtmlRes = await invokeRouter('/', false, false);
            assert.equal(clientHtmlRes.statusCode, 200);
            assert.ok(!clientHtmlRes.body.includes('window.__PASTA_SERVER_MODE__'));
            assert.ok(!clientHtmlRes.body.includes('window.__PASTA_UNMOUNTED_CONFIG__'));

            // Unmounted /config fallback: serves Client Mode and injects window.__PASTA_UNMOUNTED_CONFIG__ = true
            const unmountedHtmlRes = await invokeRouter('/', false, true);
            assert.equal(unmountedHtmlRes.statusCode, 200);
            assert.ok(!unmountedHtmlRes.body.includes('window.__PASTA_SERVER_MODE__'));
            assert.ok(unmountedHtmlRes.body.includes('window.__PASTA_UNMOUNTED_CONFIG__ = true;'));

            const clientApiRes = await invokeRouter('/api/auth/session', false);
            assert.equal(clientApiRes.statusCode, 404);

            // Verify /proc/self/mountinfo parser for unmounted vs mounted /config
            const unmountedMountInfo = [
                '725 710 0:65 / / rw,relatime - overlay overlay rw',
                '726 725 0:68 / /proc rw,nosuid,nodev,noexec,relatime - proc proc rw',
                '727 725 8:1 /docker/containers/abc/hosts /etc/hosts rw,relatime - ext4 /dev/sda1 rw',
            ].join('\n');
            assert.equal(isPathMountedInMountInfo('/config', unmountedMountInfo), false);

            const mountedMountInfo = [
                ...unmountedMountInfo.split('\n'),
                '728 725 0:42 /appdata/pasta /config rw,relatime - shfs shfs rw',
            ].join('\n');
            assert.equal(isPathMountedInMountInfo('/config', mountedMountInfo), true);

            // Verify PASTA_DEBUG (true / false / unset) + UI debug toggle persistence
            const prevDebugEnv = process.env.PASTA_DEBUG;
            try {
                delete process.env.PASTA_DEBUG;
                setUiDebugLoggingEnabled(false);
                assert.equal(isDebugForcedByEnv(), false);
                assert.equal(isDebugLoggingEnabled(), false);

                // Explicitly set PASTA_DEBUG=false: should NOT force or lock the UI toggle
                process.env.PASTA_DEBUG = 'false';
                assert.equal(isDebugForcedByEnv(), false);
                setUiDebugLoggingEnabled(true);
                assert.equal(isDebugLoggingEnabled(), true);
                initDebugLoggingFromDb();
                assert.equal(isDebugLoggingEnabled(), true);

                setUiDebugLoggingEnabled(false);
                assert.equal(isDebugLoggingEnabled(), false);

                // Explicitly set PASTA_DEBUG=true: forces debug logging ON regardless of UI toggle
                process.env.PASTA_DEBUG = 'true';
                assert.equal(isDebugForcedByEnv(), true);
                assert.equal(isDebugLoggingEnabled(), true);
            } finally {
                if (prevDebugEnv === undefined) {
                    delete process.env.PASTA_DEBUG;
                } else {
                    process.env.PASTA_DEBUG = prevDebugEnv;
                }
                setUiDebugLoggingEnabled(false);
            }
        } finally {
            rmSync(fakeDistDir, { recursive: true, force: true });
        }
    });
});
