import { type CampaignData, type CampaignRegistryEntry } from '../types/campaign.types.ts';
import {
  CAMPAIGN_DB_NAME,
  CAMPAIGN_DB_VERSION,
  INSTALLED_CAMPAIGNS_STORE,
  EDITOR_WORKSPACES_STORE
} from '../constants/campaign.constants.ts';

let dbInstance: IDBDatabase | null = null;

/**
 * Opens and initializes the IndexedDB database for campaigns.
 */
export function openCampaignDB(): Promise<IDBDatabase> {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CAMPAIGN_DB_NAME, CAMPAIGN_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Store for installed, playable campaigns. Key is manifest.id
      if (!db.objectStoreNames.contains(INSTALLED_CAMPAIGNS_STORE)) {
        db.createObjectStore(INSTALLED_CAMPAIGNS_STORE, { keyPath: 'manifest.id' });
      }

      // Store for editor workspaces in progress. Key is explicit 'id'
      if (!db.objectStoreNames.contains(EDITOR_WORKSPACES_STORE)) {
        db.createObjectStore(EDITOR_WORKSPACES_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = (event.target as IDBOpenDBRequest).result;

      // Handle generic errors globally
      dbInstance.onerror = (e) => {
        console.error('IndexedDB Error:', e);
      };

      resolve(dbInstance);
    };

    request.onerror = (event) => {
      const error = (event.target as IDBOpenDBRequest).error;
      console.warn('Failed to open IndexedDB. Campaign saving/installing may be disabled.', error);
      reject(error);
    };
  });
}

// =========================================================
// INSTALLED CAMPAIGNS (Player Facing)
// =========================================================

export async function installCampaign(data: CampaignData): Promise<void> {
  const db = await openCampaignDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(INSTALLED_CAMPAIGNS_STORE, 'readwrite');
    const store = transaction.objectStore(INSTALLED_CAMPAIGNS_STORE);
    const request = store.put(data);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function uninstallCampaign(campaignId: string): Promise<void> {
  const db = await openCampaignDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(INSTALLED_CAMPAIGNS_STORE, 'readwrite');
    const store = transaction.objectStore(INSTALLED_CAMPAIGNS_STORE);
    const request = store.delete(campaignId);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getInstalledCampaign(campaignId: string): Promise<CampaignData | undefined> {
  try {
    const db = await openCampaignDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(INSTALLED_CAMPAIGNS_STORE, 'readonly');
      const store = transaction.objectStore(INSTALLED_CAMPAIGNS_STORE);
      const request = store.get(campaignId);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn('Could not read from IndexedDB.', err);
    return undefined;
  }
}

export async function listInstalledCampaigns(): Promise<CampaignRegistryEntry[]> {
  try {
    const db = await openCampaignDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(INSTALLED_CAMPAIGNS_STORE, 'readonly');
      const store = transaction.objectStore(INSTALLED_CAMPAIGNS_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        const campaigns: CampaignData[] = request.result;
        const entries: CampaignRegistryEntry[] = campaigns.map((c) => ({
          id: c.manifest.id,
          name: c.manifest.name,
          description: c.manifest.description,
          version: c.manifest.version,
          mapSize: `${c.rules.map.width}x${c.rules.map.height}`,
          startingAreaId: c.rules.map.startingAreaId,
          source: 'installed',
          author: c.manifest.author ?? 'Unknown'
        }));
        resolve(entries);
      };

      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn('Could not list installed campaigns from IndexedDB.', err);
    return [];
  }
}

// =========================================================
// EDITOR WORKSPACES (Author Facing)
// =========================================================

/**
 * A database record representing a Campaign Creator workspace stored in IndexedDB.
 */
export interface WorkspaceRecord {
  readonly id: string;
  readonly name: string;
  readonly data: CampaignData;
  readonly lastModified: string;
}

export async function saveEditorWorkspace(workspaceId: string, data: CampaignData): Promise<void> {
  const db = await openCampaignDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(EDITOR_WORKSPACES_STORE, 'readwrite');
    const store = transaction.objectStore(EDITOR_WORKSPACES_STORE);

    const record: WorkspaceRecord = {
      id: workspaceId,
      name: data.manifest.name || 'Unnamed Workspace',
      data,
      lastModified: new Date().toISOString()
    };

    const request = store.put(record);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function loadEditorWorkspace(workspaceId: string): Promise<CampaignData | undefined> {
  try {
    const db = await openCampaignDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(EDITOR_WORKSPACES_STORE, 'readonly');
      const store = transaction.objectStore(EDITOR_WORKSPACES_STORE);
      const request = store.get(workspaceId);

      request.onsuccess = () => {
        const result = request.result as WorkspaceRecord | undefined;
        resolve(result?.data);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn('Could not read workspace from IndexedDB.', err);
    return undefined;
  }
}

export async function listEditorWorkspaces(): Promise<
  ReadonlyArray<{ id: string; name: string; lastModified: string }>
> {
  try {
    const db = await openCampaignDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(EDITOR_WORKSPACES_STORE, 'readonly');
      const store = transaction.objectStore(EDITOR_WORKSPACES_STORE);
      // We only need metadata, but getAll fetches everything.
      // For a few workspaces this is fine. If it grows, we might need a separate metadata store or index cursor.
      const request = store.getAll();

      request.onsuccess = () => {
        const records: WorkspaceRecord[] = request.result;
        resolve(
          records.map((r) => ({
            id: r.id,
            name: r.name,
            lastModified: r.lastModified
          }))
        );
      };

      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn('Could not list workspaces from IndexedDB.', err);
    return [];
  }
}

export async function deleteEditorWorkspace(workspaceId: string): Promise<void> {
  const db = await openCampaignDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(EDITOR_WORKSPACES_STORE, 'readwrite');
    const store = transaction.objectStore(EDITOR_WORKSPACES_STORE);
    const request = store.delete(workspaceId);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
