import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';

import { RelayService } from './relay.service';
import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../../common/constants/roles.constants';
import { RegisterDeviceDto } from '../dto/register-device.dto';
import { SyncSimsDto } from '../dto/sync-sims.dto';
import { RelaySmsDto } from '../dto/relay-sms.dto';

@ApiTags('Device Text Messages')
@Controller('device-text-messages')
export class RelayController {
  constructor(private readonly relayService: RelayService) {}

  @Post('devices/register')
  @Auth()
  @ApiOperation({ summary: 'Register or update a device' })
  @ApiResponse({ status: 201, description: 'Device registered or updated' })
  async registerDevice(
    @CurrentUser('id') userId: string,
    @Body() dto: RegisterDeviceDto,
  ) {
    return this.relayService.registerDevice(userId, dto);
  }

  @Post('devices/:deviceId/sims')
  @Auth()
  @ApiOperation({ summary: 'Sync SIM cards for a device' })
  @ApiParam({ name: 'deviceId', type: String, format: 'uuid' })
  @ApiResponse({ status: 201, description: 'SIMs synced successfully' })
  @ApiResponse({ status: 403, description: 'Device does not belong to user' })
  @ApiResponse({ status: 404, description: 'Device not found' })
  async syncSims(
    @CurrentUser('id') userId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Body() dto: SyncSimsDto,
  ) {
    return this.relayService.syncSims(userId, deviceId, dto);
  }

  @Post('relay')
  @Auth({ permissions: [PERMISSIONS.DEVICE_TEXT_MESSAGES_WRITE] })
  @ApiOperation({ summary: 'Relay SMS messages from device' })
  @ApiResponse({ status: 201, description: 'Messages relayed' })
  @ApiResponse({ status: 403, description: 'Device does not belong to user' })
  @ApiResponse({ status: 404, description: 'Device not found' })
  async relaySms(
    @CurrentUser('id') userId: string,
    @Body() dto: RelaySmsDto,
  ) {
    return this.relayService.relaySms(userId, dto);
  }

  @Get('devices')
  @Auth()
  @ApiOperation({ summary: 'List registered devices for the current user' })
  @ApiResponse({ status: 200, description: 'List of devices with SIMs' })
  async listDevices(@CurrentUser('id') userId: string) {
    return this.relayService.listDevices(userId);
  }
}
