import { Module } from '@nestjs/common';
import { EntriesController } from './entries/entries.controller';
import { EntriesService } from './entries/entries.service';

@Module({
  controllers: [EntriesController],
  providers: [EntriesService],
  exports: [EntriesService],
})
export class CalendarModule {}
