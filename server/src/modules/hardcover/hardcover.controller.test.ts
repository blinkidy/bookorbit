import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of } from 'rxjs';

import { HardcoverController } from './hardcover.controller';

const mockSettingsService = {
  getSettings: vi.fn(),
  upsertSettings: vi.fn(),
  disconnectUser: vi.fn(),
  validateToken: vi.fn(),
};

const mockSyncService = {
  syncAll: vi.fn(),
  cancelSync: vi.fn(),
  getSyncStatus: vi.fn(),
  streamSyncStatus: vi.fn(),
  getSyncPendingSummary: vi.fn(),
  rematchBook: vi.fn(),
  listLinkedBooks: vi.fn(),
  linkBookManually: vi.fn(),
  listEditions: vi.fn(),
  setEdition: vi.fn(),
};

const mockUser = { id: 1, isSuperuser: false, permissions: [] };

function makeController() {
  return new HardcoverController(mockSettingsService as any, mockSyncService as any);
}

describe('HardcoverController', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getSettings delegates to service', async () => {
    mockSettingsService.getSettings.mockResolvedValue({ tokenConfigured: false });
    const result = await makeController().getSettings(mockUser as any);
    expect(result).toEqual({ tokenConfigured: false });
    expect(mockSettingsService.getSettings).toHaveBeenCalledWith(1);
  });

  it('upsertSettings delegates to service', async () => {
    mockSettingsService.upsertSettings.mockResolvedValue({ tokenConfigured: true });
    const result = await makeController().upsertSettings(mockUser as any, { apiToken: 'tok' });
    expect(result).toEqual({ tokenConfigured: true });
  });

  it('disconnectUser delegates to service', async () => {
    mockSettingsService.disconnectUser.mockResolvedValue(undefined);
    await makeController().disconnectUser(mockUser as any);
    expect(mockSettingsService.disconnectUser).toHaveBeenCalledWith(1);
  });

  it('validateToken delegates to service', async () => {
    mockSettingsService.validateToken.mockResolvedValue({ valid: true, hardcoverUsername: 'neon' });
    const result = await makeController().validateToken(mockUser as any, {});
    expect(result).toEqual({ valid: true, hardcoverUsername: 'neon' });
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

  it('rematchBook delegates to service and wraps the result', async () => {
    mockSyncService.rematchBook.mockResolvedValue('synced');
    const result = await makeController().rematchBook(mockUser as any, 42);
    expect(result).toEqual({ result: 'synced' });
    expect(mockSyncService.rematchBook).toHaveBeenCalledWith(1, 42);
  });

  it('listLinkedBooks delegates to service', async () => {
    mockSyncService.listLinkedBooks.mockResolvedValue([{ bookId: 1 }]);
    const result = await makeController().listLinkedBooks(mockUser as any);
    expect(result).toEqual([{ bookId: 1 }]);
    expect(mockSyncService.listLinkedBooks).toHaveBeenCalledWith(1);
  });

  it('linkBookManually delegates to service', async () => {
    mockSyncService.linkBookManually.mockResolvedValue({ success: true, hardcoverBookId: 700, title: 'Fyrebirds' });
    const result = await makeController().linkBookManually(mockUser as any, 42, { input: '700' });
    expect(result).toEqual({ success: true, hardcoverBookId: 700, title: 'Fyrebirds' });
    expect(mockSyncService.linkBookManually).toHaveBeenCalledWith(1, 42, '700');
  });

  it('listEditions delegates to service', async () => {
    mockSyncService.listEditions.mockResolvedValue([{ id: 901 }]);
    const result = await makeController().listEditions(mockUser as any, 42);
    expect(result).toEqual([{ id: 901 }]);
    expect(mockSyncService.listEditions).toHaveBeenCalledWith(1, 42);
  });

  it('setEdition delegates to service', async () => {
    mockSyncService.setEdition.mockResolvedValue({ success: true });
    const result = await makeController().setEdition(mockUser as any, 42, { editionId: 901 });
    expect(result).toEqual({ success: true });
    expect(mockSyncService.setEdition).toHaveBeenCalledWith(1, 42, 901);
  });
});
