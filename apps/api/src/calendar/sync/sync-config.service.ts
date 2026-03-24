import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CalendarSyncConfig, CalendarSyncLog } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { encrypt, decrypt } from './crypto.util';
import { UpdateSyncConfigDto, SyncConfigResponseDto } from './dto/sync-config.dto';
import { SyncLogResponseDto, SyncLogsListResponseDto } from './dto/sync-log-response.dto';

@Injectable()
export class SyncConfigService {
  private readonly logger = new Logger(SyncConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getConfig(userId: string): Promise<SyncConfigResponseDto> {
    const config = await this.prisma.calendarSyncConfig.findUnique({
      where: { userId },
    });

    if (!config) {
      // Return defaults when no config exists yet
      return {
        enabled: false,
        calendarId: 'primary',
        syncFrequencyMinutes: 60,
        googleEmail: null,
        isConnected: false,
        lastSyncAt: null,
        lastSyncStatus: null,
      };
    }

    return this.toConfigResponse(config);
  }

  async upsertConfig(
    userId: string,
    dto: UpdateSyncConfigDto,
  ): Promise<SyncConfigResponseDto> {
    const existing = await this.prisma.calendarSyncConfig.findUnique({
      where: { userId },
    });

    const config = await this.prisma.calendarSyncConfig.upsert({
      where: { userId },
      create: {
        userId,
        enabled: dto.enabled ?? false,
        calendarId: dto.calendarId ?? 'primary',
        syncFrequencyMinutes: dto.syncFrequencyMinutes ?? 60,
      },
      update: {
        ...(dto.enabled !== undefined && { enabled: dto.enabled }),
        ...(dto.calendarId !== undefined && { calendarId: dto.calendarId }),
        ...(dto.syncFrequencyMinutes !== undefined && {
          syncFrequencyMinutes: dto.syncFrequencyMinutes,
        }),
      },
    });

    this.logger.log(
      `Upserted calendar sync config for user ${userId} (${existing ? 'update' : 'create'})`,
    );

    return this.toConfigResponse(config);
  }

  async setGoogleTokens(
    userId: string,
    refreshToken: string,
    googleEmail: string,
  ): Promise<void> {
    const encryptionKey = this.configService.get<string>(
      'calendar.encryptionKey',
    );
    if (!encryptionKey) {
      throw new Error('CALENDAR_ENCRYPTION_KEY is not configured');
    }

    const encryptedRefreshToken = encrypt(refreshToken, encryptionKey);

    await this.prisma.calendarSyncConfig.upsert({
      where: { userId },
      create: {
        userId,
        encryptedRefreshToken,
        googleEmail,
        enabled: true,
      },
      update: {
        encryptedRefreshToken,
        googleEmail,
        enabled: true,
      },
    });

    this.logger.log(`Google tokens set for user ${userId}`);
  }

  async clearGoogleTokens(userId: string): Promise<void> {
    await this.prisma.calendarSyncConfig.upsert({
      where: { userId },
      create: {
        userId,
        encryptedRefreshToken: null,
        googleEmail: null,
        enabled: false,
      },
      update: {
        encryptedRefreshToken: null,
        googleEmail: null,
        enabled: false,
      },
    });

    this.logger.log(`Google tokens cleared for user ${userId}`);
  }

  async getDecryptedRefreshToken(userId: string): Promise<string | null> {
    const config = await this.prisma.calendarSyncConfig.findUnique({
      where: { userId },
    });

    if (!config?.encryptedRefreshToken) {
      return null;
    }

    const encryptionKey = this.configService.get<string>(
      'calendar.encryptionKey',
    );
    if (!encryptionKey) {
      throw new Error('CALENDAR_ENCRYPTION_KEY is not configured');
    }

    return decrypt(config.encryptedRefreshToken, encryptionKey);
  }

  /**
   * Returns all sync configs that are enabled, have a refresh token,
   * and whose next sync time has arrived (lastSyncAt + frequency <= now).
   */
  async getConfigsNeedingSync(): Promise<
    Array<{ id: string; userId: string; calendarId: string }>
  > {
    const now = new Date();

    const configs = await this.prisma.calendarSyncConfig.findMany({
      where: {
        enabled: true,
        encryptedRefreshToken: { not: null },
      },
      select: {
        id: true,
        userId: true,
        calendarId: true,
        lastSyncAt: true,
        syncFrequencyMinutes: true,
      },
    });

    return configs.filter((c) => {
      if (!c.lastSyncAt) return true; // Never synced - sync now
      const nextSyncAt = new Date(
        c.lastSyncAt.getTime() + c.syncFrequencyMinutes * 60 * 1000,
      );
      return nextSyncAt <= now;
    });
  }

  async listLogs(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<SyncLogsListResponseDto> {
    const skip = (page - 1) * pageSize;

    const [items, totalItems] = await Promise.all([
      this.prisma.calendarSyncLog.findMany({
        where: { userId },
        orderBy: { startedAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.calendarSyncLog.count({ where: { userId } }),
    ]);

    return {
      items: items.map((l) => this.toLogResponse(l)),
      meta: {
        page,
        pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / pageSize),
      },
    };
  }

  async getLog(userId: string, logId: string): Promise<SyncLogResponseDto> {
    const log = await this.prisma.calendarSyncLog.findFirst({
      where: { id: logId, userId },
    });

    if (!log) {
      throw new NotFoundException('Sync log not found');
    }

    return this.toLogResponse(log);
  }

  private toConfigResponse(config: CalendarSyncConfig): SyncConfigResponseDto {
    return {
      enabled: config.enabled,
      calendarId: config.calendarId,
      syncFrequencyMinutes: config.syncFrequencyMinutes,
      googleEmail: config.googleEmail,
      isConnected: config.encryptedRefreshToken !== null,
      lastSyncAt: config.lastSyncAt?.toISOString() ?? null,
      lastSyncStatus: config.lastSyncStatus,
    };
  }

  private toLogResponse(log: CalendarSyncLog): SyncLogResponseDto {
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
}
