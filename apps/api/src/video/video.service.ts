import {
  Injectable,
  Logger,
  BadRequestException,
  BadGatewayException,
  UnprocessableEntityException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { ServerResponse } from 'node:http';
import * as fs from 'node:fs';

// =============================================================================
// Platform allowlist regexes
// =============================================================================

const ALLOWED_PLATFORMS: RegExp[] = [
  /^(www\.|m\.|mobile\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)$/,
  /^(www\.|mobile\.)?(twitter\.com|x\.com)$/,
  /^(www\.)?instagram\.com$/,
  /^(www\.|m\.|vm\.|vt\.)?tiktok\.com$/,
  /^(www\.|m\.|web\.|business\.)?(facebook\.com|fb\.watch)$/,
];

const PLATFORM_ERROR_MESSAGE =
  'Unsupported platform. Supported: YouTube, X/Twitter, Instagram, TikTok, Facebook.';

// Stderr patterns that indicate user-facing errors (private/unavailable video)
const USER_FACING_STDERR_PATTERN =
  /private|unavailable|geo|removed|not available/i;

// Stderr pattern for YouTube bot-gate (requires authentication cookies)
const BOT_GATE_STDERR_PATTERN = /Sign in to confirm/i;

// Predicate: is this URL from a YouTube hostname?
function isYouTubeHostname(hostname: string): boolean {
  return /^(www\.|m\.|mobile\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(
    hostname.toLowerCase(),
  );
}

// =============================================================================
// Token payload interface
// =============================================================================

interface VideoDownloadTokenPayload {
  sub: string;
  aud: string;
  original: string;
  filename: string;
  jti: string;
  exp?: number;
}

// =============================================================================
// yt-dlp result interface
// =============================================================================

interface YtDlpResult {
  url: string;
  ext: string;
  title: string;
  filesize?: number;
}

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  // ===========================================================================
  // Private cookie helper
  // ===========================================================================

  /**
   * Returns `['--cookies', <path>]` when (a) the URL hostname is a YouTube
   * hostname AND (b) the cookies file exists on disk. Returns `[]` otherwise.
   *
   * Existence is checked lazily on every call so the user can drop the file in
   * without restarting the API container.
   */
  private getCookiesArgsForUrl(url: URL): string[] {
    if (!isYouTubeHostname(url.hostname)) {
      return [];
    }
    const cookiesPath = this.configService.get<string>(
      'video.youtubeCookiesPath',
      '/run/secrets/youtube-cookies.txt',
    );
    if (!fs.existsSync(cookiesPath)) {
      return [];
    }
    this.logger.log(`Using YouTube cookies for hostname=${url.hostname}`);
    return ['--cookies', cookiesPath];
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Validate the URL platform, resolve via yt-dlp, mint a signed download
   * token, write an audit event, and return the token + filename + size.
   */
  async prepareDownload(
    rawUrl: string,
    userId: string,
  ): Promise<{ token: string; filename: string; sizeBytes?: number }> {
    // 1. Validate URL structure and platform
    const parsedUrl = this.validatePlatform(rawUrl);

    // 2. Resolve upstream URL via yt-dlp
    const ytResult = await this.resolveWithYtDlp(rawUrl);

    // 3. Build safe filename
    const filename = this.buildFilename(ytResult.title, ytResult.ext);

    // 4. Mint single-use signed token
    const jti = randomUUID();
    const ttl = this.configService.get<number>('video.tokenTtlSeconds', 120);
    const token = await this.jwtService.signAsync(
      {
        sub: userId,
        aud: 'video-download',
        original: rawUrl,
        filename,
        jti,
      } satisfies Omit<VideoDownloadTokenPayload, 'exp'>,
      {
        expiresIn: ttl,
        secret: this.configService.get<string>('jwt.secret'),
      },
    );

    // 5. Write audit event
    await this.writeAuditEvent(userId, parsedUrl.hostname, rawUrl, ytResult);

    return {
      token,
      filename,
      sizeBytes: ytResult.filesize,
    };
  }

  /**
   * Verify the signed download token and return the original URL and filename.
   * Replay within the 120-second TTL window is allowed — the same yt-dlp
   * subprocess will be spawned again, which is harmless.
   */
  async consumeToken(
    token: string,
  ): Promise<{ originalUrl: string; filename: string }> {
    let payload: VideoDownloadTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<VideoDownloadTokenPayload>(
        token,
        {
          secret: this.configService.get<string>('jwt.secret'),
          audience: 'video-download',
        },
      );
    } catch {
      throw new UnauthorizedException('Invalid or expired download token');
    }

    return { originalUrl: payload.original, filename: payload.filename };
  }

  /**
   * Spawn yt-dlp to download the video and pipe its stdout directly to the
   * raw Node ServerResponse. Sets Content-Type, Content-Disposition, and
   * Cache-Control before writing any bytes. Applies a hard 5-minute cap;
   * kills yt-dlp on client disconnect.
   *
   * If yt-dlp exits non-zero before any bytes have been sent, sets status 502.
   * If it errors after bytes have started flowing the response is destroyed
   * (client sees a truncated download — nothing better we can do at that point).
   */
  async streamToClient(
    originalUrl: string,
    filename: string,
    rawResponse: ServerResponse,
  ): Promise<void> {
    const streamTimeoutMs = this.configService.get<number>(
      'video.streamTimeoutMs',
      300_000,
    );

    // Defense-in-depth: re-validate the platform on the URL that is about
    // to be passed to yt-dlp (token could have been minted before the
    // allowlist changed, or the URL may have been tampered with at the DB
    // level in some future scenario).
    const parsedUrl = this.validatePlatform(originalUrl);

    const cookieArgs = this.getCookiesArgsForUrl(parsedUrl);
    const encodedFilename = encodeRfc5987(filename);

    rawResponse.setHeader('Content-Type', 'video/mp4');
    rawResponse.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodedFilename}`,
    );
    rawResponse.setHeader('Cache-Control', 'no-store');

    const proc = spawn(
      'yt-dlp',
      [
        '-o', '-',
        '-f', 'best[ext=mp4]/best',
        '--no-playlist',
        '--no-warnings',
        '--no-progress',
        '--quiet',
        ...cookieArgs,
        '--',
        originalUrl,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    // Cap stderr buffering at 64 KB to prevent runaway memory usage.
    const MAX_STDERR_BYTES = 64 * 1024;
    const stderrChunks: Buffer[] = [];
    let stderrBytes = 0;

    proc.stderr.on('data', (chunk: Buffer) => {
      if (stderrBytes < MAX_STDERR_BYTES) {
        stderrChunks.push(chunk);
        stderrBytes += chunk.length;
      }
    });

    // Track whether any video bytes have been flushed to the client so we
    // can still set a 502 status if yt-dlp fails before writing anything.
    let bytesStarted = false;
    proc.stdout.once('data', () => {
      bytesStarted = true;
    });

    // Kill yt-dlp if the client disconnects.
    let procKilled = false;
    const killProc = () => {
      if (!procKilled) {
        procKilled = true;
        proc.kill('SIGTERM');
        setTimeout(() => {
          if (!proc.killed) {
            proc.kill('SIGKILL');
          }
        }, 3000).unref();
      }
    };

    rawResponse.on('close', killProc);

    // Hard timeout.
    const timeoutHandle = setTimeout(() => {
      this.logger.warn({ filename }, 'yt-dlp stream timeout — killing process');
      killProc();
      if (!rawResponse.writableEnded) {
        rawResponse.destroy();
      }
    }, streamTimeoutMs);
    timeoutHandle.unref();

    // Wait for yt-dlp to exit (the pipeline resolves or rejects first).
    const exitPromise = new Promise<number | null>((resolve) => {
      proc.on('close', (code) => resolve(code));
    });

    try {
      await pipeline(proc.stdout, rawResponse);
    } catch (err) {
      // Premature close, EPIPE, ECONNRESET — all mean the client disconnected.
      const code = (err as NodeJS.ErrnoException).code;
      if (
        code === 'ERR_STREAM_PREMATURE_CLOSE' ||
        code === 'ECONNRESET' ||
        code === 'EPIPE'
      ) {
        killProc();
      } else if (!bytesStarted) {
        // pipeline errored before any bytes — send 502 if we still can.
        if (!rawResponse.headersSent) {
          rawResponse.statusCode = 502;
        }
        if (!rawResponse.writableEnded) {
          rawResponse.end('Video stream error');
        }
      } else {
        this.logger.warn(
          { err, filename },
          'yt-dlp stream error after bytes started — destroying response',
        );
        rawResponse.destroy();
      }
      return;
    } finally {
      clearTimeout(timeoutHandle);
      rawResponse.removeListener('close', killProc);
    }

    // Pipeline completed — check yt-dlp's exit code.
    const exitCode = await exitPromise;
    if (exitCode !== 0) {
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      if (stderr) {
        this.logger.warn({ exitCode, stderr, filename }, 'yt-dlp exited non-zero during stream');
      }

      if (!bytesStarted) {
        if (!rawResponse.headersSent) {
          rawResponse.statusCode = 502;
        }
        if (!rawResponse.writableEnded) {
          rawResponse.end('Video source returned an error');
        }
      } else {
        // Bytes already sent — can't change status, just destroy.
        if (!rawResponse.writableEnded) {
          rawResponse.destroy();
        }
      }
    }
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private validatePlatform(rawUrl: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new BadRequestException('Invalid URL');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException(PLATFORM_ERROR_MESSAGE);
    }

    const host = parsed.hostname.toLowerCase();
    const allowed = ALLOWED_PLATFORMS.some((re) => re.test(host));
    if (!allowed) {
      throw new BadRequestException(PLATFORM_ERROR_MESSAGE);
    }

    return parsed;
  }

  private async resolveWithYtDlp(userUrl: string): Promise<YtDlpResult> {
    const timeoutMs = this.configService.get<number>(
      'video.ytDlpTimeoutMs',
      15_000,
    );

    return new Promise<YtDlpResult>((resolve, reject) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      const parsedUrl = new URL(userUrl);
      const cookieArgs = this.getCookiesArgsForUrl(parsedUrl);

      const proc = spawn(
        'yt-dlp',
        [
          '-j',
          '--no-playlist',
          '--no-warnings',
          '-f',
          'best[ext=mp4]/best',
          ...cookieArgs,
          '--',
          userUrl,
        ],
        { timeout: timeoutMs },
      );

      proc.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      proc.on('error', (err) => {
        this.logger.warn({ err }, 'yt-dlp process error');
        reject(new BadGatewayException('Could not resolve video URL'));
      });

      proc.on('close', (code) => {
        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
        const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();

        if (code !== 0) {
          if (stderr) {
            this.logger.warn(`yt-dlp stderr: ${stderr}`);
          }

          if (BOT_GATE_STDERR_PATTERN.test(stderr)) {
            reject(
              new UnprocessableEntityException(
                'This YouTube video requires authentication cookies. See docs/youtube-cookies.md for setup.',
              ),
            );
            return;
          }

          const match = USER_FACING_STDERR_PATTERN.exec(stderr);
          if (match) {
            // Extract the first line that contains the matched keyword
            const line = stderr
              .split('\n')
              .find((l) => USER_FACING_STDERR_PATTERN.test(l));
            const sanitized = (line ?? stderr)
              .replace(/[<>&"']/g, '') // strip basic HTML/shell specials
              .trim()
              .slice(0, 200);
            reject(new UnprocessableEntityException(sanitized));
          } else {
            reject(new BadGatewayException('Could not resolve video URL'));
          }
          return;
        }

        // Parse yt-dlp JSON output
        let info: Record<string, unknown>;
        try {
          info = JSON.parse(stdout);
        } catch {
          this.logger.warn('yt-dlp returned non-JSON stdout');
          reject(new BadGatewayException('Could not resolve video URL'));
          return;
        }

        const url = info['url'] as string | undefined;
        if (!url) {
          this.logger.warn('yt-dlp JSON missing url field');
          reject(new BadGatewayException('Could not resolve video URL'));
          return;
        }

        resolve({
          url,
          ext: (info['ext'] as string | undefined) ?? 'mp4',
          title: (info['title'] as string | undefined) ?? 'video',
          filesize:
            (info['filesize'] as number | undefined) ??
            (info['filesize_approx'] as number | undefined),
        });
      });
    });
  }

  private buildFilename(title: string, ext: string): string {
    // Strip unsafe chars: path separators, null bytes, control chars
    const safe = title
      .replace(/[/\\]/g, '-')
      .replace(/[\x00-\x1f\x7f]/g, '')
      .trim()
      .slice(0, 100);

    return `${safe}.${ext}`;
  }

  private async writeAuditEvent(
    userId: string,
    hostname: string,
    url: string,
    ytResult: YtDlpResult,
  ): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: {
          actorUserId: userId,
          action: 'video.download.prepare',
          targetType: 'video',
          targetId: hostname,
          meta: {
            url,
            title: ytResult.title,
            ext: ytResult.ext,
            filesize: ytResult.filesize ?? null,
          } as any,
        },
      });
    } catch (err) {
      // Audit failures must never block the response
      this.logger.warn({ err }, 'Failed to write video download audit event');
    }
  }
}

// =============================================================================
// RFC 5987 encoding helper
// =============================================================================

/**
 * Encode a filename string per RFC 5987 for use in Content-Disposition.
 * Percent-encodes all characters except unreserved ones (RFC 3986).
 */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
