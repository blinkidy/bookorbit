import { ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { UpsertStorygraphSettingsDto } from './storygraph.dto';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

describe('UpsertStorygraphSettingsDto', () => {
  it('accepts device progress sync settings through the global validation policy', async () => {
    const payload = { deviceProgressSyncEnabled: false, deviceProgressSyncDelayMinutes: 10 };

    await expect(pipe.transform(payload, { type: 'body', metatype: UpsertStorygraphSettingsDto })).resolves.toMatchObject(payload);
  });

  it.each([-1, 1441, 1.5])('rejects an invalid device progress delay of %s minutes', async (deviceProgressSyncDelayMinutes) => {
    await expect(pipe.transform({ deviceProgressSyncDelayMinutes }, { type: 'body', metatype: UpsertStorygraphSettingsDto })).rejects.toThrow();
  });
});
