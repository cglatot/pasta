import {
    getPmsCollectionChildren,
    getPmsLibraries,
    getPmsLibraryCollections,
    getPmsLibraryItemsPaginated,
    getPmsMetadata,
    getPmsMetadataChildren,
} from '../plex/client.ts';
import { type ApiRouter, sendError, sendJson } from './httpServer.ts';
import {
    resolveEffectiveServerUrl,
    resolveEffectiveUserToken,
} from './serverRoutes.ts';

export const registerMediaRoutes = (router: ApiRouter): void => {
    router.get('/api/media/:machineId/libraries', async ({ res, params, query, session }) => {
        if (!session) {
            sendError(res, 401, 'Not authenticated');
            return;
        }

        const { machineId } = params;
        const serverUrl = resolveEffectiveServerUrl(machineId, session);
        if (!serverUrl) {
            sendError(res, 400, 'No active server URL resolved for this Plex server');
            return;
        }

        const token = resolveEffectiveUserToken(machineId, session);
        const clientIdentifier = query.clientIdentifier || 'PASTA-Server';
        const timeoutMs = query.timeoutMs ? Number.parseInt(query.timeoutMs, 10) : undefined;

        const libraries = await getPmsLibraries(serverUrl, clientIdentifier, token, timeoutMs);
        sendJson(res, 200, libraries);
    });

    router.get(
        '/api/media/:machineId/libraries/:libraryKey/items',
        async ({ res, params, query, session }) => {
            if (!session) {
                sendError(res, 401, 'Not authenticated');
                return;
            }

            const { machineId, libraryKey } = params;
            const serverUrl = resolveEffectiveServerUrl(machineId, session);
            if (!serverUrl) {
                sendError(res, 400, 'No active server URL resolved for this Plex server');
                return;
            }

            const token = resolveEffectiveUserToken(machineId, session);
            const clientIdentifier = query.clientIdentifier || 'PASTA-Server';
            const extraParams: Record<string, string | number> = {};
            if (query.type) {
                extraParams.type = Number.parseInt(query.type, 10) || query.type;
            }

            const items = await getPmsLibraryItemsPaginated(
                serverUrl,
                libraryKey,
                clientIdentifier,
                token,
                extraParams
            );
            sendJson(res, 200, items);
        }
    );

    router.get(
        '/api/media/:machineId/libraries/:libraryKey/collections',
        async ({ res, params, query, session }) => {
            if (!session) {
                sendError(res, 401, 'Not authenticated');
                return;
            }

            const { machineId, libraryKey } = params;
            const serverUrl = resolveEffectiveServerUrl(machineId, session);
            if (!serverUrl) {
                sendError(res, 400, 'No active server URL resolved for this Plex server');
                return;
            }

            const token = resolveEffectiveUserToken(machineId, session);
            const clientIdentifier = query.clientIdentifier || 'PASTA-Server';

            const collections = await getPmsLibraryCollections(
                serverUrl,
                libraryKey,
                clientIdentifier,
                token
            );
            sendJson(res, 200, collections);
        }
    );

    router.get(
        '/api/media/:machineId/collections/:collectionKey/children',
        async ({ res, params, query, session }) => {
            if (!session) {
                sendError(res, 401, 'Not authenticated');
                return;
            }

            const { machineId, collectionKey } = params;
            const serverUrl = resolveEffectiveServerUrl(machineId, session);
            if (!serverUrl) {
                sendError(res, 400, 'No active server URL resolved for this Plex server');
                return;
            }

            const token = resolveEffectiveUserToken(machineId, session);
            const clientIdentifier = query.clientIdentifier || 'PASTA-Server';

            const items = await getPmsCollectionChildren(
                serverUrl,
                collectionKey,
                clientIdentifier,
                token
            );
            sendJson(res, 200, items);
        }
    );

    router.get(
        '/api/media/:machineId/metadata/:ratingKey/children',
        async ({ res, params, query, session }) => {
            if (!session) {
                sendError(res, 401, 'Not authenticated');
                return;
            }

            const { machineId, ratingKey } = params;
            const serverUrl = resolveEffectiveServerUrl(machineId, session);
            if (!serverUrl) {
                sendError(res, 400, 'No active server URL resolved for this Plex server');
                return;
            }

            const token = resolveEffectiveUserToken(machineId, session);
            const clientIdentifier = query.clientIdentifier || 'PASTA-Server';

            const children = await getPmsMetadataChildren(
                serverUrl,
                ratingKey,
                clientIdentifier,
                token
            );
            sendJson(res, 200, children);
        }
    );

    router.get(
        '/api/media/:machineId/metadata/:ratingKey',
        async ({ res, params, query, session }) => {
            if (!session) {
                sendError(res, 401, 'Not authenticated');
                return;
            }

            const { machineId, ratingKey } = params;
            const serverUrl = resolveEffectiveServerUrl(machineId, session);
            if (!serverUrl) {
                sendError(res, 400, 'No active server URL resolved for this Plex server');
                return;
            }

            const token = resolveEffectiveUserToken(machineId, session);
            const clientIdentifier = query.clientIdentifier || 'PASTA-Server';

            const metadata = await getPmsMetadata(
                serverUrl,
                ratingKey,
                clientIdentifier,
                token
            );
            sendJson(res, 200, metadata || null);
        }
    );
};
