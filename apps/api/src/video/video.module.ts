import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { VideoController } from './video.controller';
import { VideoService } from './video.service';

@Module({
  imports: [
    // AuthModule exports JwtModule (JwtService) needed for token sign/verify
    AuthModule,
    // PrismaModule for audit event writes
    PrismaModule,
  ],
  controllers: [VideoController],
  providers: [VideoService],
})
export class VideoModule {}
