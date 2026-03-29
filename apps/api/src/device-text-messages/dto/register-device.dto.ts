import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const registerDeviceSchema = z.object({
  name: z.string().min(1).max(100),
  platform: z.string().min(1).max(20).default('android'),
  manufacturer: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  osVersion: z.string().max(50).optional(),
  appVersion: z.string().max(50).optional(),
  deviceCodeId: z.string().uuid().optional(),
});

export class RegisterDeviceDto extends createZodDto(registerDeviceSchema) {}
