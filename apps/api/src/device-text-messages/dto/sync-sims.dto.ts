import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const simInfoSchema = z.object({
  slotIndex: z.number().int().min(0),
  subscriptionId: z.number().int(),
  carrierName: z.string().max(100).optional(),
  phoneNumber: z.string().max(30).optional(),
  iccId: z.string().max(30).optional(),
  displayName: z.string().max(100).optional(),
});

export const syncSimsSchema = z.object({
  sims: z.array(simInfoSchema).min(1).max(10),
});

export class SyncSimsDto extends createZodDto(syncSimsSchema) {}
