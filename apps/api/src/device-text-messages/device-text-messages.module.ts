import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DeviceTextMessagesController } from './device-text-messages.controller';
import { DeviceTextMessagesService } from './device-text-messages.service';
import { OtpExtractorService } from './otp-extractor.service';
import { RelayController } from './relay/relay.controller';
import { RelayService } from './relay/relay.service';

@Module({
  imports: [PrismaModule],
  controllers: [DeviceTextMessagesController, RelayController],
  providers: [DeviceTextMessagesService, OtpExtractorService, RelayService],
})
export class DeviceTextMessagesModule {}
