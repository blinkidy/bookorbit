import { Permission } from '@bookorbit/types';
import { Body, Controller, Delete, Get, MessageEvent, Param, ParseIntPipe, Patch, Post, Sse } from '@nestjs/common';
import { map, Observable } from 'rxjs';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { UpsertStorygraphSettingsDto, ValidateStorygraphCookiesDto } from './dto';
import { StorygraphSettingsService } from './storygraph-settings.service';
import { StorygraphSyncService } from './storygraph-sync.service';

@Controller('storygraph')
@RequirePermission(Permission.StorygraphSync)
export class StorygraphController {
  constructor(
    private readonly settingsService: StorygraphSettingsService,
    private readonly syncService: StorygraphSyncService,
  ) {}

  @Get('settings')
  getSettings(@CurrentUser() user: RequestUser) {
    return this.settingsService.getSettings(user.id);
  }

  @Patch('settings')
  upsertSettings(@CurrentUser() user: RequestUser, @Body() dto: UpsertStorygraphSettingsDto) {
    return this.settingsService.upsertSettings(user.id, dto);
  }

  @Delete('settings')
  disconnectUser(@CurrentUser() user: RequestUser) {
    return this.settingsService.disconnectUser(user.id);
  }

  @Post('validate-cookies')
  validateCookies(@CurrentUser() user: RequestUser, @Body() dto: ValidateStorygraphCookiesDto) {
    return this.settingsService.validateCookies(user.id, dto.sessionCookie, dto.rememberToken);
  }

  @Post('sync')
  startSync(@CurrentUser() user: RequestUser) {
    return this.syncService.syncAll(user.id).then((runId) => ({ runId }));
  }

  @Delete('sync')
  cancelSync(@CurrentUser() user: RequestUser) {
    return this.syncService.cancelSync(user.id);
  }

  @Get('sync/status')
  getSyncStatus(@CurrentUser() user: RequestUser) {
    return this.syncService.getSyncStatus(user.id);
  }

  @Sse('sync/stream')
  getSyncStatusStream(@CurrentUser() user: RequestUser): Observable<MessageEvent> {
    return this.syncService.streamSyncStatus(user.id).pipe(map((status) => ({ data: { activeSyncStatus: status } })));
  }

  @Get('sync/pending')
  getSyncPendingSummary(@CurrentUser() user: RequestUser) {
    return this.syncService.getSyncPendingSummary(user.id);
  }

  @Post('books/:bookId/rematch')
  rematchBook(@CurrentUser() user: RequestUser, @Param('bookId', ParseIntPipe) bookId: number) {
    return this.syncService.rematchBook(user.id, bookId).then((result) => ({ result }));
  }
}
