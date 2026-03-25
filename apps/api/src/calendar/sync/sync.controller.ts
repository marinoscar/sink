import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';
import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ROLES } from '../../common/constants/roles.constants';
import { GoogleCalendarClient } from './google-calendar.client';
import { SyncConfigService } from './sync-config.service';
import { CalendarSyncService } from './sync.service';
import {
  UpdateSyncConfigDto,
  updateSyncConfigSchema,
  SyncConfigResponseDto,
} from './dto/sync-config.dto';
import {
  SyncLogResponseDto,
  SyncLogsListResponseDto,
} from './dto/sync-log-response.dto';
import { ConfigService } from '@nestjs/config';
import { calendar_v3 } from 'googleapis';

@ApiTags('Calendar Sync')
@Controller('calendar/sync')
@Auth({ roles: [ROLES.ADMIN] })
export class SyncController {
  constructor(
    private readonly syncConfigService: SyncConfigService,
    private readonly calendarSyncService: CalendarSyncService,
    private readonly googleClient: GoogleCalendarClient,
    private readonly configService: ConfigService,
  ) {}

  /**
   * GET /calendar/sync/config
   * Returns the current sync configuration for the authenticated admin.
   */
  @Get('config')
  @ApiOperation({ summary: 'Get calendar sync configuration' })
  @ApiResponse({ status: 200, description: 'Sync configuration' })
  async getConfig(
    @CurrentUser('id') userId: string,
  ): Promise<{ data: SyncConfigResponseDto }> {
    const config = await this.syncConfigService.getConfig(userId);
    return { data: config };
  }

  /**
   * PATCH /calendar/sync/config
   * Updates the sync configuration.
   */
  @Patch('config')
  @ApiOperation({ summary: 'Update calendar sync configuration' })
  @ApiResponse({ status: 200, description: 'Updated sync configuration' })
  async updateConfig(
    @Body(new ZodValidationPipe(updateSyncConfigSchema)) dto: UpdateSyncConfigDto,
    @CurrentUser('id') userId: string,
  ): Promise<{ data: SyncConfigResponseDto }> {
    const config = await this.syncConfigService.upsertConfig(userId, dto);
    return { data: config };
  }

  /**
   * POST /calendar/sync/trigger
   * Manually triggers a sync run for the authenticated admin.
   */
  @Post('trigger')
  @ApiOperation({ summary: 'Manually trigger calendar sync' })
  @ApiResponse({ status: 201, description: 'Sync log for the triggered run' })
  async triggerSync(
    @CurrentUser('id') userId: string,
  ): Promise<{ data: SyncLogResponseDto }> {
    const log = await this.calendarSyncService.syncUser(userId);
    return { data: log };
  }

  /**
   * GET /calendar/sync/logs
   * Returns paginated sync logs, optionally filtered by date range.
   */
  @Get('logs')
  @ApiOperation({ summary: 'List calendar sync logs' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({
    name: 'dateFilter',
    required: false,
    enum: ['today', 'yesterday', 'last7', 'last30', 'all'],
    description: 'Limit results to a date range (default: all)',
  })
  @ApiResponse({ status: 200, description: 'Paginated sync logs' })
  async listLogs(
    @CurrentUser('id') userId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
    @Query('dateFilter') dateFilter?: string,
  ): Promise<{ data: SyncLogsListResponseDto }> {
    const result = await this.syncConfigService.listLogs(userId, page, pageSize, dateFilter);
    return { data: result };
  }

  /**
   * GET /calendar/sync/logs/:id
   * Returns a single sync log entry.
   */
  @Get('logs/:id')
  @ApiOperation({ summary: 'Get a single sync log entry' })
  @ApiResponse({ status: 200, description: 'Sync log entry' })
  async getLog(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<{ data: SyncLogResponseDto }> {
    const log = await this.syncConfigService.getLog(userId, id);
    return { data: log };
  }

  /**
   * GET /calendar/sync/calendars
   * Lists the user's Google Calendars (requires connected account).
   */
  @Get('calendars')
  @ApiOperation({ summary: 'List available Google Calendars' })
  @ApiResponse({ status: 200, description: 'List of Google Calendars' })
  async listCalendars(
    @CurrentUser('id') userId: string,
  ): Promise<{ data: calendar_v3.Schema$CalendarListEntry[] }> {
    const refreshToken =
      await this.syncConfigService.getDecryptedRefreshToken(userId);

    if (!refreshToken) {
      return { data: [] };
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
    const calendars = await this.googleClient.listCalendars(calendar);

    return { data: calendars };
  }
}
