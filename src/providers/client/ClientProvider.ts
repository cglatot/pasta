import {
    checkPin,
    checkServerIdentity,
    getCollectionChildren,
    getHomeUsers,
    getLibraries,
    getLibraryCollections,
    getLibraryItems,
    getMetadata,
    getMetadataChildren,
    getPin,
    getResources,
    getSharedServers,
    getUser,
    isAbortError,
    switchUser as plexSwitchUser,
    updateStream,
} from './plexClient';
import { executeBatchClient, updateSingleEpisodeClient } from './clientBatcher';
import type { IPastaProvider } from '../types';

export const clientStandaloneProvider: IPastaProvider = {
    mode: 'client',
    capabilities: {
        supportsServerAdmin: false,
        supportsMultiUserBatch: false,
        supportsPersistentBackgroundBatch: false,
        supportsBatchHistory: false,
    },

    auth: {
        createPin: async (clientIdentifier: string) => {
            const data = await getPin(clientIdentifier);
            return { id: data.id, code: data.code };
        },
        checkPin: async (pinId: number, clientIdentifier: string, code: string) => {
            const data = await checkPin(pinId, clientIdentifier, code);
            return { authToken: data.authToken || null };
        },
        validateUser: async (clientIdentifier: string, token: string) => {
            return getUser(clientIdentifier, token);
        },
        checkIdentity: async (serverUrl, clientIdentifier, token, signal, timeoutMs = 5000) => {
            const identity = await checkServerIdentity(serverUrl, clientIdentifier, token, signal, timeoutMs);
            return {
                machineIdentifier: identity?.MediaContainer?.machineIdentifier,
                friendlyName:
                    identity?.MediaContainer?.friendlyName || identity?.MediaContainer?.myPlexServerName,
            };
        },
        getSwitchableUsers: async (clientIdentifier: string, token: string) => {
            return getHomeUsers(clientIdentifier, token);
        },
        verifyHomeUserPin: async (uuid: string, clientIdentifier: string, token: string, pin: string) => {
            return plexSwitchUser(uuid, clientIdentifier, token, pin);
        },
        resolveManagedUserToken: async (
            machineIdentifier: string,
            targetUserId: number,
            clientIdentifier: string,
            adminToken: string
        ) => {
            const sharedServersData = await getSharedServers(machineIdentifier, clientIdentifier, adminToken);
            if (typeof sharedServersData === 'string' && sharedServersData) {
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(sharedServersData, 'text/xml');
                const sharedServers = xmlDoc.getElementsByTagName('SharedServer');

                for (let i = 0; i < sharedServers.length; i++) {
                    const server = sharedServers[i];
                    if (server.getAttribute('userID') === targetUserId.toString()) {
                        const token = server.getAttribute('accessToken') || '';
                        if (token) return token;
                    }
                }
            }
            throw new Error(`Could not find access token for managed user ID ${targetUserId}`);
        },
    },

    servers: {
        getResources: async (clientIdentifier: string, token: string) => {
            return getResources(clientIdentifier, token);
        },
        connectToServer: async (server, options) => {
            const { useLocalAddress, clientIdentifier, timeoutMs, onRegisterAbortControllers } = options;

            const connections = server.connections.filter(c => {
                if (window.location.protocol === 'https:' && c.protocol !== 'https') return false;
                return true;
            });

            connections.sort((a, b) => {
                if (useLocalAddress) {
                    return a.local === b.local ? 0 : a.local ? -1 : 1;
                }
                return a.local === b.local ? 0 : !a.local ? -1 : 1;
            });

            if (connections.length === 0) {
                return {
                    success: false,
                    errorMessage:
                        "No secure connections found for this server. Please enable 'Secure connections' in your Plex Media Server settings.",
                };
            }

            const abortControllers = connections.map(() => new AbortController());
            onRegisterAbortControllers?.(abortControllers);

            const connectionPromises = connections.map(async (conn, index) => {
                try {
                    const identity = await checkServerIdentity(
                        conn.uri,
                        clientIdentifier,
                        server.accessToken,
                        abortControllers[index].signal,
                        timeoutMs
                    );

                    abortControllers.forEach((controller, i) => {
                        if (i !== index) controller.abort();
                    });

                    const machineId =
                        identity?.MediaContainer?.machineIdentifier || server.clientIdentifier;

                    return {
                        success: true,
                        uri: conn.uri,
                        machineId,
                    };
                } catch (e: unknown) {
                    if (!isAbortError(e)) {
                        console.warn(`Failed to connect to ${conn.uri}`, e);
                    }
                    return {
                        success: false,
                        uri: conn.uri,
                    };
                }
            });

            const results = await Promise.all(connectionPromises);
            onRegisterAbortControllers?.([]);

            const successfulConnection = results.find(r => r.success);
            if (successfulConnection && successfulConnection.uri) {
                return {
                    success: true,
                    uri: successfulConnection.uri,
                    machineId: successfulConnection.machineId,
                };
            }

            let errMsg = 'Could not connect to this server. Please check your network connection.';
            if (server.dnsRebindingProtection) {
                errMsg +=
                    ' Your router or ISP may have DNS Rebinding Protection blocking *.plex.direct.';
            }

            return {
                success: false,
                errorMessage: errMsg,
            };
        },
    },

    media: {
        getLibraries: async (ctx, timeoutMs) => {
            return getLibraries(ctx.serverUrl!, ctx.clientIdentifier, ctx.token!, timeoutMs);
        },
        getLibraryItems: async (ctx, libraryKey, extraParams) => {
            return getLibraryItems(ctx.serverUrl!, libraryKey, ctx.clientIdentifier, ctx.token!, extraParams);
        },
        getLibraryCollections: async (ctx, libraryKey) => {
            return getLibraryCollections(ctx.serverUrl!, libraryKey, ctx.clientIdentifier, ctx.token!);
        },
        getCollectionChildren: async (ctx, collectionRatingKey) => {
            return getCollectionChildren(ctx.serverUrl!, collectionRatingKey, ctx.clientIdentifier, ctx.token!);
        },
        getMetadataChildren: async (ctx, ratingKey) => {
            return getMetadataChildren(ctx.serverUrl!, ratingKey, ctx.clientIdentifier, ctx.token!);
        },
        getMetadata: async (ctx, ratingKey) => {
            return getMetadata(ctx.serverUrl!, ratingKey, ctx.clientIdentifier, ctx.token!);
        },
        updateStream: async (ctx, partId, streamId, streamType) => {
            await updateStream(ctx.serverUrl!, partId, streamId, streamType, ctx.clientIdentifier, ctx.token!);
        },
    },

    batch: {
        updateSingleEpisode: updateSingleEpisodeClient,
        executeBatch: executeBatchClient,
    },
};
