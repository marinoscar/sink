import { Controller, Get, Post, Query, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';

import { DeviceTextMessagesService } from './device-text-messages.service';
import { OtpExtractorService } from './otp-extractor.service';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../common/constants/roles.constants';
import { QueryMessagesDto } from './dto/query-messages.dto';
import { ExtractOtpDto } from './dto/extract-otp.dto';

@ApiTags('Device Text Messages')
@Controller('device-text-messages')
export class DeviceTextMessagesController {
  constructor(
    private readonly service: DeviceTextMessagesService,
    private readonly otpExtractorService: OtpExtractorService,
  ) {}

  @Get()
  @Auth({ permissions: [PERMISSIONS.DEVICE_TEXT_MESSAGES_READ] })
  @ApiOperation({ summary: 'List device text messages (paginated, filterable)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'dateFrom', required: false, type: String, description: 'ISO 8601 datetime' })
  @ApiQuery({ name: 'dateTo', required: false, type: String, description: 'ISO 8601 datetime' })
  @ApiQuery({ name: 'sender', required: false, type: String })
  @ApiQuery({ name: 'deviceId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'deviceSimId', required: false, type: String, format: 'uuid', description: 'Filter by SIM card ID' })
  @ApiQuery({ name: 'isOtp', required: false, type: Boolean, description: 'Filter for OTP messages only' })
  @ApiResponse({ status: 200, description: 'Paginated list of SMS messages' })
  async listMessages(
    @CurrentUser('id') userId: string,
    @Query() query: QueryMessagesDto,
  ) {
    return this.service.listMessages(userId, query);
  }

  @Get('senders')
  @Auth({ permissions: [PERMISSIONS.DEVICE_TEXT_MESSAGES_READ] })
  @ApiOperation({ summary: 'List distinct SMS senders for the current user' })
  @ApiResponse({ status: 200, description: 'Array of sender strings' })
  async listSenders(@CurrentUser('id') userId: string) {
    return this.service.listSenders(userId);
  }

  @Post('extract-otp')
  @Auth({ permissions: [PERMISSIONS.DEVICE_TEXT_MESSAGES_READ] })
  @ApiOperation({ summary: 'Extract OTP code from message text using LLM' })
  @ApiResponse({ status: 200, description: 'OTP extraction result' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 500, description: 'LLM service unavailable' })
  async extractOtp(@Body() dto: ExtractOtpDto) {
    return this.otpExtractorService.extractOtp(dto.messageBody);
  }
}
