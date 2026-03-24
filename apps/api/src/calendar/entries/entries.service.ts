import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { CalendarSyncStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadCalendarDto, CalendarEntryData } from './dto/upload-calendar.dto';
import { CalendarEntriesQueryDto, CalendarEntriesListResponseDto } from './dto/calendar-entries-query.dto';
import { CalendarEntryResponseDto } from './dto/calendar-entry-response.dto';

export interface UploadResultDto {
  uploadId: string;
  entriesProcessed: number;
  entriesCreated: number;
  entriesUpdated: number;
  entriesDeleted: number;
}

@Injectable()
export class EntriesService {
  private readonly logger = new Logger(EntriesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Process a calendar JSON upload: upsert entries, detect deletions.
   */
  async processUpload(
    dto: UploadCalendarDto,
    userId: string,
  ): Promise<UploadResultDto> {
    const uploadedEntryIds = new Set(dto.entries.map((e) => e.entryId));
    let entriesCreated = 0;
    let entriesUpdated = 0;
    let entriesDeleted = 0;

    await this.prisma.$transaction(async (tx) => {
      // Process entries in batches of 100
      const batches = this.chunk(dto.entries, 100);

      for (const batch of batches) {
        const results = await Promise.all(
          batch.map(async (entry) => {
            const dataHash = this.computeHash(entry);
            const existing = await tx.calendarEntry.findUnique({
              where: { userId_entryId: { userId, entryId: entry.entryId } },
            });

            if (!existing) {
              // Insert new entry
              await tx.calendarEntry.create({
                data: {
                  userId,
                  entryId: entry.entryId,
                  data: entry as any,
                  dataHash,
                  version: 1,
                  syncStatus: CalendarSyncStatus.pending,
                },
              });
              return 'created' as const;
            }

            if (existing.dataHash !== dataHash) {
              // Update changed entry (and resurrect if soft-deleted)
              await tx.calendarEntry.update({
                where: { id: existing.id },
                data: {
                  data: entry as any,
                  dataHash,
                  version: existing.version + 1,
                  syncStatus: CalendarSyncStatus.pending,
                  isDeleted: false,
                },
              });
              return 'updated' as const;
            }

            // Resurrect if it was soft-deleted but data unchanged
            if (existing.isDeleted) {
              await tx.calendarEntry.update({
                where: { id: existing.id },
                data: {
                  isDeleted: false,
                  syncStatus: CalendarSyncStatus.pending,
                },
              });
              return 'updated' as const;
            }

            return 'unchanged' as const;
          }),
        );

        for (const r of results) {
          if (r === 'created') entriesCreated++;
          if (r === 'updated') entriesUpdated++;
        }
      }

      // Mark deletions: entries in DB but not in upload
      const deleteResult = await tx.calendarEntry.updateMany({
        where: {
          userId,
          isDeleted: false,
          entryId: { notIn: [...uploadedEntryIds] },
        },
        data: {
          isDeleted: true,
          syncStatus: CalendarSyncStatus.pending,
        },
      });
      entriesDeleted = deleteResult.count;
    });

    // Create upload audit record
    const upload = await this.prisma.calendarUpload.create({
      data: {
        userId,
        exportDate: dto.exportDate,
        rangeStart: dto.rangeStart,
        rangeEnd: dto.rangeEnd,
        itemCount: dto.itemCount,
        entriesProcessed: dto.entries.length,
        entriesCreated,
        entriesUpdated,
        entriesDeleted,
      },
    });

    this.logger.log(
      `Calendar upload for user ${userId}: ${entriesCreated} created, ${entriesUpdated} updated, ${entriesDeleted} deleted`,
    );

    return {
      uploadId: upload.id,
      entriesProcessed: dto.entries.length,
      entriesCreated,
      entriesUpdated,
      entriesDeleted,
    };
  }

  /**
   * List calendar entries with pagination and filtering.
   */
  async listEntries(
    userId: string,
    query: CalendarEntriesQueryDto,
  ): Promise<CalendarEntriesListResponseDto> {
    const { page, pageSize, syncStatus, includeDeleted } = query;
    const skip = (page - 1) * pageSize;

    const where: any = { userId };
    if (syncStatus) {
      where.syncStatus = syncStatus;
    }
    if (!includeDeleted) {
      where.isDeleted = false;
    }

    const [items, totalItems] = await Promise.all([
      this.prisma.calendarEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.calendarEntry.count({ where }),
    ]);

    return {
      items: items.map((e) => this.toResponseDto(e)),
      meta: {
        page,
        pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / pageSize),
      },
    };
  }

  /**
   * Get a single calendar entry by ID.
   */
  async getEntry(
    userId: string,
    id: string,
  ): Promise<CalendarEntryResponseDto> {
    const entry = await this.prisma.calendarEntry.findFirst({
      where: { id, userId },
    });

    if (!entry) {
      throw new NotFoundException('Calendar entry not found');
    }

    return this.toResponseDto(entry);
  }

  /**
   * Get all entries pending sync (for future Google Calendar integration).
   */
  async getPendingSync(userId: string): Promise<CalendarEntryResponseDto[]> {
    const entries = await this.prisma.calendarEntry.findMany({
      where: {
        userId,
        syncStatus: CalendarSyncStatus.pending,
      },
      orderBy: { updatedAt: 'asc' },
    });

    return entries.map((e) => this.toResponseDto(e));
  }

  /**
   * Mark a calendar entry as synced to Google Calendar.
   */
  async markSynced(id: string, googleEventId: string): Promise<void> {
    await this.prisma.calendarEntry.update({
      where: { id },
      data: {
        syncStatus: CalendarSyncStatus.synced,
        googleEventId,
        lastSyncedAt: new Date(),
      },
    });
  }

  /**
   * Mark a calendar entry as deleted in Google Calendar.
   */
  async markSyncDeleted(id: string): Promise<void> {
    await this.prisma.calendarEntry.update({
      where: { id },
      data: {
        syncStatus: CalendarSyncStatus.deleted,
        lastSyncedAt: new Date(),
      },
    });
  }

  /**
   * List upload history for a user.
   */
  async listUploads(userId: string) {
    return this.prisma.calendarUpload.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  private computeHash(entry: CalendarEntryData): string {
    const canonical = JSON.stringify(entry, Object.keys(entry).sort());
    return createHash('sha256').update(canonical).digest('hex');
  }

  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private toResponseDto(entry: {
    id: string;
    entryId: string;
    data: any;
    version: number;
    syncStatus: CalendarSyncStatus;
    googleEventId: string | null;
    lastSyncedAt: Date | null;
    isDeleted: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): CalendarEntryResponseDto {
    return {
      id: entry.id,
      entryId: entry.entryId,
      data: entry.data as Record<string, unknown>,
      version: entry.version,
      syncStatus: entry.syncStatus,
      googleEventId: entry.googleEventId,
      lastSyncedAt: entry.lastSyncedAt?.toISOString() ?? null,
      isDeleted: entry.isDeleted,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    };
  }
}
