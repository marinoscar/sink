import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EntriesService } from '../entries/entries.service';
import { SyncConfigService } from './sync-config.service';
import { GoogleCalendarClient } from './google-calendar.client';
import { mapToGoogleEvent, CalendarEntryData } from './event-mapper';
import { SyncLogResponseDto } from './dto/sync-log-response.dto';

@Injectable()
export class CalendarSyncService {
  private readonly logger = new Logger(CalendarSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly entriesService: EntriesService,
    private readonly syncConfigService: SyncConfigService,
    private readonly googleClient: GoogleCalendarClient,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Performs an incremental sync for a single user:
   * - Fetches all pending CalendarEntry records
   * - Creates/updates/deletes corresponding Google Calendar events
   * - Records a CalendarSyncLog with the outcome
   */
  async syncUser(userId: string): Promise<SyncLogResponseDto> {
    const config = await this.prisma.calendarSyncConfig.findUnique({
      where: { userId },
    });

    if (!config || !config.encryptedRefreshToken) {
      throw new BadRequestException('Calendar sync not configured or not connected to Google');
    }

    const startedAt = new Date();
    let entriesCreated = 0;
    let entriesUpdated = 0;
    let entriesDeleted = 0;
    const errors: Array<{ entryId: string; error: string }> = [];

    try {
      // Set up Google Calendar API client
      const refreshToken = await this.syncConfigService.getDecryptedRefreshToken(userId);
      if (!refreshToken) {
        throw new Error('Could not decrypt refresh token');
      }

      const clientId = this.configService.get<string>('google.clientId')!;
      const clientSecret = this.configService.get<string>('google.clientSecret')!;

      const oauth2Client = this.googleClient.createOAuth2Client(
        clientId,
        clientSecret,
        '',
      );
      oauth2Client.setCredentials({ refresh_token: refreshToken });
      const calendar = this.googleClient.getCalendarApi(oauth2Client);

      // Fetch all pending entries for this user
      const pendingEntries = await this.entriesService.getPendingSync(userId);

      if (pendingEntries.length === 0) {
        const log = await this.createLog(
          config.id,
          userId,
          startedAt,
          'no_changes',
          0, 0, 0, 0,
        );
        await this.updateConfigLastSync(config.id, 'no_changes');
        this.logger.log(`Calendar sync for user ${userId}: no changes`);
        return log;
      }

      // Process each pending entry
      for (const entry of pendingEntries) {
        try {
          const data = entry.data as unknown as CalendarEntryData;

          if (entry.isDeleted && entry.googleEventId) {
            // Event was deleted locally - remove from Google
            await this.googleClient.deleteEvent(
              calendar,
              config.calendarId,
              entry.googleEventId,
            );
            await this.entriesService.markSyncDeleted(entry.id);
            entriesDeleted++;
          } else if (!entry.isDeleted && entry.googleEventId) {
            // Event changed - update existing Google event
            const event = mapToGoogleEvent(entry.entryId, entry.id, data);
            await this.googleClient.updateEvent(
              calendar,
              config.calendarId,
              entry.googleEventId,
              event,
            );
            await this.entriesService.markSynced(entry.id, entry.googleEventId);
            entriesUpdated++;
          } else if (!entry.isDeleted && !entry.googleEventId) {
            // New event - create in Google
            const event = mapToGoogleEvent(entry.entryId, entry.id, data);
            const googleEventId = await this.googleClient.createEvent(
              calendar,
              config.calendarId,
              event,
            );
            await this.entriesService.markSynced(entry.id, googleEventId);
            entriesCreated++;
          } else if (entry.isDeleted && !entry.googleEventId) {
            // Was never synced to Google - just mark as deleted locally
            await this.entriesService.markSyncDeleted(entry.id);
            entriesDeleted++;
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Unknown error';

          // If this is an auth error, no point continuing - all entries will fail
          if (this.isTokenRevocationError(err)) {
            throw err; // Let the outer catch handle it
          }

          errors.push({ entryId: entry.id, error: errorMsg });
          this.logger.warn(`Failed to sync entry ${entry.id}: ${errorMsg}`);
        }
      }

      const status = errors.length > 0 ? 'error' : 'success';
      const totalProcessed =
        entriesCreated + entriesUpdated + entriesDeleted + errors.length;

      const log = await this.createLog(
        config.id,
        userId,
        startedAt,
        status,
        totalProcessed,
        entriesCreated,
        entriesUpdated,
        entriesDeleted,
        errors.length > 0 ? `${errors.length} entries failed` : null,
        errors.length > 0 ? errors : null,
      );

      await this.updateConfigLastSync(config.id, status);

      this.logger.log(
        `Calendar sync for user ${userId}: ${entriesCreated} created, ` +
          `${entriesUpdated} updated, ${entriesDeleted} deleted, ${errors.length} errors`,
      );

      return log;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';

      // Detect token revocation / auth errors and auto-disable sync
      const isAuthError = this.isTokenRevocationError(err);
      if (isAuthError) {
        this.logger.warn(
          `Google token revoked for user ${userId}, disabling sync. User must reconnect.`,
        );
        await this.syncConfigService.disableWithReason(userId, 'token_revoked');
      }

      const log = await this.createLog(
        config.id,
        userId,
        startedAt,
        isAuthError ? 'auth_error' : 'error',
        0, 0, 0, 0,
        isAuthError
          ? 'Google authorization revoked. Please reconnect your Google Calendar account.'
          : errorMsg,
      );

      await this.updateConfigLastSync(config.id, isAuthError ? 'auth_error' : 'error');

      this.logger.error(
        `Calendar sync failed for user ${userId}: ${errorMsg}`,
      );

      return log;
    }
  }

  /**
   * Async variant of syncUser for use by the manual trigger endpoint.
   * Creates an initial log record with status 'running', returns it immediately
   * to the caller, then fires the actual sync in the background via setImmediate.
   */
  async syncUserAsync(userId: string): Promise<SyncLogResponseDto> {
    const config = await this.prisma.calendarSyncConfig.findUnique({
      where: { userId },
    });

    if (!config || !config.encryptedRefreshToken) {
      throw new BadRequestException(
        'Calendar sync not configured or not connected to Google',
      );
    }

    const startedAt = new Date();

    // Create the initial "running" log record
    const runningLog = await this.prisma.calendarSyncLog.create({
      data: {
        configId: config.id,
        userId,
        startedAt,
        completedAt: null,
        status: 'running',
        entriesProcessed: 0,
        entriesCreated: 0,
        entriesUpdated: 0,
        entriesDeleted: 0,
        errorMessage: null,
        errorDetails: Prisma.DbNull,
      },
    });

    // Fire actual sync in the background after this tick returns
    setImmediate(() => {
      this.executeSyncRun(runningLog.id, userId).catch((err) => {
        this.logger.error(
          `Unhandled error in background executeSyncRun for user ${userId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    });

    return {
      id: runningLog.id,
      startedAt: runningLog.startedAt.toISOString(),
      completedAt: null,
      status: runningLog.status,
      entriesProcessed: 0,
      entriesCreated: 0,
      entriesUpdated: 0,
      entriesDeleted: 0,
      errorMessage: null,
      errorDetails: null,
    };
  }

  /**
   * Executes the full sync run for a user and updates an existing log record
   * (identified by logId) with the final outcome. Called by syncUserAsync in
   * the background via setImmediate.
   */
  private async executeSyncRun(logId: string, userId: string): Promise<void> {
    const config = await this.prisma.calendarSyncConfig.findUnique({
      where: { userId },
    });

    // Guard: config may have been removed between the async trigger and this tick
    if (!config || !config.encryptedRefreshToken) {
      await this.prisma.calendarSyncLog.update({
        where: { id: logId },
        data: {
          status: 'error',
          completedAt: new Date(),
          errorMessage: 'Sync config missing or token disconnected at execution time',
        },
      });
      return;
    }

    let entriesCreated = 0;
    let entriesUpdated = 0;
    let entriesDeleted = 0;
    const errors: Array<{ entryId: string; error: string }> = [];

    try {
      // Set up Google Calendar API client
      const refreshToken =
        await this.syncConfigService.getDecryptedRefreshToken(userId);
      if (!refreshToken) {
        throw new Error('Could not decrypt refresh token');
      }

      const clientId = this.configService.get<string>('google.clientId')!;
      const clientSecret = this.configService.get<string>('google.clientSecret')!;

      const oauth2Client = this.googleClient.createOAuth2Client(
        clientId,
        clientSecret,
        '',
      );
      oauth2Client.setCredentials({ refresh_token: refreshToken });
      const calendar = this.googleClient.getCalendarApi(oauth2Client);

      // Fetch all pending entries for this user
      const pendingEntries = await this.entriesService.getPendingSync(userId);

      if (pendingEntries.length === 0) {
        await this.prisma.calendarSyncLog.update({
          where: { id: logId },
          data: {
            status: 'no_changes',
            completedAt: new Date(),
            entriesProcessed: 0,
            entriesCreated: 0,
            entriesUpdated: 0,
            entriesDeleted: 0,
          },
        });
        await this.updateConfigLastSync(config.id, 'no_changes');
        this.logger.log(`Calendar sync for user ${userId}: no changes`);
        return;
      }

      // Process each pending entry
      for (const entry of pendingEntries) {
        try {
          const data = entry.data as unknown as CalendarEntryData;

          if (entry.isDeleted && entry.googleEventId) {
            await this.googleClient.deleteEvent(
              calendar,
              config.calendarId,
              entry.googleEventId,
            );
            await this.entriesService.markSyncDeleted(entry.id);
            entriesDeleted++;
          } else if (!entry.isDeleted && entry.googleEventId) {
            const event = mapToGoogleEvent(entry.entryId, entry.id, data);
            await this.googleClient.updateEvent(
              calendar,
              config.calendarId,
              entry.googleEventId,
              event,
            );
            await this.entriesService.markSynced(entry.id, entry.googleEventId);
            entriesUpdated++;
          } else if (!entry.isDeleted && !entry.googleEventId) {
            const event = mapToGoogleEvent(entry.entryId, entry.id, data);
            const googleEventId = await this.googleClient.createEvent(
              calendar,
              config.calendarId,
              event,
            );
            await this.entriesService.markSynced(entry.id, googleEventId);
            entriesCreated++;
          } else if (entry.isDeleted && !entry.googleEventId) {
            await this.entriesService.markSyncDeleted(entry.id);
            entriesDeleted++;
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Unknown error';

          if (this.isTokenRevocationError(err)) {
            throw err;
          }

          errors.push({ entryId: entry.id, error: errorMsg });
          this.logger.warn(`Failed to sync entry ${entry.id}: ${errorMsg}`);
        }
      }

      const status = errors.length > 0 ? 'error' : 'success';
      const totalProcessed =
        entriesCreated + entriesUpdated + entriesDeleted + errors.length;

      await this.prisma.calendarSyncLog.update({
        where: { id: logId },
        data: {
          status,
          completedAt: new Date(),
          entriesProcessed: totalProcessed,
          entriesCreated,
          entriesUpdated,
          entriesDeleted,
          errorMessage:
            errors.length > 0 ? `${errors.length} entries failed` : null,
          errorDetails: errors.length > 0 ? (errors as any) : null,
        },
      });

      await this.updateConfigLastSync(config.id, status);
      await this.pruneOldLogs(userId, 300);

      this.logger.log(
        `Calendar sync for user ${userId}: ${entriesCreated} created, ` +
          `${entriesUpdated} updated, ${entriesDeleted} deleted, ${errors.length} errors`,
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      const isAuthError = this.isTokenRevocationError(err);

      if (isAuthError) {
        this.logger.warn(
          `Google token revoked for user ${userId}, disabling sync. User must reconnect.`,
        );
        await this.syncConfigService.disableWithReason(userId, 'token_revoked');
      }

      await this.prisma.calendarSyncLog.update({
        where: { id: logId },
        data: {
          status: isAuthError ? 'auth_error' : 'error',
          completedAt: new Date(),
          entriesProcessed: 0,
          entriesCreated: 0,
          entriesUpdated: 0,
          entriesDeleted: 0,
          errorMessage: isAuthError
            ? 'Google authorization revoked. Please reconnect your Google Calendar account.'
            : errorMsg,
        },
      });

      await this.updateConfigLastSync(
        config.id,
        isAuthError ? 'auth_error' : 'error',
      );

      this.logger.error(
        `Calendar sync failed for user ${userId}: ${errorMsg}`,
      );
    }
  }

  /**
   * Detects Google OAuth token revocation errors.
   * These indicate the refresh token is no longer valid and the user
   * must re-authorize via the consent screen.
   */
  private isTokenRevocationError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const message = err.message.toLowerCase();
    // Google returns these for revoked/expired refresh tokens
    return (
      message.includes('invalid_grant') ||
      message.includes('token has been expired or revoked') ||
      message.includes('token has been revoked') ||
      message.includes('refresh token is invalid') ||
      message.includes('unauthorized_client')
    );
  }

  private async createLog(
    configId: string,
    userId: string,
    startedAt: Date,
    status: string,
    entriesProcessed: number,
    entriesCreated: number,
    entriesUpdated: number,
    entriesDeleted: number,
    errorMessage: string | null = null,
    errorDetails: unknown = null,
  ): Promise<SyncLogResponseDto> {
    const completedAt = new Date();

    const log = await this.prisma.calendarSyncLog.create({
      data: {
        configId,
        userId,
        startedAt,
        completedAt,
        status,
        entriesProcessed,
        entriesCreated,
        entriesUpdated,
        entriesDeleted,
        errorMessage,
        errorDetails: errorDetails as any,
      },
    });

    await this.pruneOldLogs(userId, 300);

    return {
      id: log.id,
      startedAt: log.startedAt.toISOString(),
      completedAt: log.completedAt?.toISOString() ?? null,
      status: log.status,
      entriesProcessed: log.entriesProcessed,
      entriesCreated: log.entriesCreated,
      entriesUpdated: log.entriesUpdated,
      entriesDeleted: log.entriesDeleted,
      errorMessage: log.errorMessage,
      errorDetails: log.errorDetails,
    };
  }

  /**
   * Deletes logs beyond the most recent maxEntries for the given user.
   * Uses the startedAt timestamp of the Nth most recent log as the cutoff,
   * removing all older records strictly before that timestamp.
   */
  private async pruneOldLogs(userId: string, maxEntries: number): Promise<void> {
    const cutoffLog = await this.prisma.calendarSyncLog.findFirst({
      where: { userId },
      orderBy: { startedAt: 'desc' },
      skip: maxEntries - 1,
      select: { startedAt: true },
    });
    if (cutoffLog) {
      await this.prisma.calendarSyncLog.deleteMany({
        where: { userId, startedAt: { lt: cutoffLog.startedAt } },
      });
    }
  }

  private async updateConfigLastSync(
    configId: string,
    status: string,
  ): Promise<void> {
    await this.prisma.calendarSyncConfig.update({
      where: { id: configId },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: status,
      },
    });
  }
}
