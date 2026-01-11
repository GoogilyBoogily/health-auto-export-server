import { CacheStorage } from './CacheStorage';
import { ObsidianStorage } from './obsidian';

// Parse retention days from env (default 7)
const retentionDays = Number.parseInt(process.env.CACHE_RETENTION_DAYS ?? '7', 10);

// Create cache storage instance with configured retention
export const cacheStorage = new CacheStorage(undefined, retentionDays);

// Backward compatibility alias
export const storage = cacheStorage;

// ObsidianStorage is initialized lazily after env validation
let obsidianStorageInstance: ObsidianStorage | undefined;

export function getObsidianStorage(): ObsidianStorage {
  if (!obsidianStorageInstance) {
    throw new Error('ObsidianStorage not initialized. Call initObsidianStorage() first.');
  }
  return obsidianStorageInstance;
}

export function initObsidianStorage(vaultPath: string): ObsidianStorage {
  obsidianStorageInstance = new ObsidianStorage(vaultPath);
  return obsidianStorageInstance;
}

export { CacheStorage } from './CacheStorage';
// Backward compatibility alias
export { CacheStorage as FileStorage } from './CacheStorage';
export { ObsidianStorage } from './obsidian';
