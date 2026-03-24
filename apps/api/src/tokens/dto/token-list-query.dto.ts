import { z } from 'zod';
import { TokenResponseDto } from './token-response.dto';

export const tokenListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export type TokenListQueryDto = z.infer<typeof tokenListQuerySchema>;

export interface TokenListResponseDto {
  items: TokenResponseDto[];
  meta: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}
