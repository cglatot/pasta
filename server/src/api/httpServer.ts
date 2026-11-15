import { existsSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { getSessionFromRequest, type SessionPayload } from './session.ts';

export interface RouteContext {
    req: IncomingMessage;
    res: ServerResponse;
    url: URL;
    params: Record<string, string>;
    query: Record<string, string>;
    body: unknown;
    session: SessionPayload | null;
}

export type RouteHandler = (ctx: RouteContext) => Promise<void> | void;

interface RegisteredRoute {
    method: string;
    pattern: RegExp;
    paramNames: string[];
    handler: RouteHandler;
}

const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
};

export const sendJson = (res: ServerResponse, statusCode: number, data: unknown): void => {
    if (res.writableEnded) return;
    const payload = JSON.stringify(data);
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(payload);
};

export const sendError = (res: ServerResponse, statusCode: number, message: string): void => {
    sendJson(res, statusCode, { error: message });
};

const readJsonBody = (req: IncomingMessage): Promise<unknown> => {
    return new Promise((resolvePromise, rejectPromise) => {
        if (req.method === 'GET' || req.method === 'HEAD') {
            resolvePromise(undefined);
            return;
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;
        const maxBytes = 2 * 1024 * 1024; // 2 MB limit

        req.on('data', (chunk: Buffer) => {
            totalBytes += chunk.length;
            if (totalBytes > maxBytes) {
                req.destroy(new Error('Request body too large'));
                return;
            }
            chunks.push(chunk);
        });

        req.on('end', () => {
            if (chunks.length === 0) {
                resolvePromise({});
                return;
            }
            const raw = Buffer.concat(chunks).toString('utf8').trim();
            if (!raw) {
                resolvePromise({});
                return;
            }
            try {
                resolvePromise(JSON.parse(raw));
            } catch {
                rejectPromise(new Error('Invalid JSON body'));
            }
        });

        req.on('error', rejectPromise);
    });
};

export class ApiRouter {
    private routes: RegisteredRoute[] = [];

    public register(method: 'GET' | 'POST' | 'PUT' | 'DELETE', pathTemplate: string, handler: RouteHandler): void {
        const paramNames: string[] = [];
        const regexPattern = pathTemplate
            .split('/')
            .map(segment => {
                if (segment.startsWith(':')) {
                    paramNames.push(segment.slice(1));
                    return '([^/]+)';
                }
                return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            })
            .join('/');

        this.routes.push({
            method: method.toUpperCase(),
            pattern: new RegExp(`^${regexPattern}$`),
            paramNames,
            handler,
        });
    }

    public get(pathTemplate: string, handler: RouteHandler): void {
        this.register('GET', pathTemplate, handler);
    }

    public post(pathTemplate: string, handler: RouteHandler): void {
        this.register('POST', pathTemplate, handler);
    }

    public put(pathTemplate: string, handler: RouteHandler): void {
        this.register('PUT', pathTemplate, handler);
    }

    public delete(pathTemplate: string, handler: RouteHandler): void {
        this.register('DELETE', pathTemplate, handler);
    }

    public async handle(
        req: IncomingMessage,
        res: ServerResponse,
        staticDistDir?: string,
        injectServerMode: boolean = true,
        unmountedConfigFallback: boolean = false
    ): Promise<void> {
        const method = (req.method || 'GET').toUpperCase();
        const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        const pathname = parsedUrl.pathname;

        // 1. Check API routes
        if (pathname.startsWith('/api/')) {
            if (!injectServerMode) {
                sendError(
                    res,
                    404,
                    unmountedConfigFallback
                        ? 'API endpoints are disabled because /config is not mounted to persistent storage (running in Client Mode)'
                        : 'API endpoints are disabled when PASTA_MODE=client'
                );
                return;
            }
            for (const route of this.routes) {
                if (route.method !== method) continue;
                const match = route.pattern.exec(pathname);
                if (!match) continue;

                const params: Record<string, string> = {};
                route.paramNames.forEach((name, idx) => {
                    params[name] = decodeURIComponent(match[idx + 1]);
                });

                const query: Record<string, string> = {};
                parsedUrl.searchParams.forEach((val, key) => {
                    query[key] = val;
                });

                try {
                    const body = await readJsonBody(req);
                    const session = getSessionFromRequest(req);
                    await route.handler({
                        req,
                        res,
                        url: parsedUrl,
                        params,
                        query,
                        body,
                        session,
                    });
                } catch (err) {
                    console.error(`API error on ${method} ${pathname}:`, err);
                    if (!res.writableEnded) {
                        sendError(
                            res,
                            500,
                            err instanceof Error ? err.message : 'Internal server error'
                        );
                    }
                }
                return;
            }

            sendError(res, 404, `API endpoint not found: ${method} ${pathname}`);
            return;
        }

        // 2. Serve Static SPA Assets (if dist directory exists)
        if (staticDistDir && existsSync(staticDistDir)) {
            const safeRelPath = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
            const candidatePath = join(staticDistDir, safeRelPath);

            if (
                pathname !== '/' &&
                existsSync(candidatePath) &&
                statSync(candidatePath).isFile()
            ) {
                const ext = extname(candidatePath).toLowerCase();
                const contentType = MIME_TYPES[ext] || 'application/octet-stream';
                res.statusCode = 200;
                res.setHeader('Content-Type', contentType);
                res.end(readFileSync(candidatePath));
                return;
            }

            // Fallback to index.html (injecting runtime mode flags into <head>)
            const indexPath = join(staticDistDir, 'index.html');
            if (existsSync(indexPath)) {
                const rawHtml = readFileSync(indexPath, 'utf8');
                let html = rawHtml;
                if (injectServerMode) {
                    html = rawHtml.replace(
                        '<head>',
                        '<head>\n    <script>window.__PASTA_SERVER_MODE__ = true;</script>'
                    );
                } else if (unmountedConfigFallback) {
                    html = rawHtml.replace(
                        '<head>',
                        '<head>\n    <script>window.__PASTA_UNMOUNTED_CONFIG__ = true;</script>'
                    );
                }
                res.statusCode = 200;
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.setHeader('Cache-Control', 'no-cache');
                res.end(html);
                return;
            }
        }

        sendError(res, 404, 'Not found');
    }
}
