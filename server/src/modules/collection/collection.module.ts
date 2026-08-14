import { Module } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { BookModule } from '../book/book.module';
import { LibraryModule } from '../library/library.module';
import { AchievementModule } from '../achievement/achievement.module';
import { CollectionController } from './collection.controller';
import { CollectionPositionBackfillService } from './collection-position-backfill.service';
import { CollectionRepository } from './collection.repository';
import { CollectionService } from './collection.service';

@Module({
  imports: [AppSettingsModule, BookModule, LibraryModule, AchievementModule],
  controllers: [CollectionController],
  providers: [CollectionService, CollectionRepository, CollectionPositionBackfillService],
})
export class CollectionModule {}
