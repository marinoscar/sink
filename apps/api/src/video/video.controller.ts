import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Res,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { FastifyReply } from 'fastify';

import { VideoService } from './video.service';
import { PrepareDownloadDto } from './dto/prepare-download.dto';
import { Auth } from '../auth/decorators/auth.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../common/constants/roles.constants';

@ApiTags('Video')
@Controller('video/download')
export class VideoController {
  private readonly logger = new Logger(VideoController.name);

  constructor(private readonly videoService: VideoService) {}

  /**
   * POST /video/download/prepare
   * Validate URL, run yt-dlp, return a short-lived signed token + filename.
   */
  @Post('prepare')
  @Auth({ permissions: [PERMISSIONS.VIDEO_DOWNLOAD] })
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Prepare a video download',
    description:
      'Validates the URL platform, resolves the upstream direct URL via yt-dlp, ' +
      'and returns a 120-second single-use signed token for use with the stream endpoint.',
  })
  @ApiResponse({
    status: 201,
    description: 'Token minted successfully',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            filename: { type: 'string' },
            sizeBytes: { type: 'number', nullable: true },
          },
          required: ['token', 'filename'],
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid URL or unsupported platform' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - missing video:download permission' })
  @ApiResponse({ status: 422, description: 'Video is private, unavailable, or geo-restricted' })
  @ApiResponse({ status: 502, description: 'Could not resolve video URL' })
  async prepareDownload(
    @Body() dto: PrepareDownloadDto,
    @CurrentUser('id') userId: string,
  ) {
    this.logger.log(`Prepare video download for user=${userId} url=${dto.url}`);
    const result = await this.videoService.prepareDownload(dto.url, userId);
    return result;
  }

  /**
   * GET /video/download/stream?token=...
   * Public route. Validates the single-use signed token then streams the video.
   */
  @Get('stream')
  @Public()
  @ApiOperation({
    summary: 'Stream a video download (public, token-gated)',
    description:
      'Validates the signed single-use token from /prepare, then proxies the upstream ' +
      'video bytes directly to the client with Content-Disposition: attachment.',
  })
  @ApiQuery({ name: 'token', type: String, description: 'Signed download token from /prepare' })
  @ApiResponse({ status: 200, description: 'Video stream' })
  @ApiResponse({ status: 401, description: 'Invalid, expired, or already-used token' })
  @ApiResponse({ status: 502, description: 'Upstream connection failed' })
  async streamDownload(
    @Query('token') token: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    this.logger.log('Stream video download request');

    const { upstreamUrl, filename } = await this.videoService.consumeToken(token);

    this.logger.log(`Streaming video filename=${filename}`);

    // Hijack the Fastify reply so it won't try to finalize the response,
    // then stream directly to the raw Node.js ServerResponse.
    reply.hijack();
    await this.videoService.streamToClient(upstreamUrl, filename, reply.raw);
  }
}
