import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of } from 'rxjs';

import { StorygraphController } from './storygraph.controller';

const mockSettingsService = {
  getSettings: vi.fn(),
  upsertSettings: vi.fn(),
  disconnectUser: vi.fn(),
  validateCookies: vi.fn(),
};

const mockSyncService = {
  syncAll: vi.fn(),
  cancelSync: vi.fn(),
  getSyncStatus: vi.fn(),
  streamSyncStatus: vi.fn(),
  getSyncPendingSummary: vi.fn(),
};

const mockUser = { id: 1, isSuperuser: false, permissions: [] };

function makeController() {
  return new StorygraphController(mockSettingsService as any, mockSyncService as any);
}

describe('StorygraphController', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getSettings delegates to service', async () => {
    mockSettingsService.getSettings.mockResolvedValue({ cookiesConfigured: false });
    const result = await makeController().getSettings(mockUser as any);
    expect(result).toEqual({ cookiesConfigured: false });
    expect(mockSettingsService.getSettings).toHaveBeenCalledWith(1);
  });

  it('upsertSettings delegates to service', async () => {
    mockSettingsService.upsertSettings.mockResolvedValue({ cookiesConfigured: true });
    const result = await makeController().upsertSettings(mockUser as any, { sessionCookie: 'sess', rememberToken: 'remember' });
    expect(result).toEqual({ cookiesConfigured: true });
  });

  it('disconnectUser delegates to service', async () => {
    mockSettingsService.disconnectUser.mockResolvedValue(undefined);
    await makeController().disconnectUser(mockUser as any);
    expect(mockSettingsService.disconnectUser).toHaveBeenCalledWith(1);
  });

  it('validateCookies delegates to service', async () => {
    mockSettingsService.validateCookies.mockResolvedValue({ valid: true });
    const result = await makeController().validateCookies(mockUser as any, { sessionCookie: 'sess', rememberToken: 'remember' });
    expect(result).toEqual({ valid: true });
    expect(mockSettingsService.validateCookies).toHaveBeenCalledWith(1, 'sess', 'remember');
  });

  it('startSync returns runId', async () => {
    mockSyncService.syncAll.mockResolvedValue(42);
    const result = await makeController().startSync(mockUser as any);
    expect(result).toEqual({ runId: 42 });
  });

  it('getSyncStatus delegates to service', () => {
    mockSyncService.getSyncStatus.mockReturnValue(null);
    const result = makeController().getSyncStatus(mockUser as any);
    expect(result).toBeNull();
  });

  it('getSyncStatusStream delegates to service', async () => {
    mockSyncService.streamSyncStatus.mockReturnValue(of(null));
    const stream = makeController().getSyncStatusStream(mockUser as any);
    const emitted = await new Promise((resolve) => stream.subscribe((event) => resolve(event)));
    expect(emitted).toEqual({ data: { activeSyncStatus: null } });
    expect(mockSyncService.streamSyncStatus).toHaveBeenCalledWith(1);
  });

  it('getSyncPendingSummary delegates to service', async () => {
    mockSyncService.getSyncPendingSummary.mockResolvedValue({ totalBooks: 10, pendingBooks: 2 });
    const result = await makeController().getSyncPendingSummary(mockUser as any);
    expect(result).toEqual({ totalBooks: 10, pendingBooks: 2 });
    expect(mockSyncService.getSyncPendingSummary).toHaveBeenCalledWith(1);
  });
});
