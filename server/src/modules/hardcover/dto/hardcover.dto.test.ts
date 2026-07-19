import { ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { UpsertHardcoverSettingsDto } from './hardcover.dto';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

describe('UpsertHardcoverSettingsDto', () => {
  it('accepts device progress sync settings through the global validation policy', async () => {
    const payload = { deviceProgressSyncEnabled: false, deviceProgressSyncDelayMinutes: 10 };

    await expect(pipe.transform(payload, { type: 'body', metatype: UpsertHardcoverSettingsDto })).resolves.toMatchObject(payload);
  });

  it.each([-1, 1441, 1.5])('rejects an invalid device progress delay of %s minutes', async (deviceProgressSyncDelayMinutes) => {
    await expect(pipe.transform({ deviceProgressSyncDelayMinutes }, { type: 'body', metatype: UpsertHardcoverSettingsDto })).rejects.toThrow();
  });
});
