import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const queryMessagesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  sender: z.string().optional(),
  deviceId: z.string().uuid().optional(),
  deviceSimId: z.string().uuid().optional(),
});

export class QueryMessagesDto extends createZodDto(queryMessagesSchema) {}
