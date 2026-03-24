import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CalendarSyncService } from '../sync.service';
import { SyncConfigService } from '../sync-config.service';

@Injectable()
export class CalendarSyncTask {
  private readonly logger = new Logger(CalendarSyncTask.name);

  constructor(
    private readonly syncService: CalendarSyncService,
    private readonly syncConfigService: SyncConfigService,
  ) {}

  /**
   * Runs every minute and triggers syncs for any users whose sync interval has elapsed.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleSync(): Promise<void> {
    const configs = await this.syncConfigService.getConfigsNeedingSync();

    if (configs.length === 0) {
      return;
    }

    this.logger.log(`Processing ${configs.length} calendar sync(s)`);

    for (const config of configs) {
      try {
        await this.syncService.syncUser(config.userId);
      } catch (err) {
        this.logger.error(
          `Sync failed for user ${config.userId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }
}
