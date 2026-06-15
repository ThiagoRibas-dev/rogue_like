/** Current schema version of the CampaignData structure. Bump on breaking changes. */
export const CURRENT_SCHEMA_VERSION = 1 as const;

/** The IndexedDB database name for campaign storage. */
export const CAMPAIGN_DB_NAME = 'roguelike_campaigns' as const;

/** The IndexedDB database version (bump when adding/removing object stores). */
export const CAMPAIGN_DB_VERSION = 1 as const;

/** Object store name for campaigns installed from ZIP by the player. */
export const INSTALLED_CAMPAIGNS_STORE = 'installed_campaigns' as const;

/** Object store name for editor workspace drafts. */
export const EDITOR_WORKSPACES_STORE = 'editor_workspaces' as const;
