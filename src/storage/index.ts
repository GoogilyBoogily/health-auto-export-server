import { ObsidianStorage } from './obsidian';

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

export { ObsidianStorage } from './obsidian';
