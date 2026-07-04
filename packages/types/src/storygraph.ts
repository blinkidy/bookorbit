export type StorygraphSyncDisabledReason = "permission_denied" | "missing_cookies" | "user_disabled";

export interface StorygraphSettings {
  cookiesConfigured: boolean;
  enabled: boolean;
  effectiveEnabled: boolean;
  disabledReason: StorygraphSyncDisabledReason | null;
  autoSyncOnStatusChange: boolean;
  autoSyncOnProgressUpdate: boolean;
  lastSyncedAt: string | null;
  connectedAt: string | null;
}

export interface UpsertStorygraphSettingsPayload {
  sessionCookie?: string;
  rememberToken?: string;
  enabled?: boolean;
  autoSyncOnStatusChange?: boolean;
  autoSyncOnProgressUpdate?: boolean;
}

export interface StorygraphCookieValidationResult {
  valid: boolean;
}

export type StorygraphSyncRunStatus = "running" | "completed" | "failed" | "cancelled";

export interface StorygraphSyncPendingSummary {
  totalBooks: number;
  pendingBooks: number;
}

export interface StorygraphActiveSyncStatus {
  runId: number;
  syncedBooks: number;
  totalBooks: number;
  status: StorygraphSyncRunStatus;
}

export interface StorygraphEdition {
  id: string;
  title: string;
  format: string;
  pages: number | null;
  isAudio: boolean;
  language: string | null;
}

export interface StorygraphLinkedBook {
  bookId: number;
  title: string | null;
  authorName: string | null;
  storygraphBookId: string | null;
  matchMethod: string | null;
  matchError: string | null;
}

export interface StorygraphLinkResult {
  success: boolean;
  storygraphBookId?: string;
  title?: string;
}
