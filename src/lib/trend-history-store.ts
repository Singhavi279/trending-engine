/**
 * Persists trend rank snapshots for velocity (Upstash Redis via REST).
 * When UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are unset, no-op — all trends show velocity "new".
 */

import { Redis } from '@upstash/redis';

const KV_KEY = 'trend-engine:history';
const MAX_SNAPSHOTS = 24;

export type TrendHistorySnapshot = {
  timestamp: string;
  trends: unknown[];
};

function getRedis(): Redis | null {
  if (!isTrendHistoryStorageConfigured()) return null;
  try {
    return Redis.fromEnv();
  } catch {
    return null;
  }
}

export function isTrendHistoryStorageConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

export async function loadTrendHistory(): Promise<TrendHistorySnapshot[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const data = await redis.get<TrendHistorySnapshot[]>(KV_KEY);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('Trend history load failed:', e);
    return [];
  }
}

export async function appendTrendSnapshot(
  snapshot: TrendHistorySnapshot,
  previousHistory?: TrendHistorySnapshot[]
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    const history = previousHistory ?? (await loadTrendHistory());
    const updated = [...history, snapshot].slice(-MAX_SNAPSHOTS);
    await redis.set(KV_KEY, updated);
  } catch (e) {
    console.error('Trend history save failed:', e);
  }
}
