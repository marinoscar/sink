import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const prepareDownloadSchema = z.object({
  url: z.string().url('Must be a valid URL').max(2048, 'URL must be at most 2048 characters'),
});

export class PrepareDownloadDto extends createZodDto(prepareDownloadSchema) {}
