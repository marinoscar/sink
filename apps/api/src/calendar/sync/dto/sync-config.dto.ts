import { z } from 'zod';

export const updateSyncConfigSchema = z.object({
  enabled: z.boolean().optional(),
  calendarId: z.string().min(1).optional(),
  syncFrequencyMinutes: z.number().int().min(1).max(1440).optional(),
});

export type UpdateSyncConfigDto = z.infer<typeof updateSyncConfigSchema>;

export interface SyncConfigResponseDto {
  enabled: boolean;
  calendarId: string;
  syncFrequencyMinutes: number;
  googleEmail: string | null;
  isConnected: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
}
