import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { EntriesService, UploadResultDto } from './entries.service';
import { UploadCalendarDto, uploadCalendarSchema } from './dto/upload-calendar.dto';
import { CalendarEntriesQueryDto, CalendarEntriesListResponseDto, calendarEntriesQuerySchema } from './dto/calendar-entries-query.dto';
import { CalendarEntryResponseDto } from './dto/calendar-entry-response.dto';

@ApiTags('Calendar')
@Controller('calendar')
@Auth()
export class EntriesController {
  constructor(private readonly entriesService: EntriesService) {}

  @Post('entries/upload')
  @ApiOperation({ summary: 'Upload Outlook calendar JSON export' })
  @ApiResponse({ status: 201, description: 'Upload processed successfully' })
  async upload(
    @Body(new ZodValidationPipe(uploadCalendarSchema)) dto: UploadCalendarDto,
    @CurrentUser('id') userId: string,
  ): Promise<{ data: UploadResultDto }> {
    const result = await this.entriesService.processUpload(dto, userId);
    return { data: result };
  }

  @Get('entries/pending-sync')
  @ApiOperation({ summary: 'Get entries pending Google Calendar sync' })
  async getPendingSync(
    @CurrentUser('id') userId: string,
  ): Promise<{ data: CalendarEntryResponseDto[] }> {
    const result = await this.entriesService.getPendingSync(userId);
    return { data: result };
  }

  @Get('uploads')
  @ApiOperation({ summary: 'List calendar upload history' })
  async listUploads(
    @CurrentUser('id') userId: string,
  ): Promise<{ data: any[] }> {
    const result = await this.entriesService.listUploads(userId);
    return { data: result };
  }

  @Get('entries')
  @ApiOperation({ summary: 'List calendar entries' })
  async listEntries(
    @Query(new ZodValidationPipe(calendarEntriesQuerySchema)) query: CalendarEntriesQueryDto,
    @CurrentUser('id') userId: string,
  ): Promise<{ data: CalendarEntriesListResponseDto }> {
    const result = await this.entriesService.listEntries(userId, query);
    return { data: result };
  }

  @Get('entries/:id')
  @ApiOperation({ summary: 'Get a single calendar entry' })
  async getEntry(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<{ data: CalendarEntryResponseDto }> {
    const result = await this.entriesService.getEntry(userId, id);
    return { data: result };
  }
}
