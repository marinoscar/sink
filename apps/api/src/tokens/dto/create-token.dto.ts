import { z } from 'zod';

export const createTokenSchema = z.object({
  name: z.string().min(1).max(255),
  expiresInHours: z.number().positive().max(876600), // ~100 years
});

export type CreateTokenDto = z.infer<typeof createTokenSchema>;

export interface CreateTokenResponseDto {
  id: string;
  name: string;
  token: string;
  expiresAt: string;
  createdAt: string;
}
