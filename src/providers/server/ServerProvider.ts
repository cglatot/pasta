import type {
    PlexHomeUser,
    PlexLibrary,
    PlexMetadata,
    PlexResource,
    PlexUser,
} from '../../shared/types/plex';
import type { EpisodeResult } from '../../shared/types/batchTypes';
import type { IPastaProvider, PastaUserRole } from '../types';

export interface ServerSessionState {
    authenticated: boolean;
    user: PlexUser | null;
    machineIdentifier: string | null;
    serverName: string | null;
    isSharedServer: boolean;
    isManagedUser: boolean;
    requiresAdminPin?: boolean;
    pastaRole: PastaUserRole;
    isInstanceOwner: boolean;
    managedServers: Array<{
        machineIdentifier: string;
        serverName: string;
        role: 'owner' | 'admin';
        authStatus: string;
    }>;
}

export const apiFetch = async <T = unknown>(
    path: string,
    options: {
        method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
        params?: Record<string, string | number | undefined>;
        body?: unknown;
        signal?: AbortSignal;
    } = {}
): Promise<T> => {
    const { method = 'GET', params, body, signal } = options;
    const url = new URL(path, window.location.origin);

    if (params) {
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined) {
                url.searchParams.set(k, String(v));
            }
        }
    }

    const res = await fetch(url.toString(), {
        method,
        credentials: 'same-origin',
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const errMsg =
            (data && typeof data === 'object' && 'error' in data && String(data.error)) ||
            `Server API error (${res.status})`;
        throw new Error(errMsg);
    }

    return data as T;
};

export const fetchServerSession = async (): Promise<ServerSessionState> => {
    return apiFetch<ServerSessionState>('/api/auth/session');
};

export const loginManualServerMode = async (
    url: string,
    token: string,
    clientIdentifier: string
): Promise<ServerSessionState> => {
    const res = await apiFetch<{ loggedIn: boolean; session: ServerSessionState }>(
        '/api/auth/manual',
        {
            method: 'POST',
            body: { url, token, clientIdentifier },
        }
    );
    return res.session;
};

export const switchUserServerMode = async (
    targetUser: PlexHomeUser,
    pin: string | undefined,
    machineIdentifier: string | null | undefined,
    clientIdentifier: string
): Promise<ServerSessionState> => {
    const res = await apiFetch<{ ok: boolean; session: ServerSessionState }>(
        '/api/auth/switch-user',
        {
            method: 'POST',
            body: {
                targetUser,
                pin,
                machineIdentifier: machineIdentifier || undefined,
                clientIdentifier,
            },
        }
    );
    return res.session;
};

export const verifyAdminPinServerMode = async (
    pin: string,
    clientIdentifier: string
): Promise<ServerSessionState> => {
    const res = await apiFetch<{ ok: boolean; session: ServerSessionState }>(
        '/api/auth/verify-admin-pin',
        {
            method: 'POST',
            body: { pin, clientIdentifier },
        }
    );
    return res.session;
};

export const disconnectServerMode = async (): Promise<void> => {
    await apiFetch('/api/servers/disconnect', { method: 'POST' });
};

export const logoutServerMode = async (): Promise<void> => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
};

export const serverModeProvider: IPastaProvider = {
    mode: 'server',
    capabilities: {
        supportsServerAdmin: true,
        supportsMultiUserBatch: true,
        supportsPersistentBackgroundBatch: true,
        supportsBatchHistory: true,
    },

    auth: {
        createPin: async (clientIdentifier: string) => {
            return apiFetch<{ id: number; code: string }>('/api/auth/pin', {
                method: 'POST',
                body: { clientIdentifier },
            });
        },
        checkPin: async (pinId: number, clientIdentifier: string, code: string) => {
            return apiFetch<{ authToken: string | null }>(`/api/auth/pin/${pinId}`, {
                params: { code, clientIdentifier },
            });
        },
        validateUser: async () => {
            const session = await fetchServerSession();
            if (!session.authenticated || !session.user) {
                throw new Error('Session not authenticated');
            }
            return session.user;
        },
        checkIdentity: async () => {
            const session = await fetchServerSession();
            return {
                machineIdentifier: session.machineIdentifier || undefined,
                friendlyName: session.serverName || undefined,
            };
        },
        getSwitchableUsers: async (clientIdentifier: string, _token: string, machineIdentifier?: string | null) => {
            return apiFetch<PlexHomeUser[]>('/api/auth/users', {
                params: {
                    clientIdentifier,
                    machineIdentifier: machineIdentifier || undefined,
                },
            });
        },
        verifyHomeUserPin: async () => {
            return 'SERVER_MANAGED';
        },
        resolveManagedUserToken: async () => {
            return 'SERVER_MANAGED';
        },
    },

    servers: {
        getResources: async (clientIdentifier: string) => {
            return apiFetch<PlexResource[]>('/api/servers', {
                params: { clientIdentifier },
            });
        },
        connectToServer: async (server, options) => {
            const { useLocalAddress, clientIdentifier, timeoutMs, signal } = options;
            const res = await apiFetch<{
                success: boolean;
                machineId?: string;
                serverName?: string;
                errorMessage?: string;
            }>('/api/servers/connect', {
                method: 'POST',
                body: {
                    machineIdentifier: server.clientIdentifier,
                    useLocalAddress,
                    clientIdentifier,
                    timeoutMs,
                },
                signal,
            });

            if (res.success && res.machineId) {
                return {
                    success: true,
                    uri: `server://${res.machineId}`,
                    machineId: res.machineId,
                };
            }

            return {
                success: false,
                errorMessage: res.errorMessage || 'Could not connect to server.',
            };
        },
    },

    media: {
        getLibraries: async (ctx, timeoutMs) => {
            if (!ctx.machineIdentifier) return [];
            return apiFetch<PlexLibrary[]>(
                `/api/media/${encodeURIComponent(ctx.machineIdentifier)}/libraries`,
                {
                    params: {
                        clientIdentifier: ctx.clientIdentifier,
                        timeoutMs,
                    },
                }
            );
        },
        getLibraryItems: async (ctx, libraryKey, extraParams) => {
            if (!ctx.machineIdentifier) return [];
            return apiFetch<PlexMetadata[]>(
                `/api/media/${encodeURIComponent(ctx.machineIdentifier)}/libraries/${encodeURIComponent(libraryKey)}/items`,
                {
                    params: {
                        ...extraParams,
                        clientIdentifier: ctx.clientIdentifier,
                    },
                }
            );
        },
        getLibraryCollections: async (ctx, libraryKey) => {
            if (!ctx.machineIdentifier) return [];
            return apiFetch<PlexMetadata[]>(
                `/api/media/${encodeURIComponent(ctx.machineIdentifier)}/libraries/${encodeURIComponent(libraryKey)}/collections`,
                {
                    params: {
                        clientIdentifier: ctx.clientIdentifier,
                    },
                }
            );
        },
        getCollectionChildren: async (ctx, collectionRatingKey) => {
            if (!ctx.machineIdentifier) return [];
            return apiFetch<PlexMetadata[]>(
                `/api/media/${encodeURIComponent(ctx.machineIdentifier)}/collections/${encodeURIComponent(collectionRatingKey)}/children`,
                {
                    params: {
                        clientIdentifier: ctx.clientIdentifier,
                    },
                }
            );
        },
        getMetadataChildren: async (ctx, ratingKey) => {
            if (!ctx.machineIdentifier) return [];
            return apiFetch<PlexMetadata[]>(
                `/api/media/${encodeURIComponent(ctx.machineIdentifier)}/metadata/${encodeURIComponent(ratingKey)}/children`,
                {
                    params: {
                        clientIdentifier: ctx.clientIdentifier,
                    },
                }
            );
        },
        getMetadata: async (ctx, ratingKey) => {
            if (!ctx.machineIdentifier) return undefined;
            const res = await apiFetch<PlexMetadata | null>(
                `/api/media/${encodeURIComponent(ctx.machineIdentifier)}/metadata/${encodeURIComponent(ratingKey)}`,
                {
                    params: {
                        clientIdentifier: ctx.clientIdentifier,
                    },
                }
            );
            return res || undefined;
        },
        updateStream: async (ctx, partId, streamId, streamType, episodeRatingKey) => {
            if (!ctx.machineIdentifier) return;
            await apiFetch('/api/batch/single', {
                method: 'POST',
                body: {
                    machineIdentifier: ctx.machineIdentifier,
                    episodeRatingKey,
                    partId,
                    streamId,
                    streamType,
                    clientIdentifier: ctx.clientIdentifier,
                },
            });
        },
    },

    batch: {
        updateSingleEpisode: async (options) => {
            return apiFetch<EpisodeResult>('/api/batch/single-episode', {
                method: 'POST',
                body: {
                    machineIdentifier: options.ctx.machineIdentifier,
                    clientIdentifier: options.ctx.clientIdentifier,
                    episode: options.episode,
                    targetStream: options.targetStream,
                    type: options.type,
                    keyword: options.keyword,
                    exactMatch: options.exactMatch,
                    targetUsers: options.targetUsers,
                },
            });
        },
        executeBatch: async (request) => {
            const res = await apiFetch<{
                jobId: string;
                targetTitle: string;
                progress: import('../../shared/types/batchTypes').DetailedProgressState;
            }>('/api/batch', {
                method: 'POST',
                body: {
                    machineIdentifier: request.ctx.machineIdentifier,
                    clientIdentifier: request.ctx.clientIdentifier,
                    scope: request.scope,
                    targetItem: request.targetItem,
                    targetStream: request.targetStream,
                    type: request.type,
                    keyword: request.keyword,
                    targetUsers: request.targetUsers,
                },
                signal: request.signal,
            });
            if (res.progress) {
                request.onProgress(res.progress);
            }
        },
    },
};
