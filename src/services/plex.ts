import type { PlexMediaContainer, PlexResource, PlexUser, PlexLibrary, PlexMetadata, PlexHomeUser } from '../types/plex';

const PLEX_TV_URL = 'https://plex.tv/api/v2';

export const PLEX_HEADERS = {
    'X-Plex-Product': 'PASTA',
    'X-Plex-Version': __APP_VERSION__,
    'X-Plex-Platform': 'Web',
    'X-Plex-Device': 'Web',
    'X-Plex-Device-Name': 'PASTA (Web)',
    'Accept': 'application/json',
};

const DEFAULT_TIMEOUT = 20000; // 20 seconds

/** Error thrown by plexFetch for non-2xx HTTP responses. */
export class PlexHttpError extends Error {
    readonly status: number;
    constructor(status: number, statusText: string, url: string) {
        super(`Request failed with status ${status}${statusText ? ` ${statusText}` : ''}: ${url.split('?')[0]}`);
        this.name = 'PlexHttpError';
        this.status = status;
    }
}

/** True if the error came from a request being cancelled (not from a timeout or network failure). */
export const isAbortError = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

interface PlexFetchOptions {
    method?: 'GET' | 'POST';
    params?: Record<string, string | number | undefined>;
    headers?: Record<string, string>;
    body?: unknown;
    timeout?: number;
    signal?: AbortSignal;
}

/**
 * Minimal fetch wrapper: query params, timeout, external cancellation, HTTP error throwing.
 * Response body is parsed as JSON when possible, otherwise returned as text (e.g. XML).
 */
const plexFetch = async <T = unknown>(url: string, options: PlexFetchOptions = {}): Promise<T> => {
    const { method = 'GET', params, headers, body, timeout = DEFAULT_TIMEOUT, signal } = options;

    let fullUrl: URL;
    try {
        const urlWithProto = /^https?:\/\//i.test(url) ? url : `http://${url}`;
        fullUrl = new URL(urlWithProto);
    } catch {
        throw new Error(`Invalid server URL: "${url}"`);
    }

    if (params) {
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined) fullUrl.searchParams.set(key, String(value));
        });
    }

    // Combine the timeout with the caller's signal (manual combination for older browser support)
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeout);
    const onExternalAbort = () => controller.abort(signal?.reason ?? new DOMException('Request aborted', 'AbortError'));
    if (signal?.aborted) onExternalAbort();
    signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
        const response = await fetch(fullUrl, {
            method,
            headers: body !== undefined ? { ...headers, 'Content-Type': 'application/json' } : headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new PlexHttpError(response.status, response.statusText, fullUrl.toString());
        }

        const text = await response.text();
        try {
            return JSON.parse(text) as T;
        } catch {
            return text as T;
        }
    } catch (e) {
        // fetch rejects with the abort reason; surface it so callers can distinguish timeout vs cancel
        if (controller.signal.aborted && controller.signal.reason instanceof DOMException) {
            throw controller.signal.reason;
        }
        throw e;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onExternalAbort);
    }
};

// Headers for direct Plex Media Server connections (minimal to avoid CORS issues)
export const getPmsHeaders = () => {
    return {
        'Accept': 'application/json',
    };
};

// Params for direct Plex Media Server connections (auth in query params avoids CORS preflight issues)
export const getPmsParams = (clientIdentifier: string, token: string) => {
    return {
        'X-Plex-Client-Identifier': clientIdentifier,
        'X-Plex-Token': token,
    };
};

export const getHeaders = (clientIdentifier: string, token?: string) => {
    const headers: Record<string, string> = {
        ...PLEX_HEADERS,
        'X-Plex-Client-Identifier': clientIdentifier,
    };
    if (token) {
        headers['X-Plex-Token'] = token;
    }
    return headers;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getPin = async (clientIdentifier: string): Promise<any> => {
    return plexFetch(`${PLEX_TV_URL}/pins`, {
        method: 'POST',
        body: {},
        headers: {
            ...getHeaders(clientIdentifier),
            strong: 'true',
        },
    });
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const checkPin = async (pinId: number, clientIdentifier: string, code: string): Promise<any> => {
    return plexFetch(`${PLEX_TV_URL}/pins/${pinId}`, {
        headers: {
            ...getHeaders(clientIdentifier),
            code: code,
        },
    });
};

export const getUser = async (clientIdentifier: string, token: string) => {
    return plexFetch<PlexUser>(`${PLEX_TV_URL}/user`, {
        headers: getHeaders(clientIdentifier, token),
    });
};

export const getResources = async (clientIdentifier: string, token: string) => {
    const includeHttps = window.location.protocol === 'https:' ? 1 : 0;
    return plexFetch<PlexResource[]>(`${PLEX_TV_URL}/resources`, {
        params: {
            includeHttps,
            includeRelay: 0,
        },
        headers: getHeaders(clientIdentifier, token),
    });
};

// Server-specific API calls

export const checkServerIdentity = async (
    serverUrl: string,
    clientIdentifier: string,
    token: string,
    signal?: AbortSignal,
    timeout: number = 5000
) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return plexFetch<any>(`${serverUrl}/identity`, {
        params: getPmsParams(clientIdentifier, token),
        headers: getPmsHeaders(),
        timeout,
        signal, // Allow request cancellation
    });
};

export const getLibraries = async (serverUrl: string, clientIdentifier: string, token: string, timeout?: number) => {
    const data = await plexFetch<PlexMediaContainer<PlexLibrary>>(`${serverUrl}/library/sections`, {
        params: getPmsParams(clientIdentifier, token),
        headers: getPmsHeaders(),
        timeout,
    });
    return data.MediaContainer.Directory || [];
};

export const getLibraryItems = async (
    serverUrl: string,
    libraryId: string,
    clientIdentifier: string,
    token: string,
    params?: Record<string, string | number>
) => {
    const data = await plexFetch<PlexMediaContainer<PlexMetadata>>(`${serverUrl}/library/sections/${libraryId}/all`, {
        params: {
            ...params,
            ...getPmsParams(clientIdentifier, token),
        },
        headers: getPmsHeaders(),
    });
    return data.MediaContainer.Metadata || [];
};

export const getMetadataChildren = async (
    serverUrl: string,
    ratingKey: string,
    clientIdentifier: string,
    token: string
) => {
    const data = await plexFetch<PlexMediaContainer<PlexMetadata>>(`${serverUrl}/library/metadata/${ratingKey}/children`, {
        params: getPmsParams(clientIdentifier, token),
        headers: getPmsHeaders(),
    });
    return data.MediaContainer.Metadata || [];
};

export const getMetadata = async (
    serverUrl: string,
    ratingKey: string,
    clientIdentifier: string,
    token: string
) => {
    const data = await plexFetch<PlexMediaContainer<PlexMetadata>>(`${serverUrl}/library/metadata/${ratingKey}`, {
        params: getPmsParams(clientIdentifier, token),
        headers: getPmsHeaders(),
    });
    return data.MediaContainer.Metadata?.[0];
};

export const updateStream = async (
    serverUrl: string,
    partId: number,
    streamId: number, // 0 for none (subtitle)
    streamType: 'audio' | 'subtitle',
    clientIdentifier: string,
    token: string
) => {
    const param = streamType === 'audio' ? 'audioStreamID' : 'subtitleStreamID';
    return plexFetch(`${serverUrl}/library/parts/${partId}`, {
        method: 'POST',
        params: {
            [param]: streamId,
            allParts: 1,
            ...getPmsParams(clientIdentifier, token),
        },
        headers: getPmsHeaders(),
    });
};

export const getHomeUsers = async (clientIdentifier: string, token: string) => {
    const data = await plexFetch<{ users: PlexHomeUser[] }>(`${PLEX_TV_URL}/home/users`, {
        headers: getHeaders(clientIdentifier, token),
    });
    return data.users;
};

export const switchUser = async (uuid: string, clientIdentifier: string, token: string, pin?: string) => {
    const data = await plexFetch<{ authToken: string }>(`${PLEX_TV_URL}/home/users/${uuid}/switch`, {
        method: 'POST',
        params: { pin },
        headers: getHeaders(clientIdentifier, token),
    });
    return data.authToken;
};

export const getSharedServers = async (machineIdentifier: string, clientIdentifier: string, token: string) => {
    // This endpoint returns XML even if we ask for JSON in some cases, or a specific JSON structure.
    // The legacy code uses this to find the user's token.
    return plexFetch<unknown>(`https://plex.tv/api/servers/${machineIdentifier}/shared_servers`, {
        headers: {
            ...getHeaders(clientIdentifier, token),
            'Accept': 'application/json',
        },
    });
};
