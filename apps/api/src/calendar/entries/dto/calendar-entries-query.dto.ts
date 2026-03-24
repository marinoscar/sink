import { z } from 'zod';
import { CalendarEntryResponseDto } from './calendar-entry-response.dto';

export const calendarEntriesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  syncStatus: z.enum(['pending', 'synced', 'deleted']).optional(),
  includeDeleted: z.coerce.boolean().default(false),
});

export type CalendarEntriesQueryDto = z.infer<typeof calendarEntriesQuerySchema>;

export interface CalendarEntriesListResponseDto {
  items: CalendarEntryResponseDto[];
  meta: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}
