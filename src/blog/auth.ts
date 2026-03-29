/**
 * API Key Authentication for the Blog MCP Server.
 *
 * - API keys are stored as SHA-256 hashes (never plaintext)
 * - Keys support scopes: 'read', 'write', 'admin'
 * - Middleware validates X-API-Key header and checks required scope
 * - MASTER_API_KEY auto-registration is handled in server.ts, not here
 */

import { createHash, timingSafeEqual } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../shared/logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ApiKey {
  key: string;          // SHA-256 hash of the plaintext key
  label: string;
  scopes: string[];     // 'read' | 'write' | 'admin'
  createdAt: string;
  lastUsedAt?: string;
}

// ─── Hashing ─────────────────────────────────────────────────────────────────

/** SHA-256 hex hash of a plaintext API key. */
export function hashKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/**
 * Timing-safe comparison of a plaintext key against a stored SHA-256 hash.
 * The stored value is already a hash — we hash the input and compare.
 */
export function verifyKey(plaintext: string, storedHash: string): boolean {
  try {
    const inputHash = hashKey(plaintext);
    return timingSafeEqual(Buffer.from(inputHash), Buffer.from(storedHash));
  } catch {
    return false;
  }
}

// ─── Storage ─────────────────────────────────────────────────────────────────

const API_KEYS_FILE = 'api-keys.json';

const VALID_SCOPES = new Set(['read', 'write', 'admin']);

function isApiKeyEntry(val: unknown): val is ApiKey {
  if (typeof val !== 'object' || val === null) return false;
  const o = val as Record<string, unknown>;
  return (
    typeof o['key'] === 'string' &&
    typeof o['label'] === 'string' &&
    Array.isArray(o['scopes']) &&
    (o['scopes'] as unknown[]).every((s) => typeof s === 'string' && VALID_SCOPES.has(s)) &&
    typeof o['createdAt'] === 'string'
  );
}

export function loadApiKeys(dataDir: string): ApiKey[] {
  const file = join(dataDir, API_KEYS_FILE);
  try {
    const raw = readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isApiKeyEntry);
  } catch {
    return [];
  }
}

export function saveApiKeys(keys: ApiKey[], dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, API_KEYS_FILE);
  writeFileSync(file, JSON.stringify(keys, null, 2), 'utf-8');
}

// ─── Serialized mutation ──────────────────────────────────────────────────────

/**
 * Serialize all API-key mutations through a single queue so concurrent
 * calls from `requireApiKey` (lastUsedAt updates) and `generate_api_key`
 * never overwrite each other's writes.
 */
let _apiKeyMutexChain: Promise<void> = Promise.resolve();

export function mutateApiKeys(
  dataDir: string,
  mutate: (keys: ApiKey[]) => ApiKey[],
): Promise<void> {
  _apiKeyMutexChain = _apiKeyMutexChain.then(() => {
    const keys = loadApiKeys(dataDir);
    const updated = mutate(keys);
    saveApiKeys(updated, dataDir);
  }).catch((err) => {
    logger.warn('mutateApiKeys: write failed', { err, dataDir });
  });
  return _apiKeyMutexChain;
}

// ─── Scope helpers ────────────────────────────────────────────────────────────

/** Check whether a key's scopes satisfy a required scope. */
function hasScope(keyScopes: string[], required?: string): boolean {
  if (!required) return true;
  return keyScopes.includes(required);
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export type ValidKeyStore = ApiKey[];

/**
 * Express middleware: requires a valid X-API-Key header.
 *
 * - Hashes the submitted key and compares against all stored hashes
 * - Keys are loaded lazily on every request so newly generated keys
 *   (e.g. via `generate_api_key`) are recognized without a restart
 * - Sets `res.locals.apiKey` to the matched ApiKey object
 * - Returns 401 if missing, invalid, or insufficient scope
 */
export function requireApiKey(dataDir: string, requiredScope?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const submitted = req.get('X-API-Key');
    if (!submitted) {
      res.status(401).json({ error: 'Missing X-API-Key header' });
      return;
    }

    // Lazy-load so newly generated keys are recognized immediately
    const validKeys = loadApiKeys(dataDir);
    const matched = validKeys.find((k) => verifyKey(submitted, k.key));
    if (!matched) {
      res.status(401).json({ error: 'Invalid API key' });
      return;
    }

    if (!hasScope(matched.scopes, requiredScope)) {
      res.status(403).json({ error: `Insufficient scope: requires '${requiredScope}'` });
      return;
    }

    // Persist lastUsedAt through the serialized mutation queue so concurrent
    // writes from generate_api_key don't overwrite each other.
    const matchedKey = matched.key;
    const lastUsedAt = new Date().toISOString();
    matched.lastUsedAt = lastUsedAt;
    void mutateApiKeys(dataDir, (keys) =>
      keys.map((k) => (k.key === matchedKey ? { ...k, lastUsedAt } : k)),
    );
    res.locals.apiKey = matched;
    next();
  };
}
