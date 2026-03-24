import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
