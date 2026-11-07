import { OFFLINE_BLOCK_REASONS, OFFLINE_STATE, OFFLINE_STORAGE } from './constants.js';

const safeStorage = () => {
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
};

const normalizeScope = (value) => {
  if (!value) return null;
  return String(value).trim().toLowerCase();
};

const OFFLINE_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24;

const buildRecipeCacheTrust = (cachePayload = {}) => {
  const recipes = Array.isArray(cachePayload?.payload?.recipes) ? cachePayload.payload.recipes : [];
  const ageMs = Math.max(0, Date.now() - new Date(cachePayload?.hydratedAt || 0).getTime());
  const stale = !Number.isFinite(ageMs) || ageMs > OFFLINE_CACHE_MAX_AGE_MS;
  const missingTruthCount = recipes.filter((recipe) => !String(recipe?.recipe_truth_status || '').trim()).length;
  const missingFreshnessCount = recipes.filter((recipe) => {
    const sourceTrust = normalizeScope(recipe?.source_trust);
    if (sourceTrust === 'local_queue') return false;
    return !recipe?.offline_base_freshness && !recipe?._offline_base_freshness;
  }).length;
  const blockedCount = recipes.filter((recipe) => {
    const truthStatus = normalizeScope(recipe?.recipe_truth_status);
    const offlineState = normalizeScope(recipe?.offline_sync_state);
    return truthStatus === 'blocked' || [OFFLINE_STATE.CONFLICT, OFFLINE_STATE.FAILED, OFFLINE_STATE.BLOCKED].includes(offlineState);
  }).length;

  const reasons = [];
  if (stale) reasons.push('recipe cache is older than 24h');
  if (missingTruthCount > 0) reasons.push(`${missingTruthCount} cached recipe truth record${missingTruthCount === 1 ? ' is' : 's are'} missing trust status`);
  if (missingFreshnessCount > 0) reasons.push(`${missingFreshnessCount} cached recipe${missingFreshnessCount === 1 ? '' : 's'} ${missingFreshnessCount === 1 ? 'is' : 'are'} missing freshness markers`);
  if (blockedCount > 0) reasons.push(`${blockedCount} cached recipe${blockedCount === 1 ? '' : 's'} ${blockedCount === 1 ? 'is' : 'are'} blocked or conflicted`);

  return {
    isDegraded: reasons.length > 0,
    reason: reasons.join('; '),
    stale,
    ageMs,
    missingTruthCount,
    missingFreshnessCount,
    blockedCount
  };
};

const buildCommandBoardCacheTrust = (cachePayload = {}) => {
  const boardTasks = Array.isArray(cachePayload?.payload?.boardTasks) ? cachePayload.payload.boardTasks : [];
  const ageMs = Math.max(0, Date.now() - new Date(cachePayload?.hydratedAt || 0).getTime());
  const stale = !Number.isFinite(ageMs) || ageMs > OFFLINE_CACHE_MAX_AGE_MS;
  const missingMetaCount = boardTasks.filter((task) => !String(task?.meta?.recipe_truth_status || '').trim()).length;
  const blockedMetaCount = boardTasks.filter((task) => {
    const truthStatus = normalizeScope(task?.meta?.recipe_truth_status);
    const offlineState = normalizeScope(task?.meta?.offline_sync_state);
    return truthStatus === 'blocked' || [OFFLINE_STATE.CONFLICT, OFFLINE_STATE.FAILED, OFFLINE_STATE.BLOCKED].includes(offlineState);
  }).length;

  const reasons = [];
  if (stale) reasons.push('command board cache is older than 24h');
  if (missingMetaCount > 0) reasons.push(`${missingMetaCount} cached board task${missingMetaCount === 1 ? '' : 's'} ${missingMetaCount === 1 ? 'is' : 'are'} missing recipe truth metadata`);
  if (blockedMetaCount > 0) reasons.push(`${blockedMetaCount} cached board task${blockedMetaCount === 1 ? '' : 's'} ${blockedMetaCount === 1 ? 'has' : 'have'} blocked recipe truth`);

  return {
    isDegraded: reasons.length > 0,
    reason: reasons.join('; '),
    stale,
    ageMs,
    missingMetaCount,
    blockedMetaCount
  };
};

const buildOfflineCacheTrust = (cachePayload = {}) => {
  const normalizedType = normalizeScope(cachePayload?.type);
  if (normalizedType === 'recipes') return buildRecipeCacheTrust(cachePayload);
  if (normalizedType === 'command-board') return buildCommandBoardCacheTrust(cachePayload);
  return {
    isDegraded: false,
    reason: '',
    stale: false,
    ageMs: Math.max(0, Date.now() - new Date(cachePayload?.hydratedAt || 0).getTime())
  };
};

export const getOfflineReadinessKey = ({ clientId, userId }) => {
  const normalizedClientId = normalizeScope(clientId);
  const normalizedUserId = normalizeScope(userId);

  if (!normalizedClientId || !normalizedUserId) return null;
  return `${OFFLINE_STORAGE.READINESS_PREFIX}:${normalizedClientId}:${normalizedUserId}`;
};

export const getOfflineReadinessIndexKey = (userId) => {
  const normalizedUserId = normalizeScope(userId);
  if (!normalizedUserId) return null;
  return `${OFFLINE_STORAGE.READINESS_INDEX_PREFIX}:${normalizedUserId}`;
};

export const getOfflineCacheKey = ({ clientId, type }) => {
  const normalizedClientId = normalizeScope(clientId);
  const normalizedType = normalizeScope(type);

  if (!normalizedClientId || !normalizedType) return null;
  return `${OFFLINE_STORAGE.CACHE_PREFIX}:${normalizedClientId}:${normalizedType}`;
};

export const saveOfflineReadiness = ({ clientId, userId, profileId, hydratedAt, profileSnapshot = {} }) => {
  const storage = safeStorage();
  const readinessKey = getOfflineReadinessKey({ clientId, userId });
  const indexKey = getOfflineReadinessIndexKey(userId);

  if (!storage || !readinessKey || !indexKey) {
    return { ok: false, reason: OFFLINE_BLOCK_REASONS.MISSING_CLIENT_SCOPE };
  }

  const payload = {
    version: OFFLINE_STORAGE.VERSION,
    clientId: normalizeScope(clientId),
    userId: normalizeScope(userId),
    profileId: profileId ? String(profileId) : null,
    hydratedAt: hydratedAt || new Date().toISOString(),
    profileSnapshot
  };

  storage.setItem(readinessKey, JSON.stringify(payload));
  storage.setItem(indexKey, JSON.stringify({
    version: OFFLINE_STORAGE.VERSION,
    clientId: payload.clientId,
    readinessKey,
    hydratedAt: payload.hydratedAt
  }));

  return { ok: true, readinessKey, payload };
};

export const readOfflineReadiness = ({ clientId, userId }) => {
  const storage = safeStorage();
  if (!storage) return null;

  const readinessKey = getOfflineReadinessKey({ clientId, userId });
  if (readinessKey) {
    const raw = storage.getItem(readinessKey);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (_error) {
        return null;
      }
    }
  }

  const indexKey = getOfflineReadinessIndexKey(userId);
  if (!indexKey) return null;

  const rawIndex = storage.getItem(indexKey);
  if (!rawIndex) return null;

  try {
    const parsedIndex = JSON.parse(rawIndex);
    if (!parsedIndex?.readinessKey) return null;
    const indexedRaw = storage.getItem(parsedIndex.readinessKey);
    if (!indexedRaw) return null;
    return JSON.parse(indexedRaw);
  } catch (_error) {
    return null;
  }
};

export const clearOfflineReadiness = ({ clientId, userId }) => {
  const storage = safeStorage();
  if (!storage) return false;

  const readinessKey = getOfflineReadinessKey({ clientId, userId });
  const indexKey = getOfflineReadinessIndexKey(userId);

  if (readinessKey) storage.removeItem(readinessKey);
  if (indexKey) storage.removeItem(indexKey);

  return true;
};

export const hasOfflineReadiness = ({ clientId, userId }) => {
  const readiness = readOfflineReadiness({ clientId, userId });
  return Boolean(readiness?.clientId && readiness?.userId);
};

export const buildOfflineLaunchProfile = (readiness, fallbackUserId) => {
  if (!readiness) return null;

  return {
    id: readiness.profileId || fallbackUserId || readiness.userId,
    client_id: readiness.clientId,
    role: readiness.profileSnapshot?.role || 'staff',
    full_name: readiness.profileSnapshot?.full_name || '',
    offline_ready: true,
    hydratedAt: readiness.hydratedAt,
    profileSnapshot: readiness.profileSnapshot || {}
  };
};

export const saveOfflineCache = ({ clientId, type, payload, hydratedAt }) => {
  const storage = safeStorage();
  const cacheKey = getOfflineCacheKey({ clientId, type });

  if (!storage || !cacheKey) {
    return { ok: false, reason: OFFLINE_BLOCK_REASONS.MISSING_CLIENT_SCOPE };
  }

  const cachePayload = {
    version: OFFLINE_STORAGE.VERSION,
    clientId: normalizeScope(clientId),
    type: normalizeScope(type),
    hydratedAt: hydratedAt || new Date().toISOString(),
    payload
  };

  storage.setItem(cacheKey, JSON.stringify(cachePayload));
  return { ok: true, cacheKey, payload: cachePayload };
};

export const readOfflineCache = ({ clientId, type }) => {
  const storage = safeStorage();
  const cacheKey = getOfflineCacheKey({ clientId, type });
  if (!storage || !cacheKey) return null;

  const raw = storage.getItem(cacheKey);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (
      parsed?.version !== OFFLINE_STORAGE.VERSION ||
      parsed?.clientId !== normalizeScope(clientId) ||
      parsed?.type !== normalizeScope(type)
    ) {
      return null;
    }
    return {
      ...parsed,
      trust: buildOfflineCacheTrust(parsed)
    };
  } catch (_error) {
    return null;
  }
};
