import { randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import type { Duplex } from 'node:stream';
import type { PlexMetadata } from '../../../src/shared/types/plex.ts';
import { getMonitoredServer } from '../api/serverRoutes.ts';
import { getPmsMetadata, getPmsParams, serverPlexFetch } from '../plex/client.ts';
import {
    getServerUsers,
    getUserTokenForServer,
    resolvePmsAccountId,
} from '../plex/userManager.ts';
import { decryptToken } from '../storage/crypto.ts';
import { getDatabase } from '../storage/db.ts';
import { recordDiagnosticEvent } from '../storage/diagnostics.ts';
import {
    cancelPendingDebounceForEpisode,
    flushDebouncedEventOnStop,
    flushDebouncedEventOnStopByEpisode,
    scheduleDebouncedTrackChange,
} from './eventBuffer.ts';
import { evaluateAutomationRule } from './ruleEvaluator.ts';
import {
    catchUpMissedEpisodesSince,
    handleTimelineEpisodeFinished,
    seedServerEpisodePartsIfNeeded,
} from './scanner.ts';
import { diffAndRecordEpisodeStreams } from './stateDiffCache.ts';

interface PlexNotificationEnvelope {
    NotificationContainer?: {
        type?: string;
        PlaySessionStateNotification?: Array<{
            sessionKey?: string;
            clientIdentifier?: string;
            ratingKey?: string;
            key?: string;
            viewOffset?: number;
            state?: 'playing' | 'paused' | 'stopped' | 'buffering';
        }>;
        ActivityNotification?: Array<{
            event?: string;
            Activity?: {
                type?: string;
                userID?: number;
                Context?: {
                    key?: string;
                };
            };
        }>;
        TimelineEntry?: Array<{
            itemID?: string | number;
            type?: number;
            state?: number;
            metadataState?: string;
        }>;
    };
}

interface PlexSessionsResponse {
    MediaContainer?: {
        Metadata?: Array<{
            sessionKey?: string | number;
            ratingKey?: string;
            User?: {
                id?: string | number;
                title?: string;
            };
            Player?: {
                machineIdentifier?: string;
            };
        }>;
    };
}

const BACKOFF_DELAYS_MS = [2000, 5000, 10000, 30000];
const PING_INTERVAL_MS = 30000;

/**
 * Encodes a client-to-server RFC 6455 WebSocket control frame (Ping = 0x89, Pong = 0x8A, Close = 0x88).
 */
const createMaskedControlFrame = (opcode: number, payload: Buffer = Buffer.alloc(0)): Buffer => {
    const maskKey = randomBytes(4);
    const frame = Buffer.alloc(2 + 4 + payload.length);
    frame[0] = 0x80 | (opcode & 0x0f);
    frame[1] = 0x80 | (payload.length & 0x7f);
    maskKey.copy(frame, 2);
    for (let i = 0; i < payload.length; i++) {
        frame[6 + i] = payload[i] ^ maskKey[i % 4];
    }
    return frame;
};

export class PlexAlertListener {
    public readonly machineIdentifier: string;
    private stopped = false;
    private socket: Duplex | null = null;
    private pingTimer: ReturnType<typeof setInterval> | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectAttempt = 0;
    private awaitingPong = false;
    private sessionUserCache = new Map<string, number>();
    private clientUserCache = new Map<string, number>();
    private recentActivityDedupe = new Map<string, number>();

    constructor(machineIdentifier: string) {
        this.machineIdentifier = machineIdentifier;
    }

    public start(): void {
        this.stopped = false;
        this.connect();
    }

    public stop(): void {
        this.stopped = true;
        this.cleanupSocket();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    private cleanupSocket(): void {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
        if (this.socket) {
            try {
                this.socket.write(createMaskedControlFrame(0x08));
                this.socket.destroy();
            } catch {
                // Ignore socket close error
            }
            this.socket = null;
        }
    }

    private scheduleReconnect(): void {
        if (this.stopped || this.reconnectTimer) return;
        const idx = Math.min(this.reconnectAttempt, BACKOFF_DELAYS_MS.length - 1);
        const delay = BACKOFF_DELAYS_MS[idx];
        this.reconnectAttempt++;

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, delay);
    }

    private markAuthExpired(): void {
        const db = getDatabase();
        db.prepare(
            "UPDATE monitored_servers SET auth_status = 'AUTH_EXPIRED', updated_at = ? WHERE machine_identifier = ?"
        ).run(Date.now(), this.machineIdentifier);
        console.warn(
            `[PASTA Daemon] Auth token expired (401) for server ${this.machineIdentifier}. Stopping retry until Owner re-authenticates.`
        );
        this.stop();
    }

    private updateLastEventTimestamp(): void {
        const db = getDatabase();
        db.prepare(
            'UPDATE monitored_servers SET last_event_timestamp = ?, updated_at = ? WHERE machine_identifier = ?'
        ).run(Date.now(), Date.now(), this.machineIdentifier);
    }

    private connect(): void {
        if (this.stopped) return;

        const monitored = getMonitoredServer(this.machineIdentifier);
        if (!monitored || !monitored.is_monitoring_enabled) {
            return;
        }

        const effectiveUrl =
            monitored.custom_url_override?.trim() || monitored.server_url?.trim();
        if (!effectiveUrl) return;

        let ownerToken = '';
        try {
            ownerToken = decryptToken(monitored.encrypted_owner_token);
        } catch {
            return;
        }

        let parsedUrl: URL;
        try {
            const urlWithProto = /^https?:\/\//i.test(effectiveUrl)
                ? effectiveUrl
                : `http://${effectiveUrl}`;
            parsedUrl = new URL(urlWithProto);
        } catch {
            return;
        }

        const isHttps = parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'wss:';
        const transport = isHttps ? https : http;
        const wsKey = randomBytes(16).toString('base64');

        const wsPath = `/:/websockets/notifications?X-Plex-Token=${encodeURIComponent(ownerToken)}`;

        const req = transport.request({
            protocol: isHttps ? 'https:' : 'http:',
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (isHttps ? 443 : 80),
            path: wsPath,
            method: 'GET',
            headers: {
                Connection: 'Upgrade',
                Upgrade: 'websocket',
                'Sec-WebSocket-Key': wsKey,
                'Sec-WebSocket-Version': '13',
                'X-Plex-Product': 'PASTA Server',
                'X-Plex-Client-Identifier': 'PASTA-Server-Daemon',
            },
            rejectUnauthorized: false, // Allow self-signed LAN Plex certificates
        });

        req.on('response', res => {
            if (res.statusCode === 401 || res.statusCode === 403) {
                res.resume();
                recordDiagnosticEvent(
                    'AUTH',
                    `WebSocket handshake rejected with HTTP ${res.statusCode} (owner token expired)`,
                    { statusCode: res.statusCode },
                    this.machineIdentifier
                );
                this.markAuthExpired();
                return;
            }
            res.resume();
            recordDiagnosticEvent(
                'DAEMON',
                `WebSocket upgrade returned unexpected HTTP ${res.statusCode}; scheduling reconnect`,
                { statusCode: res.statusCode, attempt: this.reconnectAttempt + 1 },
                this.machineIdentifier
            );
            this.scheduleReconnect();
        });

        req.on('upgrade', (_res, socket, head) => {
            this.socket = socket;
            this.reconnectAttempt = 0;
            this.awaitingPong = false;

            recordDiagnosticEvent(
                'DAEMON',
                'Connected to Plex WebSocket notification stream',
                { serverUrl: effectiveUrl },
                this.machineIdentifier
            );

            const db = getDatabase();
            db.prepare(
                "UPDATE monitored_servers SET auth_status = 'OK', updated_at = ? WHERE machine_identifier = ?"
            ).run(Date.now(), this.machineIdentifier);

            // Seed episode part_ids (one-time) & run downtime catch-up
            void seedServerEpisodePartsIfNeeded(
                this.machineIdentifier,
                effectiveUrl,
                ownerToken
            ).then(() =>
                catchUpMissedEpisodesSince(
                    this.machineIdentifier,
                    effectiveUrl,
                    ownerToken,
                    monitored.last_event_timestamp
                )
            );

            // 30-second protocol-level Ping/Pong heartbeat
            this.pingTimer = setInterval(() => {
                if (!this.socket || this.socket.destroyed) return;
                if (this.awaitingPong) {
                    // Previous ping was not answered within 30s -> silent TCP drop
                    this.cleanupSocket();
                    this.scheduleReconnect();
                    return;
                }
                this.awaitingPong = true;
                try {
                    this.socket.write(createMaskedControlFrame(0x09));
                } catch {
                    this.cleanupSocket();
                    this.scheduleReconnect();
                }
            }, PING_INTERVAL_MS);
            this.pingTimer.unref();

            let buffer: Buffer = head && head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);
            let messageFragments: Buffer[] = [];

            const processFrames = () => {
                while (buffer.length >= 2) {
                    const firstByte = buffer[0];
                    const secondByte = buffer[1];
                    const fin = Boolean(firstByte & 0x80);
                    const opcode = firstByte & 0x0f;
                    const isMasked = Boolean(secondByte & 0x80);
                    let payloadLen = secondByte & 0x7f;
                    let offset = 2;

                    if (payloadLen === 126) {
                        if (buffer.length < 4) return;
                        payloadLen = buffer.readUInt16BE(2);
                        offset = 4;
                    } else if (payloadLen === 127) {
                        if (buffer.length < 10) return;
                        payloadLen = Number(buffer.readBigUInt64BE(2));
                        offset = 10;
                    }

                    const maskOffset = offset;
                    if (isMasked) {
                        offset += 4;
                    }

                    if (buffer.length < offset + payloadLen) {
                        return; // Wait for more TCP bytes
                    }

                    const payload = Buffer.from(buffer.subarray(offset, offset + payloadLen));
                    if (isMasked) {
                        const mask = buffer.subarray(maskOffset, maskOffset + 4);
                        for (let i = 0; i < payload.length; i++) {
                            payload[i] ^= mask[i % 4];
                        }
                    }

                    buffer = buffer.subarray(offset + payloadLen);

                    if (opcode === 0x0a) {
                        // Pong frame
                        this.awaitingPong = false;
                    } else if (opcode === 0x09) {
                        // Ping from PMS -> reply with Pong
                        try {
                            socket.write(createMaskedControlFrame(0x0a, payload));
                        } catch {
                            // Ignore write error
                        }
                    } else if (opcode === 0x08) {
                        // Close frame
                        this.cleanupSocket();
                        this.scheduleReconnect();
                        return;
                    } else if (opcode === 0x01 || opcode === 0x00) {
                        messageFragments.push(payload);
                        if (fin) {
                            const fullText = Buffer.concat(messageFragments).toString('utf8');
                            messageFragments = [];
                            this.handleMessageJson(fullText, effectiveUrl, ownerToken);
                        }
                    }
                }
            };

            if (buffer.length > 0) {
                processFrames();
            }

            socket.on('data', (chunk: Buffer) => {
                buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
                processFrames();
            });

            socket.on('close', () => {
                this.cleanupSocket();
                this.scheduleReconnect();
            });

            socket.on('error', () => {
                this.cleanupSocket();
                this.scheduleReconnect();
            });
        });

        req.on('error', () => {
            this.scheduleReconnect();
        });

        req.end();
    }

    private handleMessageJson(
        rawJson: string,
        serverUrl: string,
        ownerToken: string
    ): void {
        let parsed: PlexNotificationEnvelope;
        try {
            parsed = JSON.parse(rawJson) as PlexNotificationEnvelope;
        } catch {
            return;
        }

        const container = parsed.NotificationContainer;
        if (!container) return;

        this.updateLastEventTimestamp();

        const monitored = getMonitoredServer(this.machineIdentifier);
        if (!monitored || !monitored.is_monitoring_enabled) return;

        // 1. PlayingNotification (`playing`)
        if (
            monitored.trigger_on_play &&
            Array.isArray(container.PlaySessionStateNotification)
        ) {
            for (const item of container.PlaySessionStateNotification) {
                const ratingKey =
                    item.ratingKey ||
                    (item.key ? /\/library\/metadata\/(\d+)/.exec(item.key)?.[1] : undefined);
                if (ratingKey && item.sessionKey) {
                    void this.handlePlayingEvent(
                        serverUrl,
                        ownerToken,
                        String(item.sessionKey),
                        String(ratingKey),
                        item.state || 'playing',
                        monitored.debounce_seconds,
                        item.clientIdentifier
                    );
                }
            }
        }

        // 2. ActivityNotification (`library.refresh.items` / `library.update.item.streams`)
        if (
            monitored.trigger_on_activity &&
            Array.isArray(container.ActivityNotification)
        ) {
            for (const act of container.ActivityNotification) {
                if (
                    act.event === 'ended' &&
                    (act.Activity?.type === 'library.refresh.items' ||
                        act.Activity?.type === 'library.update.item.streams') &&
                    act.Activity?.Context?.key &&
                    act.Activity?.userID
                ) {
                    const match = /\/library\/metadata\/(\d+)/.exec(act.Activity.Context.key);
                    if (match) {
                        const resolvedUid = resolvePmsAccountId(
                            this.machineIdentifier,
                            Number(act.Activity.userID)
                        );
                        const ratingKey = match[1];
                        const dedupeKey = `${resolvedUid}:${ratingKey}`;
                        const now = Date.now();
                        const lastSeen = this.recentActivityDedupe.get(dedupeKey) || 0;
                        if (now - lastSeen < 3000) {
                            continue;
                        }
                        this.recentActivityDedupe.set(dedupeKey, now);

                        void this.handleActivityStreamChange(
                            serverUrl,
                            ownerToken,
                            resolvedUid,
                            ratingKey,
                            monitored.debounce_seconds
                        );
                    }
                }
            }
        }

        // 3. TimelineEntry (`state=5, type=4` -> TV Episode finished scanning/upgrading)
        if (monitored.trigger_on_scan && Array.isArray(container.TimelineEntry)) {
            for (const entry of container.TimelineEntry) {
                if (entry.state === 5 && entry.type === 4 && entry.itemID) {
                    void handleTimelineEpisodeFinished({
                        machineIdentifier: this.machineIdentifier,
                        serverUrl,
                        ownerToken,
                        episodeRatingKey: String(entry.itemID),
                        metadataState: entry.metadataState,
                    });
                }
            }
        }
    }

    private async resolveUserIdFromSessionKey(
        serverUrl: string,
        ownerToken: string,
        sessionKey: string,
        clientIdentifier?: string,
        ratingKey?: string,
        allowRetry = true
    ): Promise<number | null> {
        const cached = this.sessionUserCache.get(sessionKey);
        if (cached) return cached;
        if (clientIdentifier) {
            const clientCached = this.clientUserCache.get(clientIdentifier);
            if (clientCached) {
                this.sessionUserCache.set(sessionKey, clientCached);
                return clientCached;
            }
        }

        const querySessions = async (): Promise<number | null> => {
            let ratingKeyMatchUid: number | null = null;
            try {
                const data = await serverPlexFetch<PlexSessionsResponse>(
                    `${serverUrl}/status/sessions`,
                    {
                        params: getPmsParams('PASTA-Server-Daemon', ownerToken),
                    }
                );
                const sessions = data.MediaContainer?.Metadata || [];
                for (const s of sessions) {
                    if (s.User?.id !== undefined) {
                        const pmsUid = Number(s.User.id);
                        if (!Number.isNaN(pmsUid) && pmsUid > 0) {
                            const uid = resolvePmsAccountId(
                                this.machineIdentifier,
                                pmsUid,
                                s.User.title
                            );
                            if (s.sessionKey !== undefined) {
                                this.sessionUserCache.set(String(s.sessionKey), uid);
                            }
                            if (s.Player?.machineIdentifier) {
                                this.clientUserCache.set(s.Player.machineIdentifier, uid);
                            }
                            if (ratingKey && String(s.ratingKey) === String(ratingKey)) {
                                ratingKeyMatchUid = uid;
                            }
                        }
                    }
                }
            } catch {
                // Ignore session lookup failure
            }

            return (
                this.sessionUserCache.get(sessionKey) ||
                (clientIdentifier ? this.clientUserCache.get(clientIdentifier) || null : null) ||
                ratingKeyMatchUid
            );
        };

        const firstTry = await querySessions();
        if (firstTry || !allowRetry || this.stopped) {
            return firstTry;
        }

        // When a stream first enters `buffering` / `playing`, PMS may broadcast the WebSocket
        // notification a few hundred milliseconds before `/status/sessions` lists the session.
        await new Promise(resolve => setTimeout(resolve, 500));
        if (this.stopped) return null;
        return querySessions();
    }

    private async handlePlayingEvent(
        serverUrl: string,
        ownerToken: string,
        sessionKey: string,
        ratingKey: string,
        state: 'playing' | 'paused' | 'stopped' | 'buffering',
        debounceSeconds: number,
        clientIdentifier?: string
    ): Promise<void> {
        if (state === 'stopped') {
            const cachedUid =
                this.sessionUserCache.get(sessionKey) ||
                (clientIdentifier ? this.clientUserCache.get(clientIdentifier) || null : null);
            this.sessionUserCache.delete(sessionKey);
            if (cachedUid) {
                await flushDebouncedEventOnStop(this.machineIdentifier, cachedUid, ratingKey);
            }
            await flushDebouncedEventOnStopByEpisode(this.machineIdentifier, ratingKey);
            return;
        }

        const userId = await this.resolveUserIdFromSessionKey(
            serverUrl,
            ownerToken,
            sessionKey,
            clientIdentifier,
            ratingKey,
            true
        );
        if (!userId) return;

        const userToken =
            getUserTokenForServer(this.machineIdentifier, userId) || ownerToken;
        const users = getServerUsers(this.machineIdentifier);
        const userRecord = users.find(u => u.plexUserId === userId);
        const username = userRecord?.title || userRecord?.username || `User ${userId}`;

        const episode: PlexMetadata | undefined = await getPmsMetadata(
            serverUrl,
            ratingKey,
            'PASTA-Server-Daemon',
            userToken
        ).catch(() => undefined);

        if (!episode || episode.type !== 'episode') return;

        // Short-circuit immediately if the episode's library or show is ignored
        const quickRule = evaluateAutomationRule(this.machineIdentifier, episode);
        if (!quickRule.allowed) {
            recordDiagnosticEvent(
                'RULE',
                `Skipped playback event on episode ${ratingKey} (${episode.title || 'Unknown'}): ${quickRule.reason}`,
                { episodeRatingKey: ratingKey, userId },
                this.machineIdentifier
            );
            return;
        }

        const diff = diffAndRecordEpisodeStreams({
            machineIdentifier: this.machineIdentifier,
            plexUserId: userId,
            episode,
            source: 'playing',
        });

        if (!diff.changed) {
            cancelPendingDebounceForEpisode(this.machineIdentifier, userId, ratingKey);
            return;
        }

        recordDiagnosticEvent(
            'DAEMON',
            `Scheduled debounced playback sync (${debounceSeconds}s) for episode ${ratingKey}`,
            {
                episodeRatingKey: ratingKey,
                audioChanged: diff.audioChanged,
                subtitleChanged: diff.subtitleChanged,
            },
            this.machineIdentifier
        );

        scheduleDebouncedTrackChange({
            machineIdentifier: this.machineIdentifier,
            serverUrl,
            plexUserId: userId,
            username,
            userToken,
            episodeRatingKey: ratingKey,
            showRatingKey: episode.grandparentRatingKey,
            triggerType: 'PLAYBACK_CHANGE',
            audioChanged: diff.audioChanged,
            subtitleChanged: diff.subtitleChanged,
            audioStreamId: diff.audioStreamId,
            subtitleStreamId: diff.subtitleStreamId,
            debounceSeconds,
        });
    }

    private async handleActivityStreamChange(
        serverUrl: string,
        ownerToken: string,
        userId: number,
        ratingKey: string,
        debounceSeconds: number
    ): Promise<void> {
        const userToken =
            getUserTokenForServer(this.machineIdentifier, userId) || ownerToken;
        const users = getServerUsers(this.machineIdentifier);
        const userRecord = users.find(u => u.plexUserId === userId);
        const username = userRecord?.title || userRecord?.username || `User ${userId}`;

        const episode = await getPmsMetadata(
            serverUrl,
            ratingKey,
            'PASTA-Server-Daemon',
            userToken
        ).catch(() => undefined);

        if (!episode || episode.type !== 'episode') return;

        // Short-circuit immediately if the episode's library or show is ignored
        const quickRule = evaluateAutomationRule(this.machineIdentifier, episode);
        if (!quickRule.allowed) {
            recordDiagnosticEvent(
                'RULE',
                `Skipped pre-play activity event on episode ${ratingKey} (${episode.title || 'Unknown'}): ${quickRule.reason}`,
                { episodeRatingKey: ratingKey, userId },
                this.machineIdentifier
            );
            return;
        }

        const diff = diffAndRecordEpisodeStreams({
            machineIdentifier: this.machineIdentifier,
            plexUserId: userId,
            episode,
            source: 'activity',
        });

        if (!diff.changed) {
            cancelPendingDebounceForEpisode(this.machineIdentifier, userId, ratingKey);
            return;
        }

        recordDiagnosticEvent(
            'DAEMON',
            `Scheduled debounced pre-play sync (${debounceSeconds}s) for episode ${ratingKey}`,
            {
                episodeRatingKey: ratingKey,
                audioChanged: diff.audioChanged,
                subtitleChanged: diff.subtitleChanged,
            },
            this.machineIdentifier
        );

        scheduleDebouncedTrackChange({
            machineIdentifier: this.machineIdentifier,
            serverUrl,
            plexUserId: userId,
            username,
            userToken,
            episodeRatingKey: ratingKey,
            showRatingKey: episode.grandparentRatingKey,
            triggerType: 'PREPLAY_CHANGE',
            audioChanged: diff.audioChanged,
            subtitleChanged: diff.subtitleChanged,
            audioStreamId: diff.audioStreamId,
            subtitleStreamId: diff.subtitleStreamId,
            debounceSeconds,
        });
    }
}
