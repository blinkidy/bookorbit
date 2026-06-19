export type HardcoverSyncDisabledReason = "permission_denied" | "missing_token" | "user_disabled";

export interface HardcoverSettings {
  tokenConfigured: boolean;
  enabled: boolean;
  effectiveEnabled: boolean;
  disabledReason: HardcoverSyncDisabledReason | null;
  autoSyncOnStatusChange: boolean;
  autoSyncOnProgressUpdate: boolean;
  autoSyncOnRatingChange: boolean;
  privacySettingId: number;
  lastSyncedAt: string | null;
}

export interface UpsertHardcoverSettingsPayload {
  apiToken?: string;
  enabled?: boolean;
  autoSyncOnStatusChange?: boolean;
  autoSyncOnProgressUpdate?: boolean;
  autoSyncOnRatingChange?: boolean;
  privacySettingId?: number;
}

export interface HardcoverTokenValidationResult {
  valid: boolean;
  hardcoverUsername?: string;
}

export type HardcoverSyncRunStatus = "running" | "completed" | "failed" | "cancelled";

export interface HardcoverSyncPendingSummary {
  totalBooks: number;
  pendingBooks: number;
}

export interface HardcoverActiveSyncStatus {
  runId: number;
  syncedBooks: number;
  totalBooks: number;
  status: HardcoverSyncRunStatus;
}

export type HardcoverPrivacySetting = 1 | 2 | 3;

export interface HardcoverEdition {
  id: number;
  format: string;
  pages: number | null;
  audioSeconds: number | null;
  isAudio: boolean;
  year: number | null;
}

export interface HardcoverLinkedBook {
  bookId: number;
  title: string | null;
  authorName: string | null;
  hardcoverBookId: number | null;
  hardcoverEditionId: number | null;
  matchMethod: string | null;
  matchError: string | null;
}

export interface HardcoverLinkResult {
  success: boolean;
  hardcoverBookId?: number;
  title?: string;
}
