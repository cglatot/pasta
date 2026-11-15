import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { decryptToken, encryptToken, getCookieSecret } from '../storage/crypto.ts';
import { getDatabase } from '../storage/db.ts';

const COOKIE_NAME = 'pasta_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface SessionPayload {
    primaryPlexUserId: number;
    primaryUsername: string;
    primaryThumb?: string;
    primaryUuid?: string;
    plexUserId: number;
    uuid: string;
    username: string;
    title: string;
    email: string;
    thumb: string;
    encryptedPrimaryToken: string;
    encryptedActiveToken: string;
    activeMachineId: string | null;
    activeServerUrl: string | null;
    activeServerName: string | null;
    isSharedServer: boolean;
    isManagedUser: boolean;
    isAdminPinProtected?: boolean;
    adminPinVerified?: boolean;
    issuedAt: number;
}

const signPayload = (base64Payload: string): string => {
    const secret = getCookieSecret();
    return createHmac('sha256', secret).update(base64Payload).digest('base64url');
};

export const encodeSessionCookie = (session: SessionPayload): string => {
    const json = JSON.stringify(session);
    const base64Payload = Buffer.from(json, 'utf8').toString('base64url');
    const signature = signPayload(base64Payload);
    return `${base64Payload}.${signature}`;
};

export const decodeSessionCookie = (cookieValue: string | undefined): SessionPayload | null => {
    if (!cookieValue) return null;
    const dotIdx = cookieValue.indexOf('.');
    if (dotIdx <= 0) return null;

    const base64Payload = cookieValue.slice(0, dotIdx);
    const signature = cookieValue.slice(dotIdx + 1);
    const expectedSig = signPayload(base64Payload);

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        return null;
    }

    try {
        const json = Buffer.from(base64Payload, 'base64url').toString('utf8');
        const parsed = JSON.parse(json) as SessionPayload;
        if (!parsed || typeof parsed.plexUserId !== 'number') return null;
        return parsed;
    } catch {
        return null;
    }
};

export const parseCookies = (req: IncomingMessage): Record<string, string> => {
    const header = req.headers.cookie;
    const result: Record<string, string> = {};
    if (!header) return result;

    for (const part of header.split(';')) {
        const eqIdx = part.indexOf('=');
        if (eqIdx > 0) {
            const key = part.slice(0, eqIdx).trim();
            const val = decodeURIComponent(part.slice(eqIdx + 1).trim());
            result[key] = val;
        }
    }
    return result;
};

export const getSessionFromRequest = (req: IncomingMessage): SessionPayload | null => {
    const cookies = parseCookies(req);
    return decodeSessionCookie(cookies[COOKIE_NAME]);
};

export const setSessionCookie = (res: ServerResponse, session: SessionPayload): void => {
    const value = encodeSessionCookie(session);
    const cookieStr = `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}`;
    res.setHeader('Set-Cookie', cookieStr);
};

export const clearSessionCookie = (res: ServerResponse): void => {
    const cookieStr = `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
    res.setHeader('Set-Cookie', cookieStr);
};

export const getPrimaryToken = (session: SessionPayload): string => {
    return decryptToken(session.encryptedPrimaryToken);
};

export const getActiveToken = (session: SessionPayload): string => {
    return decryptToken(session.encryptedActiveToken);
};

export const createSessionPayload = (params: {
    primaryUser: {
        id: number;
        uuid: string;
        username?: string;
        title?: string;
        email?: string;
        thumb?: string;
        protected?: boolean;
    };
    primaryToken: string;
    activeMachineId?: string | null;
    activeServerUrl?: string | null;
    activeServerName?: string | null;
    isSharedServer?: boolean;
    isAdminPinProtected?: boolean;
    adminPinVerified?: boolean;
}): SessionPayload => {
    const username = params.primaryUser.username || params.primaryUser.title || 'Plex User';
    const title = params.primaryUser.title || username;
    const encrypted = encryptToken(params.primaryToken);
    const pinProtected = Boolean(params.isAdminPinProtected ?? params.primaryUser.protected);

    return {
        primaryPlexUserId: params.primaryUser.id,
        primaryUsername: username,
        primaryThumb: params.primaryUser.thumb || '',
        primaryUuid: params.primaryUser.uuid || '',
        plexUserId: params.primaryUser.id,
        uuid: params.primaryUser.uuid || '',
        username,
        title,
        email: params.primaryUser.email || '',
        thumb: params.primaryUser.thumb || '',
        encryptedPrimaryToken: encrypted,
        encryptedActiveToken: encrypted,
        activeMachineId: params.activeMachineId ?? null,
        activeServerUrl: params.activeServerUrl ?? null,
        activeServerName: params.activeServerName ?? null,
        isSharedServer: Boolean(params.isSharedServer),
        isManagedUser: false,
        isAdminPinProtected: pinProtected,
        adminPinVerified: params.adminPinVerified ?? !pinProtected,
        issuedAt: Date.now(),
    };
};

// ============================================================================
// Instance Owner Management (Strict Instance Server Scoping)
// ============================================================================

const INSTANCE_OWNER_KEY = 'instance_owner_plex_id';

export const getInstanceOwnerPlexId = (): number | null => {
    const db = getDatabase();
    const row = db
        .prepare('SELECT value FROM instance_settings WHERE key = ?')
        .get(INSTANCE_OWNER_KEY) as { value: string } | undefined;

    if (!row) return null;
    const parsed = Number.parseInt(row.value, 10);
    return Number.isNaN(parsed) ? null : parsed;
};

/**
 * Claims the PASTA Server instance ownership if no owner has been recorded yet
 * and this user owns at least one Plex Media Server.
 */
export const getOrClaimInstanceOwner = (
    plexUserId: number,
    ownsAnyPlexServer: boolean
): number | null => {
    const existing = getInstanceOwnerPlexId();
    if (existing !== null) {
        return existing;
    }

    if (!ownsAnyPlexServer) {
        return null;
    }

    const db = getDatabase();
    db.prepare(
        'INSERT OR IGNORE INTO instance_settings (key, value, updated_at) VALUES (?, ?, ?)'
    ).run(INSTANCE_OWNER_KEY, String(plexUserId), Date.now());

    return getInstanceOwnerPlexId();
};

export const isInstanceOwner = (plexUserId: number): boolean => {
    const ownerId = getInstanceOwnerPlexId();
    return ownerId !== null && ownerId === plexUserId;
};
