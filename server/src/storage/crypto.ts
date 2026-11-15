import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const KEY_SALT = 'pasta-server-v1-salt';

let cachedKey: Buffer | null = null;
let cachedRawSecret: string | null = null;

export const getDataDir = (overrideDir?: string): string => {
    const dir =
        overrideDir ||
        process.env.PASTA_CONFIG_DIR ||
        process.env.PASTA_DATA_DIR ||
        resolve(process.cwd(), 'data');
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    return dir;
};

/**
 * Parses Linux /proc/self/mountinfo content to determine whether targetPath
 * (e.g. "/config") is backed by an explicit volume or bind mount rather than the root overlay "/".
 */
export const isPathMountedInMountInfo = (
    targetPath: string,
    mountInfoContent: string
): boolean => {
    const normalizedTarget =
        targetPath.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
    const lines = mountInfoContent.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const fields = trimmed.split(/\s+/);
        if (fields.length < 5) continue;
        const mountPoint = fields[4].replace(/\\040/g, ' ').replace(/\/+$/, '') || '/';
        if (mountPoint === '/') continue;
        if (
            normalizedTarget === mountPoint ||
            normalizedTarget.startsWith(`${mountPoint}/`)
        ) {
            return true;
        }
    }
    return false;
};

/**
 * Checks whether the configured persistent storage directory (/config) is mounted
 * when running inside a Linux container. Returns true in local development/test environments.
 */
export const isConfigVolumeMounted = (overrideDir?: string): boolean => {
    const customMountInfoPath = process.env.PASTA_MOUNTINFO_FILE?.trim();
    const mountInfoPath = customMountInfoPath || '/proc/self/mountinfo';
    const isContainer =
        Boolean(customMountInfoPath) ||
        existsSync('/.dockerenv') ||
        existsSync('/run/.containerenv');
    if (!isContainer || !existsSync(mountInfoPath)) {
        return true;
    }

    const targetDir =
        overrideDir ||
        process.env.PASTA_CONFIG_DIR ||
        process.env.PASTA_DATA_DIR ||
        '/config';
    try {
        const mountInfo = readFileSync(mountInfoPath, 'utf8');
        return isPathMountedInMountInfo(targetDir, mountInfo);
    } catch {
        return true;
    }
};

/**
 * Resolves the raw secret string from process.env.PASTA_SECRET or auto-generates and persists
 * a 32-byte cryptographically random secret in <dataDir>/.pasta_secret (0600 permissions).
 */
export const getOrInitRawSecret = (overrideDir?: string): string => {
    if (cachedRawSecret && !overrideDir) {
        return cachedRawSecret;
    }

    const envSecret = process.env.PASTA_SECRET?.trim();
    if (envSecret && envSecret.length > 0) {
        if (!overrideDir) cachedRawSecret = envSecret;
        return envSecret;
    }

    const dataDir = getDataDir(overrideDir);
    const secretFilePath = join(dataDir, '.pasta_secret');

    if (existsSync(secretFilePath)) {
        const existing = readFileSync(secretFilePath, 'utf8').trim();
        if (existing.length >= 32) {
            if (!overrideDir) cachedRawSecret = existing;
            return existing;
        }
    }

    const generated = randomBytes(KEY_BYTES).toString('hex');
    writeFileSync(secretFilePath, `${generated}\n`, { encoding: 'utf8', mode: 0o600 });
    if (!overrideDir) cachedRawSecret = generated;
    return generated;
};

export const getEncryptionKey = (overrideDir?: string): Buffer => {
    if (cachedKey && !overrideDir) {
        return cachedKey;
    }
    const rawSecret = getOrInitRawSecret(overrideDir);
    const derived = scryptSync(rawSecret, KEY_SALT, KEY_BYTES);
    if (!overrideDir) cachedKey = derived;
    return derived;
};

export const getCookieSecret = (overrideDir?: string): string => {
    return getOrInitRawSecret(overrideDir);
};

/**
 * Encrypts a sensitive string (such as a Plex token) using AES-256-GCM.
 * Returns a compact "ivHex:authTagHex:cipherHex" payload.
 */
export const encryptToken = (plainText: string, overrideDir?: string): string => {
    const key = getEncryptionKey(overrideDir);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });

    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
};

/**
 * Decrypts a token previously encrypted by encryptToken().
 */
export const decryptToken = (encryptedPayload: string, overrideDir?: string): string => {
    const parts = encryptedPayload.split(':');
    if (parts.length !== 3) {
        throw new Error('Invalid encrypted token payload format');
    }

    const [ivHex, authTagHex, cipherHex] = parts;
    const key = getEncryptionKey(overrideDir);
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const cipherBytes = Buffer.from(cipherHex, 'hex');

    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(cipherBytes), decipher.final()]);
    return decrypted.toString('utf8');
};
