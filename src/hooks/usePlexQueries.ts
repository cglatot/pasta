import { useQuery } from '@tanstack/react-query';
import { getLibraries, getLibraryItems, getMetadataChildren, getMetadata, getHomeUsers, getUser, getResources } from '../services/plex';

// Query Keys
export const plexKeys = {
    all: ['plex'] as const,
    server: (id: string | null) => [...plexKeys.all, 'server', id] as const,
    libraries: (id: string | null) => [...plexKeys.server(id), 'libraries'] as const,
    libraryItems: (id: string | null, libraryId: string) => [...plexKeys.server(id), 'library', libraryId] as const,
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
    const serverKey = machineIdentifier || serverUrl;
    return useQuery({
        queryKey: plexKeys.libraries(serverKey),
        queryFn: () => getLibraries(serverUrl!, clientIdentifier!, token!, timeout ? timeout * 1000 : undefined),
        enabled: !!serverUrl && !!token && !!clientIdentifier,
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
    token: string | null
) => {
    const serverKey = machineIdentifier || serverUrl;
    return useQuery({
        queryKey: plexKeys.libraryItems(serverKey, libraryId!),
        queryFn: () => getLibraryItems(serverUrl!, libraryId!, clientIdentifier!, token!),
        enabled: !!serverUrl && !!token && !!clientIdentifier && !!libraryId,
        staleTime: 1000 * 60 * 5, // 5 minutes
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
    const serverKey = machineIdentifier || serverUrl;
    return useQuery({
        queryKey: plexKeys.children(serverKey, token, ratingKey!),
        queryFn: () => getMetadataChildren(serverUrl!, ratingKey!, clientIdentifier!, token!),
        enabled: !!serverUrl && !!token && !!clientIdentifier && !!ratingKey,
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
    const serverKey = machineIdentifier || serverUrl;
    return useQuery({
        queryKey: plexKeys.metadata(serverKey, token, ratingKey!),
        queryFn: () => getMetadata(serverUrl!, ratingKey!, clientIdentifier!, token!),
        enabled: !!serverUrl && !!token && !!clientIdentifier && !!ratingKey,
        staleTime: 1000 * 60 * 30, // 30 minutes
        refetchOnWindowFocus: false,
    });
};

export const useHomeUsers = (clientIdentifier: string | null, token: string | null) => {
    return useQuery({
        queryKey: [...plexKeys.all, 'users'],
        queryFn: () => getHomeUsers(clientIdentifier!, token!),
        enabled: !!clientIdentifier && !!token,
        staleTime: 1000 * 60 * 5, // 5 minutes
        refetchOnWindowFocus: false,
    });
};

export const useUser = (clientIdentifier: string | null, token: string | null, enabled: boolean = true) => {
    return useQuery({
        queryKey: [...plexKeys.all, 'user', token],
        queryFn: () => getUser(clientIdentifier!, token!),
        enabled: !!clientIdentifier && !!token && enabled,
        staleTime: 1000 * 60 * 60, // 1 hour
        refetchOnWindowFocus: false,
        retry: false, // Don't retry auth failures
    });
};

export const usePlexResources = (clientIdentifier: string | null, token: string | null) => {
    return useQuery({
        queryKey: [...plexKeys.all, 'resources'],
        queryFn: () => getResources(clientIdentifier!, token!),
        enabled: !!clientIdentifier && !!token,
        staleTime: 1000 * 60 * 5, // 5 minutes
        refetchOnWindowFocus: false,
    });
};
