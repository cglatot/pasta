import { useQuery } from '@tanstack/react-query';
import { getLibraries, getLibraryItems, getMetadataChildren, getMetadata } from '../services/plex';


// Query Keys
export const plexKeys = {
    all: ['plex'] as const,
    server: (machineId: string | null) => [...plexKeys.all, 'server', machineId] as const,
    libraries: (machineId: string | null) => [...plexKeys.server(machineId), 'libraries'] as const,
    libraryItems: (machineId: string | null, libraryId: string) => [...plexKeys.server(machineId), 'library', libraryId] as const,
    // Children and metadata include token because they contain user-specific preferences (subtitles, audio)
    children: (machineId: string | null, token: string | null, ratingKey: string) => [...plexKeys.server(machineId), 'user', token, 'children', ratingKey] as const,
    metadata: (machineId: string | null, token: string | null, ratingKey: string) => [...plexKeys.server(machineId), 'user', token, 'metadata', ratingKey] as const,
};

export const useLibraries = (serverUrl: string | null, machineIdentifier: string | null, clientIdentifier: string | null, token: string | null) => {
    return useQuery({
        queryKey: plexKeys.libraries(machineIdentifier),
        queryFn: () => getLibraries(serverUrl!, clientIdentifier!, token!),
        enabled: !!serverUrl && !!token && !!clientIdentifier && !!machineIdentifier,
        staleTime: 1000 * 60 * 60, // 1 hour (libraries rarely change)
        refetchOnWindowFocus: false,
    });
};

export const useLibraryItems = (serverUrl: string | null, machineIdentifier: string | null, libraryId: string | undefined | null, clientIdentifier: string | null, token: string | null) => {
    return useQuery({
        queryKey: plexKeys.libraryItems(machineIdentifier, libraryId!),
        queryFn: () => getLibraryItems(serverUrl!, libraryId!, clientIdentifier!, token!),
        enabled: !!serverUrl && !!token && !!clientIdentifier && !!libraryId && !!machineIdentifier,
        staleTime: 1000 * 60 * 5, // 5 minutes
        refetchOnWindowFocus: false,
    });
};

export const useMetadataChildren = (serverUrl: string | null, machineIdentifier: string | null, ratingKey: string | undefined | null, clientIdentifier: string | null, token: string | null) => {
    return useQuery({
        queryKey: plexKeys.children(machineIdentifier, token, ratingKey!),
        queryFn: () => getMetadataChildren(serverUrl!, ratingKey!, clientIdentifier!, token!),
        enabled: !!serverUrl && !!token && !!clientIdentifier && !!ratingKey && !!machineIdentifier,
        staleTime: 1000 * 60 * 5, // 5 minutes
        refetchOnWindowFocus: false,
    });
};

export const useMetadata = (serverUrl: string | null, machineIdentifier: string | null, ratingKey: string | undefined | null, clientIdentifier: string | null, token: string | null) => {
    return useQuery({
        queryKey: plexKeys.metadata(machineIdentifier, token, ratingKey!),
        queryFn: () => getMetadata(serverUrl!, ratingKey!, clientIdentifier!, token!),
        enabled: !!serverUrl && !!token && !!clientIdentifier && !!ratingKey && !!machineIdentifier,
        staleTime: 1000 * 60 * 30, // 30 minutes
        refetchOnWindowFocus: false,
    });
};

export const useHomeUsers = (clientIdentifier: string | null, token: string | null) => {
    return useQuery({
        queryKey: [...plexKeys.all, 'users'],
        queryFn: () => import('../services/plex').then(m => m.getHomeUsers(clientIdentifier!, token!)),
        enabled: !!clientIdentifier && !!token,
        staleTime: 1000 * 60 * 5, // 5 minutes
        refetchOnWindowFocus: false,
    });
};

export const useUser = (clientIdentifier: string | null, token: string | null, enabled: boolean = true) => {
    return useQuery({
        queryKey: [...plexKeys.all, 'user', token],
        queryFn: () => import('../services/plex').then(m => m.getUser(clientIdentifier!, token!)),
        enabled: !!clientIdentifier && !!token && enabled,
        staleTime: 1000 * 60 * 60, // 1 hour
        refetchOnWindowFocus: false,
        retry: false, // Don't retry auth failures
    });
};

export const usePlexResources = (clientIdentifier: string | null, token: string | null) => {
    return useQuery({
        queryKey: [...plexKeys.all, 'resources'],
        queryFn: () => import('../services/plex').then(m => m.getResources(clientIdentifier!, token!)),
        enabled: !!clientIdentifier && !!token,
        staleTime: 1000 * 60 * 5, // 5 minutes
        refetchOnWindowFocus: false,
    });
};
