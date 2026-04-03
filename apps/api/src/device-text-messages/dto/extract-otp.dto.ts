import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const extractOtpSchema = z.object({
  messageBody: z.string().min(1).max(2000),
});

export class ExtractOtpDto extends createZodDto(extractOtpSchema) {}
