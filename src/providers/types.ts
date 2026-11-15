import type {
    PlexHomeUser,
    PlexLibrary,
    PlexMetadata,
    PlexResource,
    PlexStream,
    PlexUser,
} from '../shared/types/plex';
import type {
    DetailedProgressState,
    EpisodeResult,
    TargetUsersSelection,
} from '../shared/types/batchTypes';

export type PastaExecutionMode = 'client' | 'server';
export type PastaUserRole = 'owner' | 'admin' | 'user' | null;

export interface PastaCapabilities {
    supportsServerAdmin: boolean;
    supportsMultiUserBatch: boolean;
    supportsPersistentBackgroundBatch: boolean;
    supportsBatchHistory: boolean;
}

export interface ServerConnectionResult {
    success: boolean;
    uri?: string;
    machineId?: string;
    errorMessage?: string;
}

export interface MediaRequestContext {
    serverUrl: string | null;
    machineIdentifier: string | null;
    clientIdentifier: string;
    token: string | null;
}

export interface SingleEpisodeUpdateOptions {
    ctx: MediaRequestContext;
    episode: PlexMetadata;
    targetStream: PlexStream | null;
    type: 'audio' | 'subtitle';
    keyword?: string;
    exactMatch?: boolean;
    targetUsers?: TargetUsersSelection;
}

export interface BatchUpdateRequest {
    ctx: MediaRequestContext;
    scope: 'season' | 'show' | 'collection' | 'library';
    targetItem: PlexMetadata | PlexLibrary;
    targetStream: PlexStream | null;
    type: 'audio' | 'subtitle';
    keyword?: string;
    targetUsers?: TargetUsersSelection;
    onProgress: (state: DetailedProgressState) => void;
    fetchMetadataCached?: (ratingKey: string) => Promise<PlexMetadata | undefined>;
    fetchChildrenCached?: (ratingKey: string) => Promise<PlexMetadata[]>;
    onInvalidateItem?: (ratingKey: string) => void;
    signal?: AbortSignal;
}

export interface IPastaProvider {
    readonly mode: PastaExecutionMode;
    readonly capabilities: PastaCapabilities;

    auth: {
        createPin: (clientIdentifier: string) => Promise<{ id: number; code: string }>;
        checkPin: (pinId: number, clientIdentifier: string, code: string) => Promise<{ authToken: string | null }>;
        validateUser: (clientIdentifier: string, token: string) => Promise<PlexUser>;
        checkIdentity: (
            serverUrl: string,
            clientIdentifier: string,
            token: string,
            signal?: AbortSignal,
            timeoutMs?: number
        ) => Promise<{ machineIdentifier?: string; friendlyName?: string }>;
        getSwitchableUsers: (
            clientIdentifier: string,
            token: string,
            machineIdentifier?: string | null
        ) => Promise<PlexHomeUser[]>;
        verifyHomeUserPin: (
            uuid: string,
            clientIdentifier: string,
            token: string,
            pin: string
        ) => Promise<string>;
        resolveManagedUserToken: (
            machineIdentifier: string,
            targetUserId: number,
            clientIdentifier: string,
            adminToken: string
        ) => Promise<string>;
    };

    servers: {
        getResources: (clientIdentifier: string, token: string) => Promise<PlexResource[]>;
        connectToServer: (
            server: PlexResource,
            options: {
                useLocalAddress: boolean;
                clientIdentifier: string;
                timeoutMs: number;
                signal?: AbortSignal;
                onRegisterAbortControllers?: (controllers: AbortController[]) => void;
            }
        ) => Promise<ServerConnectionResult>;
    };

    media: {
        getLibraries: (ctx: MediaRequestContext, timeoutMs?: number) => Promise<PlexLibrary[]>;
        getLibraryItems: (
            ctx: MediaRequestContext,
            libraryKey: string,
            extraParams?: Record<string, string | number>
        ) => Promise<PlexMetadata[]>;
        getLibraryCollections: (ctx: MediaRequestContext, libraryKey: string) => Promise<PlexMetadata[]>;
        getCollectionChildren: (ctx: MediaRequestContext, collectionRatingKey: string) => Promise<PlexMetadata[]>;
        getMetadataChildren: (ctx: MediaRequestContext, ratingKey: string) => Promise<PlexMetadata[]>;
        getMetadata: (ctx: MediaRequestContext, ratingKey: string) => Promise<PlexMetadata | undefined>;
        updateStream: (
            ctx: MediaRequestContext,
            partId: number,
            streamId: number,
            streamType: 'audio' | 'subtitle',
            episodeRatingKey?: string
        ) => Promise<void>;
    };

    batch: {
        updateSingleEpisode: (options: SingleEpisodeUpdateOptions) => Promise<EpisodeResult>;
        executeBatch: (request: BatchUpdateRequest) => Promise<void>;
    };
}
