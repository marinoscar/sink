export interface TokenResponseDto {
  id: string;
  name: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  isActive: boolean;
}
