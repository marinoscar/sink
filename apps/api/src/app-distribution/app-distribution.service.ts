import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const APK_KEY = 'app/android/sink-app.apk';
const VERSION_KEY = 'app/android/version.json';
const SIGNED_URL_EXPIRY_SECONDS = 3600;

export interface VersionInfo {
  versionCode: number;
  versionName: string;
  downloadUrl: string;
  updatedAt: string;
}

@Injectable()
export class AppDistributionService {
  private readonly logger = new Logger(AppDistributionService.name);
  private readonly s3Client: S3Client;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('storage.s3.region');
    const endpoint = this.configService.get<string>('storage.s3.endpoint');
    const accessKeyId = this.configService.get<string>('storage.s3.accessKeyId');
    const secretAccessKey = this.configService.get<string>('storage.s3.secretAccessKey');

    this.bucket = this.configService.get<string>('storage.s3.bucket') || '';

    if (!this.bucket) {
      this.logger.warn('S3 bucket not configured — app distribution will not work');
    }

    this.s3Client = new S3Client({
      region,
      endpoint,
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey }
          : undefined,
      forcePathStyle: !!endpoint,
    });

    this.logger.log(
      `AppDistributionService initialized — Bucket: ${this.bucket}${endpoint ? `, Endpoint: ${endpoint}` : ''}`,
    );
  }

  /**
   * Returns a pre-signed S3 URL for the Android APK valid for 1 hour,
   * or null if the object does not exist.
   */
  async getApkDownloadUrl(): Promise<string | null> {
    this.logger.debug(`Checking APK existence at key: ${APK_KEY}`);

    const exists = await this.objectExists(APK_KEY);
    if (!exists) {
      this.logger.warn(`APK not found at key: ${APK_KEY}`);
      return null;
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: APK_KEY,
      ResponseContentDisposition: 'attachment; filename="sink-app.apk"',
    });

    const url = await getSignedUrl(this.s3Client, command, {
      expiresIn: SIGNED_URL_EXPIRY_SECONDS,
    });

    this.logger.debug(`Generated signed APK URL (expires in ${SIGNED_URL_EXPIRY_SECONDS}s)`);
    return url;
  }

  /**
   * Fetches and parses the version manifest from S3.
   * Returns null if the manifest does not exist.
   */
  async getVersionInfo(): Promise<VersionInfo | null> {
    this.logger.debug(`Fetching version manifest at key: ${VERSION_KEY}`);

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: VERSION_KEY,
      });

      const result = await this.s3Client.send(command);

      if (!result.Body) {
        this.logger.warn('Version manifest body is empty');
        return null;
      }

      const raw = await result.Body.transformToString('utf-8');
      const parsed = JSON.parse(raw) as VersionInfo;

      this.logger.debug(`Version manifest parsed: ${parsed.versionName} (${parsed.versionCode})`);
      return parsed;
    } catch (error) {
      if (this.isNotFoundError(error)) {
        this.logger.warn(`Version manifest not found at key: ${VERSION_KEY}`);
        return null;
      }

      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Failed to fetch version manifest: ${message}`, stack);
      throw error;
    }
  }

  private async objectExists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({ Bucket: this.bucket, Key: key });
      await this.s3Client.send(command);
      return true;
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return false;
      }
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Error checking existence for key ${key}: ${message}`, stack);
      throw error;
    }
  }

  private isNotFoundError(error: unknown): boolean {
    return (
      error instanceof NotFound ||
      (error != null &&
        typeof error === 'object' &&
        'name' in error &&
        (error as { name: string }).name === 'NotFound')
    );
  }
}
