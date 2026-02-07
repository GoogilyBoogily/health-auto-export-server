import { CacheConfig } from '../config';
import { CacheStorage } from './CacheStorage';
import { ObsidianStorage } from './obsidian';

// Create cache storage instance with configured retention
export const cacheStorage = new CacheStorage(undefined, CacheConfig.retentionDays);

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
