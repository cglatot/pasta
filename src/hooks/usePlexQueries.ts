import { useQuery } from '@tanstack/react-query';
import { usePastaProvider } from '../providers/PastaProvider';

// Query Keys
export const plexKeys = {
    all: ['plex'] as const,
    server: (id: string | null) => [...plexKeys.all, 'server', id] as const,
    libraries: (id: string | null) => [...plexKeys.server(id), 'libraries'] as const,
    libraryItems: (id: string | null, libraryId: string) => [...plexKeys.server(id), 'library', libraryId] as const,
    libraryCollections: (id: string | null, libraryId: string) => [...plexKeys.server(id), 'library', libraryId, 'collections'] as const,
    collectionChildren: (id: string | null, collectionRatingKey: string) => [...plexKeys.server(id), 'collection', collectionRatingKey, 'children'] as const,
    // Children and metadata include token because they contain user-specific preferences (subtitles, audio)
    children: (id: string | null, token: string | null, ratingKey: string) => [...plexKeys.server(id), 'user', token, 'children', ratingKey] as const,
    metadata: (id: string | null, token: string | null, ratingKey: string) => [...plexKeys.server(id), 'user', token, 'metadata', ratingKey] as const,
};

export const useLibraries = (
    serverUrl: string | null,
    machineIdentifier: string | null,
    clientIdentifier: string | null,
    token: string | null,
    timeout?: number
) => {
    const provider = usePastaProvider();
    const serverKey = machineIdentifier || serverUrl;
    const isReady = provider.mode === 'server'
        ? Boolean(machineIdentifier && clientIdentifier)
        : Boolean(serverUrl && token && clientIdentifier);

    return useQuery({
        queryKey: plexKeys.libraries(serverKey),
        queryFn: () =>
            provider.media.getLibraries(
                {
                    serverUrl,
                    machineIdentifier,
                    clientIdentifier: clientIdentifier!,
                    token,
                },
                timeout ? timeout * 1000 : undefined
            ),
        enabled: isReady,
        retry: false, // Honor connection timeout strictly without repeated delay
        staleTime: 1000 * 60 * 60, // 1 hour (libraries rarely change)
        refetchOnWindowFocus: false,
    });
};

export const useLibraryItems = (
    serverUrl: string | null,
    machineIdentifier: string | null,
    libraryId: string | undefined | null,
    clientIdentifier: string | null,
    token: string | null,
    enabled: boolean = true
) => {
    const provider = usePastaProvider();
    const serverKey = machineIdentifier || serverUrl;
    const isReady = provider.mode === 'server'
        ? Boolean(machineIdentifier && clientIdentifier && libraryId && enabled)
        : Boolean(serverUrl && token && clientIdentifier && libraryId && enabled);

    return useQuery({
        queryKey: plexKeys.libraryItems(serverKey, libraryId!),
        queryFn: () =>
            provider.media.getLibraryItems(
                {
                    serverUrl,
                    machineIdentifier,
                    clientIdentifier: clientIdentifier!,
                    token,
                },
                libraryId!
            ),
        enabled: isReady,
        staleTime: 1000 * 60 * 5, // 5 minutes
        refetchOnWindowFocus: false,
    });
};

export const useLibraryCollections = (
    serverUrl: string | null,
    machineIdentifier: string | null,
    libraryId: string | undefined | null,
    clientIdentifier: string | null,
    token: string | null,
    enabled: boolean = true
) => {
    const provider = usePastaProvider();
    const serverKey = machineIdentifier || serverUrl;
    const isReady = provider.mode === 'server'
        ? Boolean(machineIdentifier && clientIdentifier && libraryId && enabled)
        : Boolean(serverUrl && token && clientIdentifier && libraryId && enabled);

    return useQuery({
        queryKey: plexKeys.libraryCollections(serverKey, libraryId!),
        queryFn: () =>
            provider.media.getLibraryCollections(
                {
                    serverUrl,
                    machineIdentifier,
                    clientIdentifier: clientIdentifier!,
                    token,
                },
                libraryId!
            ),
        enabled: isReady,
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
    });
};

export const useCollectionChildren = (
    serverUrl: string | null,
    machineIdentifier: string | null,
    collectionRatingKey: string | undefined | null,
    clientIdentifier: string | null,
    token: string | null
) => {
    const provider = usePastaProvider();
    const serverKey = machineIdentifier || serverUrl;
    const isReady = provider.mode === 'server'
        ? Boolean(machineIdentifier && clientIdentifier && collectionRatingKey)
        : Boolean(serverUrl && token && clientIdentifier && collectionRatingKey);

    return useQuery({
        queryKey: plexKeys.collectionChildren(serverKey, collectionRatingKey!),
        queryFn: () =>
            provider.media.getCollectionChildren(
                {
                    serverUrl,
                    machineIdentifier,
                    clientIdentifier: clientIdentifier!,
                    token,
                },
                collectionRatingKey!
            ),
        enabled: isReady,
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
    });
};

export const useMetadataChildren = (
    serverUrl: string | null,
    machineIdentifier: string | null,
    ratingKey: string | undefined | null,
    clientIdentifier: string | null,
    token: string | null
) => {
    const provider = usePastaProvider();
    const serverKey = machineIdentifier || serverUrl;
    const isReady = provider.mode === 'server'
        ? Boolean(machineIdentifier && clientIdentifier && ratingKey)
        : Boolean(serverUrl && token && clientIdentifier && ratingKey);

    return useQuery({
        queryKey: plexKeys.children(serverKey, token, ratingKey!),
        queryFn: () =>
            provider.media.getMetadataChildren(
                {
                    serverUrl,
                    machineIdentifier,
                    clientIdentifier: clientIdentifier!,
                    token,
                },
                ratingKey!
            ),
        enabled: isReady,
        staleTime: 1000 * 60 * 5, // 5 minutes
        refetchOnWindowFocus: false,
    });
};

export const useMetadata = (
    serverUrl: string | null,
    machineIdentifier: string | null,
    ratingKey: string | undefined | null,
    clientIdentifier: string | null,
    token: string | null
) => {
    const provider = usePastaProvider();
    const serverKey = machineIdentifier || serverUrl;
    const isReady = provider.mode === 'server'
        ? Boolean(machineIdentifier && clientIdentifier && ratingKey)
        : Boolean(serverUrl && token && clientIdentifier && ratingKey);

    return useQuery({
        queryKey: plexKeys.metadata(serverKey, token, ratingKey!),
        queryFn: () =>
            provider.media.getMetadata(
                {
                    serverUrl,
                    machineIdentifier,
                    clientIdentifier: clientIdentifier!,
                    token,
                },
                ratingKey!
            ),
        enabled: isReady,
        staleTime: 1000 * 60 * 30, // 30 minutes
        refetchOnWindowFocus: false,
    });
};

export const useHomeUsers = (
    clientIdentifier: string | null,
    token: string | null,
    machineIdentifier?: string | null
) => {
    const provider = usePastaProvider();
    const isReady = provider.mode === 'server'
        ? Boolean(clientIdentifier)
        : Boolean(clientIdentifier && token);

    return useQuery({
        queryKey: [...plexKeys.all, 'users', machineIdentifier ?? null],
        queryFn: () => provider.auth.getSwitchableUsers(clientIdentifier!, token || '', machineIdentifier),
        enabled: isReady,
        staleTime: 1000 * 60 * 5, // 5 minutes
        refetchOnWindowFocus: false,
    });
};

export const useUser = (clientIdentifier: string | null, token: string | null, enabled: boolean = true) => {
    const provider = usePastaProvider();
    return useQuery({
        queryKey: [...plexKeys.all, 'user', token],
        queryFn: () => provider.auth.validateUser(clientIdentifier!, token!),
        enabled: !!clientIdentifier && !!token && enabled,
        staleTime: 1000 * 60 * 60, // 1 hour
        refetchOnWindowFocus: false,
        retry: false, // Don't retry auth failures
    });
};

export const usePlexResources = (
    clientIdentifier: string | null,
    token: string | null,
    userId?: number | null
) => {
    const provider = usePastaProvider();
    const isReady = provider.mode === 'server'
        ? Boolean(clientIdentifier && (userId || token))
        : Boolean(clientIdentifier && token);
    // In Server Mode, /api/servers filters and annotates servers per session userId.
    // In Client Mode, plex.tv/api/v2/resources is fetched once with the primary account token
    // and filtered client-side by isManagedUser in usePlexServer.ts.
    const scopeKey = provider.mode === 'server' ? (userId ?? token ?? 'anon') : (token ?? 'anon');

    return useQuery({
        queryKey: [...plexKeys.all, 'resources', scopeKey],
        queryFn: () => provider.servers.getResources(clientIdentifier!, token || ''),
        enabled: isReady,
        staleTime: 1000 * 60 * 5, // 5 minutes
        refetchOnWindowFocus: false,
    });
};
