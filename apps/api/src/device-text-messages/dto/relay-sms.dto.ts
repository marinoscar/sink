import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const smsItemSchema = z.object({
  sender: z.string().min(1).max(50),
  body: z.string().max(10000),
  smsTimestamp: z.string().datetime(),
  simSubscriptionId: z.number().int().optional(),
  simSlotIndex: z.number().int().optional(),
});

export const relaySmsSchema = z.object({
  deviceId: z.string().uuid(),
  messages: z.array(smsItemSchema).min(1).max(100),
});

export class RelaySmsDto extends createZodDto(relaySmsSchema) {}
