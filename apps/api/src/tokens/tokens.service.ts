import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTokenDto, CreateTokenResponseDto } from './dto/create-token.dto';
import { TokenListQueryDto, TokenListResponseDto } from './dto/token-list-query.dto';
import { TokenResponseDto } from './dto/token-response.dto';

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Create a new personal access token.
   * Returns the signed JWT only once — it is not stored.
   */
  async create(
    userId: string,
    dto: CreateTokenDto,
  ): Promise<CreateTokenResponseDto> {
    // Load user with roles for JWT payload
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        userRoles: {
          include: { role: true },
        },
      },
    });

    const tokenId = randomUUID();
    const expiresAt = new Date();
    expiresAt.setTime(expiresAt.getTime() + dto.expiresInHours * 60 * 60 * 1000);

    const roles = user.userRoles.map((ur) => ur.role.name);

    // Sign a JWT with PAT-specific claims
    const token = this.jwtService.sign(
      {
        sub: userId,
        email: user.email,
        roles,
        type: 'pat',
        jti: tokenId,
      },
      {
        expiresIn: `${dto.expiresInHours}h`,
      },
    );

    // Store metadata in DB (not the token itself)
    const pat = await this.prisma.personalAccessToken.create({
      data: {
        userId,
        name: dto.name,
        tokenId,
        expiresAt,
      },
    });

    this.logger.log(`Created PAT "${dto.name}" for user ${userId}`);

    return {
      id: pat.id,
      name: pat.name,
      token,
      expiresAt: pat.expiresAt.toISOString(),
      createdAt: pat.createdAt.toISOString(),
    };
  }

  /**
   * List all tokens for a user (never returns the JWT value).
   */
  async list(
    userId: string,
    query: TokenListQueryDto,
  ): Promise<TokenListResponseDto> {
    const { page, pageSize } = query;
    const skip = (page - 1) * pageSize;

    const [items, totalItems] = await Promise.all([
      this.prisma.personalAccessToken.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.personalAccessToken.count({ where: { userId } }),
    ]);

    return {
      items: items.map((t) => this.toResponseDto(t)),
      meta: {
        page,
        pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / pageSize),
      },
    };
  }

  /**
   * Revoke a token by setting revokedAt.
   */
  async revoke(userId: string, tokenId: string): Promise<void> {
    const pat = await this.prisma.personalAccessToken.findFirst({
      where: { id: tokenId, userId },
    });

    if (!pat) {
      throw new NotFoundException('Token not found');
    }

    await this.prisma.personalAccessToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });

    this.logger.log(`Revoked PAT "${pat.name}" for user ${userId}`);
  }

  /**
   * Check if a PAT (by jti) is revoked or expired.
   * Called from JwtStrategy during validation.
   */
  async isRevoked(jti: string): Promise<boolean> {
    const pat = await this.prisma.personalAccessToken.findUnique({
      where: { tokenId: jti },
    });

    if (!pat) return true;
    if (pat.revokedAt) return true;
    if (pat.expiresAt < new Date()) return true;

    return false;
  }

  /**
   * Update lastUsedAt for a PAT (fire-and-forget).
   */
  async touchLastUsed(jti: string): Promise<void> {
    await this.prisma.personalAccessToken.update({
      where: { tokenId: jti },
      data: { lastUsedAt: new Date() },
    }).catch(() => {
      // Silently ignore — non-critical
    });
  }

  private toResponseDto(pat: {
    id: string;
    name: string;
    expiresAt: Date;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
  }): TokenResponseDto {
    const now = new Date();
    const isActive = !pat.revokedAt && pat.expiresAt > now;

    return {
      id: pat.id,
      name: pat.name,
      expiresAt: pat.expiresAt.toISOString(),
      lastUsedAt: pat.lastUsedAt?.toISOString() ?? null,
      revokedAt: pat.revokedAt?.toISOString() ?? null,
      createdAt: pat.createdAt.toISOString(),
      isActive,
    };
  }
}
