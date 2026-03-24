import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from '../auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/**
 * JWT payload structure
 */
export interface JwtPayload {
  sub: string; // User ID
  email: string;
  roles: string[];
  type?: 'pat'; // Personal Access Token
  jti?: string; // Token ID (for PATs)
}

/**
 * JWT authentication strategy
 *
 * Validates JWT tokens and attaches user information to the request.
 * Tokens are extracted from the Authorization header as Bearer tokens.
 * Supports both session JWTs and Personal Access Tokens (PATs).
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret') || 'fallback-secret',
    });
  }

  /**
   * Validates the JWT payload and returns the user object.
   * For PATs, also checks revocation status and updates lastUsedAt.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    // If this is a PAT, check revocation
    if (payload.type === 'pat' && payload.jti) {
      const pat = await this.prisma.personalAccessToken.findUnique({
        where: { tokenId: payload.jti },
      });

      if (!pat || pat.revokedAt) {
        throw new UnauthorizedException('Token has been revoked');
      }

      // Update lastUsedAt (fire-and-forget)
      this.prisma.personalAccessToken
        .update({
          where: { tokenId: payload.jti },
          data: { lastUsedAt: new Date() },
        })
        .catch(() => {});
    }

    const user = await this.authService.validateJwtPayload(payload);

    if (!user) {
      throw new UnauthorizedException('Invalid token');
    }

    return user;
  }
}
