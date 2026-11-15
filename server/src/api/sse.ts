import type { ServerResponse } from 'node:http';
import { getUserRoleForServer } from '../plex/userManager.ts';
import type { ApiRouter } from './httpServer.ts';
import { sendError } from './httpServer.ts';

interface SseClient {
    id: string;
    res: ServerResponse;
    plexUserId: number;
    primaryPlexUserId: number;
    activeMachineId: string | null;
}

const clients = new Map<string, SseClient>();
let clientCounter = 0;

// Keep SSE connections alive through reverse proxies with a 25s heartbeat comment
const heartbeatInterval = setInterval(() => {
    for (const [id, client] of clients.entries()) {
        if (client.res.writableEnded || client.res.destroyed) {
            clients.delete(id);
            continue;
        }
        try {
            client.res.write(': heartbeat\n\n');
        } catch {
            clients.delete(id);
        }
    }
}, 25000);
heartbeatInterval.unref();

export const broadcastSseEvent = (
    eventName: string,
    payload: unknown,
    filter?: (client: {
        plexUserId: number;
        primaryPlexUserId: number;
        activeMachineId: string | null;
    }) => boolean
): void => {
    const dataLine = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const [id, client] of clients.entries()) {
        if (client.res.writableEnded || client.res.destroyed) {
            clients.delete(id);
            continue;
        }
        if (filter && !filter(client)) {
            continue;
        }
        try {
            client.res.write(dataLine);
        } catch {
            clients.delete(id);
        }
    }
};

export const broadcastSseEventPerClient = (
    eventName: string,
    getPayloadForClient: (client: {
        plexUserId: number;
        primaryPlexUserId: number;
        activeMachineId: string | null;
    }) => unknown | null
): void => {
    for (const [id, client] of clients.entries()) {
        if (client.res.writableEnded || client.res.destroyed) {
            clients.delete(id);
            continue;
        }
        const payload = getPayloadForClient(client);
        if (payload === null || payload === undefined) {
            continue;
        }
        const dataLine = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
        try {
            client.res.write(dataLine);
        } catch {
            clients.delete(id);
        }
    }
};

export const canUserViewBatchJob = (
    machineIdentifier: string,
    initiatedByUserId: number,
    viewerPrimaryUserId: number
): boolean => {
    if (initiatedByUserId === viewerPrimaryUserId) {
        return true;
    }
    const role = getUserRoleForServer(machineIdentifier, viewerPrimaryUserId);
    return role === 'owner' || role === 'admin';
};

export const closeAllSseClients = (): void => {
    for (const [, client] of clients.entries()) {
        try {
            client.res.end();
        } catch {
            // Ignore close errors
        }
    }
    clients.clear();
};

export const registerSseRoutes = (router: ApiRouter): void => {
    router.get('/api/events', ({ req, res, session }) => {
        if (!session) {
            sendError(res, 401, 'Not authenticated');
            return;
        }

        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });

        const clientId = `sse-${++clientCounter}-${Date.now()}`;
        clients.set(clientId, {
            id: clientId,
            res,
            plexUserId: session.plexUserId,
            primaryPlexUserId: session.primaryPlexUserId,
            activeMachineId: session.activeMachineId,
        });

        res.write(`event: connected\ndata: ${JSON.stringify({ clientId })}\n\n`);

        req.on('close', () => {
            clients.delete(clientId);
        });
    });
};
