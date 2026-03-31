import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppDistributionController } from './app-distribution.controller';
import { AppDistributionService } from './app-distribution.service';

@Module({
  imports: [ConfigModule],
  controllers: [AppDistributionController],
  providers: [AppDistributionService],
})
export class AppDistributionModule {}
