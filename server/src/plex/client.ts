import http from 'node:http';
import https from 'node:https';
import type {
    PlexHomeUser,
    PlexLibrary,
    PlexMediaContainer,
    PlexMetadata,
    PlexResource,
    PlexUser,
} from '../../../src/shared/types/plex.ts';

const PLEX_TV_URL = 'https://plex.tv/api/v2';
const DEFAULT_TIMEOUT = 20000;

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 64 });
const strictHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64, rejectUnauthorized: true });
const pmsHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64, rejectUnauthorized: false });

export class ServerPlexHttpError extends Error {
    readonly status: number;
    readonly url: string;
    constructor(status: number, statusText: string, url: string) {
        super(`Plex HTTP ${status}${statusText ? ` ${statusText}` : ''}: ${url.split('?')[0]}`);
        this.name = 'ServerPlexHttpError';
        this.status = status;
        this.url = url;
    }
}

export interface ServerPlexFetchOptions {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    params?: Record<string, string | number | undefined>;
    headers?: Record<string, string>;
    body?: unknown;
    timeout?: number;
    signal?: AbortSignal;
    redirectCount?: number;
}

export const getPlexTvHeaders = (clientIdentifier: string, token?: string): Record<string, string> => {
    const headers: Record<string, string> = {
        'X-Plex-Product': 'PASTA Server',
        'X-Plex-Version': '3.0.0',
        'X-Plex-Platform': 'Node.js',
        'X-Plex-Device': 'PASTA Server',
        'X-Plex-Device-Name': 'PASTA Server',
        'X-Plex-Client-Identifier': clientIdentifier,
        Accept: 'application/json',
    };
    if (token) {
        headers['X-Plex-Token'] = token;
    }
    return headers;
};

export const getPmsParams = (clientIdentifier: string, token: string): Record<string, string> => ({
    'X-Plex-Client-Identifier': clientIdentifier,
    'X-Plex-Token': token,
});

export type PlexFetchInterceptor = (
    parsedUrl: URL,
    options: ServerPlexFetchOptions
) => Promise<unknown> | unknown;

let testFetchInterceptor: PlexFetchInterceptor | null = null;

export const setServerPlexFetchInterceptorForTests = (
    fn: PlexFetchInterceptor | null
): void => {
    testFetchInterceptor = fn;
};

/**
 * Low-level HTTP/HTTPS request helper for both plex.tv (strict TLS) and local/remote
 * Plex Media Servers (tolerant of self-signed LAN certificates).
 */
export const serverPlexFetch = async <T = unknown>(
    url: string,
    options: ServerPlexFetchOptions = {}
): Promise<T> => {
    const {
        method = 'GET',
        params,
        headers = {},
        body,
        timeout = DEFAULT_TIMEOUT,
        signal,
        redirectCount = 0,
    } = options;

    let parsedUrl: URL;
    try {
        const urlWithProto = /^https?:\/\//i.test(url) ? url : `http://${url}`;
        parsedUrl = new URL(urlWithProto);
    } catch {
        throw new Error(`Invalid Plex URL: "${url}"`);
    }

    if (params) {
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined) {
                parsedUrl.searchParams.set(key, String(value));
            }
        }
    }

    if (testFetchInterceptor) {
        return (await testFetchInterceptor(parsedUrl, options)) as T;
    }

    const isHttps = parsedUrl.protocol === 'https:';
    const isPlexTv = parsedUrl.hostname === 'plex.tv' || parsedUrl.hostname.endsWith('.plex.tv');
    const agent = isHttps ? (isPlexTv ? strictHttpsAgent : pmsHttpsAgent) : httpAgent;
    const transport = isHttps ? https : http;

    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const reqHeaders: Record<string, string> = {
        Accept: 'application/json',
        ...headers,
    };
    if (payload !== undefined) {
        reqHeaders['Content-Type'] = 'application/json';
        reqHeaders['Content-Length'] = String(Buffer.byteLength(payload));
    }

    return new Promise<T>((resolvePromise, rejectPromise) => {
        if (signal?.aborted) {
            rejectPromise(new Error('Request aborted'));
            return;
        }

        const req = transport.request(
            parsedUrl,
            {
                method,
                headers: reqHeaders,
                agent,
                timeout,
            },
            res => {
                const statusCode = res.statusCode || 0;

                // Follow up to 3 redirects (e.g. HTTP -> HTTPS *.plex.direct redirect)
                if (
                    (statusCode === 301 || statusCode === 302 || statusCode === 307 || statusCode === 308) &&
                    res.headers.location &&
                    redirectCount < 3
                ) {
                    res.resume();
                    const redirectUrl = new URL(res.headers.location, parsedUrl).toString();
                    serverPlexFetch<T>(redirectUrl, {
                        ...options,
                        params: undefined,
                        redirectCount: redirectCount + 1,
                    }).then(resolvePromise, rejectPromise);
                    return;
                }

                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    if (statusCode < 200 || statusCode >= 300) {
                        rejectPromise(
                            new ServerPlexHttpError(statusCode, res.statusMessage || '', parsedUrl.toString())
                        );
                        return;
                    }
                    try {
                        resolvePromise(JSON.parse(text) as T);
                    } catch {
                        resolvePromise(text as unknown as T);
                    }
                });
            }
        );

        const onAbort = () => {
            req.destroy(new Error('Request aborted'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        req.on('timeout', () => {
            req.destroy(new Error(`Request timed out after ${timeout}ms`));
        });

        req.on('error', err => {
            signal?.removeEventListener('abort', onAbort);
            rejectPromise(err);
        });

        req.on('close', () => {
            signal?.removeEventListener('abort', onAbort);
        });

        if (payload !== undefined) {
            req.write(payload);
        }
        req.end();
    });
};

// ============================================================================
// plex.tv Cloud API Methods
// ============================================================================

export const createPlexPin = async (
    clientIdentifier: string
): Promise<{ id: number; code: string }> => {
    const data = await serverPlexFetch<{ id: number; code: string }>(`${PLEX_TV_URL}/pins`, {
        method: 'POST',
        params: {
            strong: 'true',
        },
        body: {},
        headers: {
            ...getPlexTvHeaders(clientIdentifier),
            strong: 'true',
        },
    });
    return { id: data.id, code: data.code };
};

export const checkPlexPin = async (
    pinId: number,
    clientIdentifier: string,
    code: string
): Promise<{ authToken: string | null }> => {
    const data = await serverPlexFetch<{ authToken?: string | null }>(`${PLEX_TV_URL}/pins/${pinId}`, {
        params: {
            code,
        },
        headers: {
            ...getPlexTvHeaders(clientIdentifier),
            code,
        },
    });
    return { authToken: data.authToken || null };
};

export const getPlexAccountUser = async (
    clientIdentifier: string,
    token: string
): Promise<PlexUser> => {
    return serverPlexFetch<PlexUser>(`${PLEX_TV_URL}/user`, {
        headers: getPlexTvHeaders(clientIdentifier, token),
    });
};

export const getPlexResources = async (
    clientIdentifier: string,
    token: string
): Promise<PlexResource[]> => {
    return serverPlexFetch<PlexResource[]>(`${PLEX_TV_URL}/resources`, {
        params: {
            includeHttps: 1,
            includeRelay: 0,
        },
        headers: getPlexTvHeaders(clientIdentifier, token),
    });
};

export const getPlexHomeUsers = async (
    clientIdentifier: string,
    token: string
): Promise<PlexHomeUser[]> => {
    const data = await serverPlexFetch<{ users: PlexHomeUser[] }>(`${PLEX_TV_URL}/home/users`, {
        headers: getPlexTvHeaders(clientIdentifier, token),
    });
    return data.users || [];
};

export const switchPlexHomeUser = async (
    uuid: string,
    clientIdentifier: string,
    token: string,
    pin?: string
): Promise<string> => {
    const data = await serverPlexFetch<{ authToken: string }>(
        `${PLEX_TV_URL}/home/users/${uuid}/switch`,
        {
            method: 'POST',
            params: { pin },
            headers: getPlexTvHeaders(clientIdentifier, token),
        }
    );
    return data.authToken;
};

export const getPlexSharedServersXml = async (
    machineIdentifier: string,
    clientIdentifier: string,
    ownerToken: string
): Promise<string> => {
    const res = await serverPlexFetch<string>(
        `https://plex.tv/api/servers/${machineIdentifier}/shared_servers`,
        {
            headers: {
                ...getPlexTvHeaders(clientIdentifier, ownerToken),
                Accept: 'application/xml, text/xml, */*',
            },
        }
    );
    return typeof res === 'string' ? res : JSON.stringify(res);
};

// ============================================================================
// Plex Media Server (PMS) Methods
// ============================================================================

export const probeServerIdentity = async (
    serverUrl: string,
    clientIdentifier: string,
    token: string,
    timeoutMs: number = 5000,
    signal?: AbortSignal
): Promise<{ machineIdentifier?: string; friendlyName?: string }> => {
    const cleanUrl = serverUrl.trim().replace(/\/+$/, '');
    const data = await serverPlexFetch<PlexMediaContainer<never>>(`${cleanUrl}/identity`, {
        params: getPmsParams(clientIdentifier, token),
        timeout: timeoutMs,
        signal,
    });
    return {
        machineIdentifier: data?.MediaContainer?.machineIdentifier,
        friendlyName:
            data?.MediaContainer?.friendlyName || data?.MediaContainer?.myPlexServerName,
    };
};

export const raceServerConnections = async (
    server: PlexResource,
    options: {
        preferLocal: boolean;
        customUrlOverride?: string | null;
        clientIdentifier: string;
        token: string;
        timeoutMs?: number;
    }
): Promise<{
    success: boolean;
    uri?: string;
    machineId?: string;
    friendlyName?: string;
    errorMessage?: string;
}> => {
    const {
        preferLocal,
        customUrlOverride,
        clientIdentifier,
        token,
        timeoutMs = 5000,
    } = options;

    // 1. If a custom URL override is configured for this server, try it first
    if (customUrlOverride && customUrlOverride.trim() !== '') {
        const cleanOverride = customUrlOverride.trim().replace(/\/+$/, '');
        try {
            const identity = await probeServerIdentity(
                cleanOverride,
                clientIdentifier,
                token,
                timeoutMs
            );
            return {
                success: true,
                uri: cleanOverride,
                machineId: identity.machineIdentifier || server.clientIdentifier,
                friendlyName: identity.friendlyName || server.name,
            };
        } catch (err) {
            console.warn(
                `Custom URL override ${cleanOverride} failed for ${server.name}, falling back to Plex connections:`,
                err
            );
        }
    }

    // 2. Build candidate connections: heavily prefer direct LAN IP (`http://<address>:<port>`) over `*.plex.direct` when local
    const rawConnections = [...(server.connections || [])];
    if (rawConnections.length === 0) {
        return {
            success: false,
            errorMessage: 'No connection endpoints advertised by this Plex Media Server.',
        };
    }

    interface CandidateEndpoint {
        uri: string;
        local: boolean;
        isDirectLanHttp: boolean;
    }

    const seenUris = new Set<string>();
    const candidates: CandidateEndpoint[] = [];
    const addCandidate = (uri: string, local: boolean, isDirectLanHttp: boolean) => {
        const clean = uri.trim().replace(/\/+$/, '');
        if (!clean || seenUris.has(clean)) return;
        seenUris.add(clean);
        candidates.push({ uri: clean, local, isDirectLanHttp });
    };

    for (const conn of rawConnections) {
        if (conn.local && conn.address && conn.port) {
            addCandidate(`http://${conn.address}:${conn.port}`, true, true);
        }
        addCandidate(conn.uri, Boolean(conn.local), false);
    }

    candidates.sort((a, b) => {
        if (preferLocal) {
            if (a.local !== b.local) return a.local ? -1 : 1;
            if (a.isDirectLanHttp !== b.isDirectLanHttp) return a.isDirectLanHttp ? -1 : 1;
            return 0;
        }
        if (a.local !== b.local) return !a.local ? -1 : 1;
        return 0;
    });

    const hasDirectLanCandidates =
        preferLocal && candidates.some(c => c.local && c.isDirectLanHttp);
    const controllers = candidates.map(() => new AbortController());

    const attempts = candidates.map(async (conn, idx) => {
        const cleanUri = conn.uri;
        const signal = controllers[idx].signal;

        // Give direct LAN HTTP endpoints (`http://192.168.1.50:32400`) a 250ms head-start in parallel
        // so raw LAN IPs always win on the local network (~10ms) without sequential 2.5s timeouts
        // on unreachable Docker/virtual adapters.
        if (hasDirectLanCandidates && !(conn.local && conn.isDirectLanHttp)) {
            await new Promise<void>(resolve => {
                const timer = setTimeout(resolve, 250);
                signal.addEventListener(
                    'abort',
                    () => {
                        clearTimeout(timer);
                        resolve();
                    },
                    { once: true }
                );
            });
            if (signal.aborted) {
                throw new Error('Aborted before start');
            }
        }

        const identity = await probeServerIdentity(
            cleanUri,
            clientIdentifier,
            token,
            timeoutMs,
            signal
        );
        controllers.forEach((c, i) => {
            if (i !== idx) c.abort();
        });
        return {
            success: true as const,
            uri: cleanUri,
            machineId: identity.machineIdentifier || server.clientIdentifier,
            friendlyName: identity.friendlyName || server.name,
        };
    });

    try {
        const winner = await Promise.any(attempts);
        return winner;
    } catch {
        // All candidate connections failed
    }

    return {
        success: false,
        errorMessage:
            'Server backend could not reach this Plex Media Server. If PASTA Server is running in Docker, you can set a Custom Plex URL in Admin Settings.',
    };
};

export const getPmsLibraries = async (
    serverUrl: string,
    clientIdentifier: string,
    token: string,
    timeoutMs?: number
): Promise<PlexLibrary[]> => {
    const data = await serverPlexFetch<PlexMediaContainer<PlexLibrary>>(
        `${serverUrl}/library/sections`,
        {
            params: getPmsParams(clientIdentifier, token),
            timeout: timeoutMs,
        }
    );
    return data.MediaContainer?.Directory || [];
};

/**
 * Fetches all items in a library section using paginated requests (X-Plex-Container-Size=1000)
 * so large 10,000+ item libraries never time out or drop items.
 */
export const getPmsLibraryItemsPaginated = async (
    serverUrl: string,
    libraryKey: string,
    clientIdentifier: string,
    token: string,
    extraParams?: Record<string, string | number>,
    pageSize: number = 1000
): Promise<PlexMetadata[]> => {
    const allItems: PlexMetadata[] = [];
    let start = 0;

    while (true) {
        const data = await serverPlexFetch<PlexMediaContainer<PlexMetadata>>(
            `${serverUrl}/library/sections/${libraryKey}/all`,
            {
                params: {
                    ...extraParams,
                    ...getPmsParams(clientIdentifier, token),
                    'X-Plex-Container-Start': start,
                    'X-Plex-Container-Size': pageSize,
                },
                timeout: 30000,
            }
        );

        const page = data.MediaContainer?.Metadata || [];
        if (page.length === 0) break;

        allItems.push(...page);
        start += page.length;

        const totalSize = data.MediaContainer?.totalSize;
        if (totalSize !== undefined && start >= totalSize) {
            break;
        }
        if (page.length < pageSize) {
            break;
        }
    }

    return allItems;
};

export const getPmsLibraryCollections = async (
    serverUrl: string,
    libraryKey: string,
    clientIdentifier: string,
    token: string
): Promise<PlexMetadata[]> => {
    const data = await serverPlexFetch<PlexMediaContainer<PlexMetadata>>(
        `${serverUrl}/library/sections/${libraryKey}/collections`,
        {
            params: getPmsParams(clientIdentifier, token),
        }
    );
    const items = data.MediaContainer?.Metadata || data.MediaContainer?.Directory || [];
    return items.map(item => ({
        ...item,
        type: 'collection' as const,
    }));
};

export const getPmsCollectionChildren = async (
    serverUrl: string,
    collectionRatingKey: string,
    clientIdentifier: string,
    token: string
): Promise<PlexMetadata[]> => {
    const data = await serverPlexFetch<PlexMediaContainer<PlexMetadata>>(
        `${serverUrl}/library/collections/${collectionRatingKey}/children`,
        {
            params: getPmsParams(clientIdentifier, token),
        }
    );
    return data.MediaContainer?.Metadata || data.MediaContainer?.Directory || [];
};

export const getPmsMetadataChildren = async (
    serverUrl: string,
    ratingKey: string,
    clientIdentifier: string,
    token: string
): Promise<PlexMetadata[]> => {
    const data = await serverPlexFetch<PlexMediaContainer<PlexMetadata>>(
        `${serverUrl}/library/metadata/${ratingKey}/children`,
        {
            params: getPmsParams(clientIdentifier, token),
        }
    );
    return data.MediaContainer?.Metadata || [];
};

export const getPmsMetadata = async (
    serverUrl: string,
    ratingKey: string,
    clientIdentifier: string,
    token: string
): Promise<PlexMetadata | undefined> => {
    const data = await serverPlexFetch<PlexMediaContainer<PlexMetadata>>(
        `${serverUrl}/library/metadata/${ratingKey}`,
        {
            params: getPmsParams(clientIdentifier, token),
        }
    );
    return data.MediaContainer?.Metadata?.[0];
};

export const updatePmsStream = async (
    serverUrl: string,
    partId: number,
    streamId: number,
    streamType: 'audio' | 'subtitle',
    clientIdentifier: string,
    token: string
): Promise<void> => {
    const param = streamType === 'audio' ? 'audioStreamID' : 'subtitleStreamID';
    await serverPlexFetch(`${serverUrl}/library/parts/${partId}`, {
        method: 'POST',
        params: {
            [param]: streamId,
            allParts: 1,
            ...getPmsParams(clientIdentifier, token),
        },
    });
};
