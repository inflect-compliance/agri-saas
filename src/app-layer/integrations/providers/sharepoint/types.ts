/**
 * Microsoft Graph SharePoint types (SP-1).
 *
 * Minimal, hand-typed shapes for the Graph SharePoint surface IC uses — we only
 * model the fields we read, not the full Graph schema. All optional where Graph
 * may omit them so the client/mapper stay defensive.
 *
 * @module integrations/providers/sharepoint/types
 */

/** A Graph `site` resource (a SharePoint site collection / subsite). */
export interface SpSite {
    id: string;
    displayName?: string;
    name?: string;
    webUrl?: string;
}

/** A Graph `drive` resource (a SharePoint document library). */
export interface SpDrive {
    id: string;
    name?: string;
    driveType?: string;
    webUrl?: string;
}

/** A Graph `driveItem` resource (a folder or file in a library). */
export interface SpDriveItem {
    id: string;
    name?: string;
    webUrl?: string;
    /** Changes on content OR metadata edits. */
    eTag?: string;
    /** Content tag — changes ONLY on content edits (preferred for change-detection). */
    cTag?: string;
    size?: number;
    lastModifiedDateTime?: string;
    /** Present on folders. */
    folder?: { childCount?: number };
    /** Present on files. */
    file?: { mimeType?: string };
    /** Present on a delta page when the item was removed. */
    deleted?: { state?: string };
    parentReference?: { driveId?: string; id?: string; path?: string };
}

/** A page of children with the Graph cursor for the next page. */
export interface SpChildrenPage {
    items: SpDriveItem[];
    nextLink?: string;
}

/** A delta page: changed items plus the opaque token for the next delta query. */
export interface SpDeltaPage {
    items: SpDriveItem[];
    /** Opaque token to pass to the next `getDelta` for incremental change. */
    deltaToken?: string;
}

/** A Graph change-notification subscription (SP-4). */
export interface SpSubscription {
    id: string;
    resource?: string;
    expirationDateTime?: string;
    notificationUrl?: string;
    clientState?: string;
}
