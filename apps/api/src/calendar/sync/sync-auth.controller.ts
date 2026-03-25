import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { FastifyRequest, FastifyReply } from 'fastify';
import { Auth } from '../../auth/decorators/auth.decorator';
import { Public } from '../../auth/decorators/public.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ROLES } from '../../common/constants/roles.constants';
import { GoogleCalendarClient } from './google-calendar.client';
import { SyncConfigService } from './sync-config.service';

@ApiTags('Calendar Sync')
@Controller('calendar/sync/auth')
export class SyncAuthController {
  private readonly logger = new Logger(SyncAuthController.name);

  constructor(
    private readonly syncConfigService: SyncConfigService,
    private readonly googleClient: GoogleCalendarClient,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * GET /calendar/sync/auth/google
   * Builds the Google OAuth consent URL with calendar scope and redirects.
   * Uses a query-param token because this is a browser redirect (no Bearer header).
   */
  @Public()
  @Get('google')
  @ApiOperation({ summary: 'Initiate Google Calendar OAuth' })
  @ApiResponse({ status: 302, description: 'Redirect to Google consent screen' })
  async initiateGoogleAuth(
    @Query('token') token: string,
    @Res() res: FastifyReply,
  ): Promise<void> {
    // Verify the JWT from the query param
    if (!token) {
      throw new UnauthorizedException('Missing token');
    }

    let payload: { sub: string };
    try {
      payload = this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const userId = payload.sub;

    const clientId = this.configService.get<string>('google.clientId')!;
    const clientSecret = this.configService.get<string>('google.clientSecret')!;
    const appUrl = this.configService.get<string>('appUrl')!;
    const redirectUri = `${appUrl}/api/calendar/sync/auth/google/callback`;

    const oauth2Client = this.googleClient.createOAuth2Client(
      clientId,
      clientSecret,
      redirectUri,
    );

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/calendar'],
      state: userId, // Pass userId as state for callback verification
    });

    this.logger.log(`Initiating Google Calendar OAuth for user ${userId}`);
    return res.status(302).redirect(authUrl);
  }

  /**
   * GET /calendar/sync/auth/google/callback
   * Handles the OAuth callback from Google. Public endpoint - validated via state param.
   */
  @Public()
  @Get('google/callback')
  @ApiOperation({ summary: 'Google Calendar OAuth callback' })
  @ApiResponse({ status: 302, description: 'Redirects to frontend after auth' })
  async googleAuthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: FastifyReply,
  ): Promise<void> {
    const appUrl = this.configService.get<string>('appUrl')!;

    // Handle OAuth denial or error
    if (error) {
      this.logger.warn(`Google Calendar OAuth denied: ${error}`);
      return res.status(302).redirect(
        `${appUrl}/calendar/sync?error=oauth_denied`,
      );
    }

    // The state parameter contains the userId - validate it's a non-empty string
    if (!state || !code) {
      this.logger.warn('Google Calendar OAuth callback missing code or state');
      return res.status(302).redirect(
        `${appUrl}/calendar/sync?error=invalid_callback`,
      );
    }

    const userId = state;

    try {
      const clientId = this.configService.get<string>('google.clientId')!;
      const clientSecret = this.configService.get<string>('google.clientSecret')!;
      const redirectUri = `${appUrl}/api/calendar/sync/auth/google/callback`;

      const oauth2Client = this.googleClient.createOAuth2Client(
        clientId,
        clientSecret,
        redirectUri,
      );

      // Exchange authorization code for tokens
      const { tokens } = await oauth2Client.getToken(code);

      if (!tokens.refresh_token) {
        this.logger.warn(
          `No refresh token received for user ${userId}. User may need to revoke access and re-authorize.`,
        );
        return res.status(302).redirect(
          `${appUrl}/calendar/sync?error=no_refresh_token`,
        );
      }

      // Get user's Google email from id_token or userinfo
      let googleEmail = '';
      if (tokens.id_token) {
        try {
          const ticket = await oauth2Client.verifyIdToken({
            idToken: tokens.id_token,
            audience: clientId,
          });
          googleEmail = ticket.getPayload()?.email ?? '';
        } catch {
          this.logger.warn('Could not extract email from id_token');
        }
      }

      await this.syncConfigService.setGoogleTokens(
        userId,
        tokens.refresh_token,
        googleEmail,
      );

      this.logger.log(
        `Google Calendar connected for user ${userId} (${googleEmail})`,
      );
      return res.status(302).redirect(`${appUrl}/calendar/sync?connected=true`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(
        `Google Calendar OAuth callback failed for user ${userId}: ${message}`,
      );
      return res.status(302).redirect(
        `${appUrl}/calendar/sync?error=auth_failed`,
      );
    }
  }

  /**
   * POST /calendar/sync/auth/disconnect
   * Clears stored Google tokens and disables sync.
   */
  @Auth({ roles: [ROLES.ADMIN] })
  @Post('disconnect')
  @ApiOperation({ summary: 'Disconnect Google Calendar' })
  @ApiResponse({ status: 200, description: 'Disconnected successfully' })
  async disconnect(
    @CurrentUser('id') userId: string,
  ): Promise<{ data: { success: boolean } }> {
    await this.syncConfigService.clearGoogleTokens(userId);
    this.logger.log(`Google Calendar disconnected for user ${userId}`);
    return { data: { success: true } };
  }
}
