import http from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerAdminRoutes } from './api/adminRoutes.ts';
import { registerAuthRoutes } from './api/authRoutes.ts';
import { registerBatchRoutes } from './api/batchRoutes.ts';
import { ApiRouter } from './api/httpServer.ts';
import { registerMediaRoutes } from './api/mediaRoutes.ts';
import { registerServerRoutes } from './api/serverRoutes.ts';
import { closeAllSseClients, registerSseRoutes } from './api/sse.ts';
import {
    stopAllMonitoredServerListeners,
    syncAllMonitoredServerListeners,
} from './daemon/serverManager.ts';
import { getOrInitRawSecret, isConfigVolumeMounted } from './storage/crypto.ts';
import { closeDatabase, getDatabase, pruneOldLogs } from './storage/db.ts';
import { initDebugLoggingFromDb } from './storage/diagnostics.ts';

export const createPastaApp = () => {
    // 1. Initialize encryption secret and SQLite WAL database
    getOrInitRawSecret();
    getDatabase();
    initDebugLoggingFromDb();
    pruneOldLogs();

    // 2. Register API routes
    const router = new ApiRouter();
    registerAuthRoutes(router);
    registerServerRoutes(router);
    registerMediaRoutes(router);
    registerBatchRoutes(router);
    registerAdminRoutes(router);
    registerSseRoutes(router);

    return router;
};

export const startServer = (port: number = Number(process.env.PORT) || 3001): http.Server => {
    const requestedMode = (process.env.PASTA_MODE || 'server').trim().toLowerCase();
    const configMounted = isConfigVolumeMounted();
    const unmountedConfigFallback = requestedMode !== 'client' && !configMounted;
    const isClientOnlyMode = requestedMode === 'client' || unmountedConfigFallback;

    if (unmountedConfigFallback) {
        console.warn(
            '[PASTA] Persistent storage directory (/config) is not mounted as a volume. Falling back to Client Mode to prevent data loss on container updates. Map /config to a persistent host path to enable Server Mode.'
        );
    }

    const router = isClientOnlyMode ? new ApiRouter() : createPastaApp();
    if (!isClientOnlyMode) {
        syncAllMonitoredServerListeners();
    }

    const staticDistDir = process.env.PASTA_DIST_DIR || resolve(process.cwd(), 'dist');

    const server = http.createServer((req, res) => {
        void router.handle(req, res, staticDistDir, !isClientOnlyMode, unmountedConfigFallback);
    });

    const shutdown = (signal: string) => {
        console.log(`[PASTA] Received ${signal}, shutting down...`);
        if (isClientOnlyMode) {
            server.close(() => process.exit(0));
            return;
        }
        closeAllSseClients();
        void stopAllMonitoredServerListeners().finally(() => {
            server.close(() => {
                closeDatabase();
                process.exit(0);
            });
            setTimeout(() => {
                closeDatabase();
                process.exit(0);
            }, 5000).unref();
        });
    };

    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));

    server.listen(port, '0.0.0.0', () => {
        console.log(
            `[PASTA] Listening on http://0.0.0.0:${port} (${isClientOnlyMode ? 'Client Mode' : 'Server Mode'})`
        );
    });

    return server;
};

// Only auto-start when executed as the main entry point
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    startServer();
}
