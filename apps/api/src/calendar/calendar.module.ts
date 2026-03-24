import { Module } from '@nestjs/common';
import { EntriesController } from './entries/entries.controller';
import { EntriesService } from './entries/entries.service';
import { SyncConfigService } from './sync/sync-config.service';
import { CalendarSyncService } from './sync/sync.service';
import { GoogleCalendarClient } from './sync/google-calendar.client';
import { SyncAuthController } from './sync/sync-auth.controller';
import { SyncController } from './sync/sync.controller';
import { CalendarSyncTask } from './sync/tasks/calendar-sync.task';

@Module({
  controllers: [EntriesController, SyncAuthController, SyncController],
  providers: [
    EntriesService,
    SyncConfigService,
    CalendarSyncService,
    GoogleCalendarClient,
    CalendarSyncTask,
  ],
  exports: [EntriesService, SyncConfigService, CalendarSyncService],
})
export class CalendarModule {}
