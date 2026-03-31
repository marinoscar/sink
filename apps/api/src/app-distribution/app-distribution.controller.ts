import {
  Controller,
  Get,
  NotFoundException,
  Redirect,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { AppDistributionService, VersionInfo } from './app-distribution.service';

@ApiTags('App Distribution')
@Controller('app')
export class AppDistributionController {
  private readonly logger = new Logger(AppDistributionController.name);

  constructor(private readonly appDistributionService: AppDistributionService) {}

  @Get('android')
  @Public()
  @Redirect()
  @ApiOperation({
    summary: 'Download Android APK',
    description:
      'Generates a signed S3 URL for the Android APK and redirects the client to it (302). ' +
      'Returns 404 if no APK has been published yet.',
  })
  @ApiResponse({ status: 302, description: 'Redirect to signed APK download URL' })
  @ApiResponse({ status: 404, description: 'No APK available' })
  async downloadApk(): Promise<{ url: string; statusCode: number }> {
    this.logger.debug('APK download requested');

    const url = await this.appDistributionService.getApkDownloadUrl();

    if (!url) {
      throw new NotFoundException(
        'No APK available. Run the publish script first.',
      );
    }

    return { url, statusCode: 302 };
  }

  @Get('android/version')
  @Public()
  @ApiOperation({
    summary: 'Get Android app version info',
    description:
      'Returns the version manifest for the Android app from S3. ' +
      'Returns 404 if no version manifest has been published yet.',
  })
  @ApiResponse({
    status: 200,
    description: 'Version info retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            versionCode: { type: 'number', example: 42 },
            versionName: { type: 'string', example: '1.2.3' },
            downloadUrl: { type: 'string', example: 'https://example.com/app.apk' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'No version manifest available' })
  async getVersionInfo(): Promise<{ data: VersionInfo }> {
    this.logger.debug('Version info requested');

    const versionInfo = await this.appDistributionService.getVersionInfo();

    if (!versionInfo) {
      throw new NotFoundException(
        'No APK available. Run the publish script first.',
      );
    }

    return { data: versionInfo };
  }
}
