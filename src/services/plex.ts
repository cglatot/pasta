import axios from 'axios';
import type { PlexMediaContainer, PlexResource, PlexUser, PlexLibrary, PlexMetadata, PlexHomeUser } from '../types/plex';

const PLEX_TV_URL = 'https://plex.tv/api/v2';

export const PLEX_HEADERS = {
    'X-Plex-Product': 'PASTA',
    'X-Plex-Version': '2.0.0',
    'X-Plex-Platform': 'Web',
    'X-Plex-Device': 'Web',
    'X-Plex-Device-Name': 'PASTA (Web)',
    'Accept': 'application/json',
};

const DEFAULT_TIMEOUT = 20000; // 20 seconds

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

export const getPin = async (clientIdentifier: string) => {
    const response = await axios.post(
        `${PLEX_TV_URL}/pins`,
        {},
        {
            headers: {
                ...getHeaders(clientIdentifier),
                strong: 'true',
            },
            timeout: DEFAULT_TIMEOUT,
        }
    );
    return response.data;
};

export const checkPin = async (pinId: number, clientIdentifier: string, code: string) => {
    const response = await axios.get(`${PLEX_TV_URL}/pins/${pinId}`, {
        headers: {
            ...getHeaders(clientIdentifier),
            code: code,
        },
        timeout: DEFAULT_TIMEOUT,
    });
    return response.data;
};

export const getUser = async (clientIdentifier: string, token: string) => {
    const response = await axios.get(`${PLEX_TV_URL}/user`, {
        headers: getHeaders(clientIdentifier, token),
        timeout: DEFAULT_TIMEOUT,
    });
    return response.data as PlexUser;
};

export const getResources = async (clientIdentifier: string, token: string) => {
    const includeHttps = window.location.protocol === 'https:' ? 1 : 0;
    const response = await axios.get(`${PLEX_TV_URL}/resources`, {
        params: {
            includeHttps,
            includeRelay: 0,
        },
        headers: getHeaders(clientIdentifier, token),
        timeout: DEFAULT_TIMEOUT,
    });
    return response.data as PlexResource[];
};

// Server-specific API calls

export const checkServerIdentity = async (
    serverUrl: string,
    clientIdentifier: string,
    token: string,
    signal?: AbortSignal
) => {
    const response = await axios.get(`${serverUrl}/identity`, {
        headers: getHeaders(clientIdentifier, token),
        timeout: 5000, // Keep 5 second timeout for identity check as it needs to be fast
        signal, // Allow request cancellation
    });
    return response.data;
};

export const getLibraries = async (serverUrl: string, clientIdentifier: string, token: string) => {
    const response = await axios.get<PlexMediaContainer<PlexLibrary>>(`${serverUrl}/library/sections`, {
        headers: getHeaders(clientIdentifier, token),
        timeout: DEFAULT_TIMEOUT,
    });
    return response.data.MediaContainer.Directory || [];
};

export const getLibraryItems = async (
    serverUrl: string,
    libraryId: string,
    clientIdentifier: string,
    token: string,
    params?: Record<string, string | number>
) => {
    const response = await axios.get<PlexMediaContainer<PlexMetadata>>(`${serverUrl}/library/sections/${libraryId}/all`, {
        params,
        headers: getHeaders(clientIdentifier, token),
        timeout: DEFAULT_TIMEOUT,
    });
    return response.data.MediaContainer.Metadata || [];
};

export const getMetadataChildren = async (
    serverUrl: string,
    ratingKey: string,
    clientIdentifier: string,
    token: string
) => {
    const response = await axios.get<PlexMediaContainer<PlexMetadata>>(`${serverUrl}/library/metadata/${ratingKey}/children`, {
        headers: getHeaders(clientIdentifier, token),
        timeout: DEFAULT_TIMEOUT,
    });
    return response.data.MediaContainer.Metadata || [];
};

export const getMetadata = async (
    serverUrl: string,
    ratingKey: string,
    clientIdentifier: string,
    token: string
) => {
    const response = await axios.get<PlexMediaContainer<PlexMetadata>>(`${serverUrl}/library/metadata/${ratingKey}`, {
        headers: getHeaders(clientIdentifier, token),
        timeout: DEFAULT_TIMEOUT,
    });
    return response.data.MediaContainer.Metadata?.[0];
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
    const response = await axios.post(
        `${serverUrl}/library/parts/${partId}?${param}=${streamId}&allParts=1`,
        {},
        {
            headers: getHeaders(clientIdentifier, token),
            timeout: DEFAULT_TIMEOUT,
        }
    );
    return response.data;
};

export const getHomeUsers = async (clientIdentifier: string, token: string) => {
    const response = await axios.get(`${PLEX_TV_URL}/home/users`, {
        headers: getHeaders(clientIdentifier, token),
        timeout: DEFAULT_TIMEOUT,
    });
    return response.data.users as PlexHomeUser[];
};

export const switchUser = async (uuid: string, clientIdentifier: string, token: string, pin?: string) => {
    const response = await axios.post(
        `${PLEX_TV_URL}/home/users/${uuid}/switch`,
        { pin },
        {
            headers: getHeaders(clientIdentifier, token),
            timeout: DEFAULT_TIMEOUT,
        }
    );
    return response.data.authToken as string;
};

export const getSharedServers = async (machineIdentifier: string, clientIdentifier: string, token: string) => {
    // This endpoint returns XML even if we ask for JSON in some cases, or a specific JSON structure.
    // The legacy code uses this to find the user's token.
    const response = await axios.get(`https://plex.tv/api/servers/${machineIdentifier}/shared_servers`, {
        headers: {
            ...getHeaders(clientIdentifier, token),
            'Accept': 'application/json'
        },
        timeout: DEFAULT_TIMEOUT,
    });
    return response.data;
};
