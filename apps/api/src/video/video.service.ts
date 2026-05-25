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
import * as http from 'node:http';
import * as https from 'node:https';
import { pipeline } from 'node:stream/promises';
import type { ServerResponse } from 'node:http';

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

// =============================================================================
// Token payload interface
// =============================================================================

interface VideoDownloadTokenPayload {
  sub: string;
  aud: string;
  upstream: string;
  filename: string;
  original: string;
  jti: string;
  headers?: Record<string, string>;
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
  headers?: Record<string, string>;
}

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);

  /**
   * In-memory single-use JTI store: jti -> expiry timestamp (ms since epoch).
   * Entries are evicted lazily on each access and by a periodic cleanup.
   */
  private readonly usedJtis = new Map<string, number>();

  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {
    // Clean up expired JTIs every 5 minutes
    this.cleanupInterval = setInterval(
      () => this.evictExpiredJtis(),
      5 * 60 * 1000,
    );
  }

  onModuleDestroy() {
    clearInterval(this.cleanupInterval);
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
        upstream: ytResult.url,
        filename,
        original: rawUrl,
        jti,
        headers: ytResult.headers,
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
   * Verify the signed download token and mark it as used.
   * Returns the resolved upstream URL and filename.
   */
  async consumeToken(
    token: string,
  ): Promise<{ upstreamUrl: string; filename: string; headers?: Record<string, string> }> {
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

    // Check single-use: evict stale entries first, then check
    this.evictExpiredJtis();
    if (this.usedJtis.has(payload.jti)) {
      throw new UnauthorizedException('Download token has already been used');
    }

    // Mark as used with its expiry so cleanup can remove it later
    const expiresAtMs = (payload.exp ?? 0) * 1000;
    this.usedJtis.set(payload.jti, expiresAtMs);

    return { upstreamUrl: payload.upstream, filename: payload.filename, headers: payload.headers };
  }

  /**
   * Open an HTTP/HTTPS stream to upstreamUrl and pipe it to the raw Node
   * ServerResponse. Sets Content-Type, Content-Length, Content-Disposition,
   * and Cache-Control. Aborts on client disconnect. Hard 5-minute cap.
   * Follows up to 5 redirects. Returns 502 to the client if the upstream
   * responds with an error status.
   */
  async streamToClient(
    upstreamUrl: string,
    filename: string,
    rawResponse: ServerResponse,
    headers?: Record<string, string>,
  ): Promise<void> {
    const streamTimeoutMs = this.configService.get<number>(
      'video.streamTimeoutMs',
      300_000,
    );

    const MAX_REDIRECTS = 5;

    const fetchUrl = (url: string, redirectsLeft: number): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        const parsedUpstream = new URL(url);
        const transport = parsedUpstream.protocol === 'https:' ? https : http;

        const req = transport.get(url, { headers: headers ?? {} }, (upstreamRes) => {
          const status = upstreamRes.statusCode ?? 0;

          // Handle redirects
          if (
            [301, 302, 303, 307, 308].includes(status) &&
            upstreamRes.headers['location']
          ) {
            upstreamRes.resume(); // drain the redirect body
            if (redirectsLeft <= 0) {
              this.logger.warn(`Upstream redirect limit exceeded for ${url}`);
              rawResponse.statusCode = 502;
              rawResponse.end();
              resolve();
              return;
            }
            const location = upstreamRes.headers['location'] as string;
            // Resolve relative redirects against the current URL
            const nextUrl = new URL(location, url).toString();
            this.logger.log(
              `Upstream redirect ${status} -> ${nextUrl} (${redirectsLeft - 1} left)`,
            );
            fetchUrl(nextUrl, redirectsLeft - 1).then(resolve).catch(reject);
            return;
          }

          // Bail on upstream error responses
          if (status >= 400) {
            const bodyChunks: Buffer[] = [];
            upstreamRes.on('data', (chunk: Buffer) => {
              if (bodyChunks.reduce((acc, c) => acc + c.length, 0) < 200) {
                bodyChunks.push(chunk);
              }
            });
            upstreamRes.on('end', () => {
              const body = Buffer.concat(bodyChunks).toString('utf8').slice(0, 200);
              this.logger.warn(
                { upstreamStatus: status, body },
                `Upstream responded with ${status} for ${url}`,
              );
              rawResponse.statusCode = 502;
              rawResponse.end();
              resolve();
            });
            return;
          }

          const contentType =
            upstreamRes.headers['content-type'] ?? 'video/mp4';
          const contentLength = upstreamRes.headers['content-length'];
          const encodedFilename = encodeRfc5987(filename);

          rawResponse.setHeader('Content-Type', contentType);
          rawResponse.setHeader(
            'Content-Disposition',
            `attachment; filename*=UTF-8''${encodedFilename}`,
          );
          rawResponse.setHeader('Cache-Control', 'no-store');
          if (contentLength) {
            rawResponse.setHeader('Content-Length', contentLength);
          }

          // Abort upstream on client disconnect
          rawResponse.on('close', () => {
            req.destroy();
          });

          pipeline(upstreamRes, rawResponse)
            .then(resolve)
            .catch((err) => {
              // Ignore premature close errors (client disconnected)
              if (
                err?.code === 'ERR_STREAM_PREMATURE_CLOSE' ||
                err?.code === 'ECONNRESET' ||
                err?.code === 'EPIPE'
              ) {
                resolve();
              } else {
                reject(err);
              }
            });
        });

        req.on('error', reject);

        // Hard 5-minute cap
        req.setTimeout(streamTimeoutMs, () => {
          req.destroy(new Error('Upstream stream timeout'));
        });
      });

    if (headers && Object.keys(headers).length > 0) {
      this.logger.log(
        { headerKeys: Object.keys(headers) },
        'Forwarding upstream headers on video stream',
      );
    }

    await fetchUrl(upstreamUrl, MAX_REDIRECTS);
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

      const proc = spawn(
        'yt-dlp',
        [
          '-j',
          '--no-playlist',
          '--no-warnings',
          '-f',
          'best[ext=mp4]/best',
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

        // Extract http_headers defensively: only include if it's a non-empty
        // object whose values are all strings.
        const rawHeaders = info['http_headers'];
        let httpHeaders: Record<string, string> | undefined;
        if (
          rawHeaders !== null &&
          typeof rawHeaders === 'object' &&
          !Array.isArray(rawHeaders)
        ) {
          const entries = Object.entries(rawHeaders as Record<string, unknown>).filter(
            ([, v]) => typeof v === 'string',
          ) as [string, string][];
          if (entries.length > 0) {
            httpHeaders = Object.fromEntries(entries);
          }
        }

        resolve({
          url,
          ext: (info['ext'] as string | undefined) ?? 'mp4',
          title: (info['title'] as string | undefined) ?? 'video',
          filesize:
            (info['filesize'] as number | undefined) ??
            (info['filesize_approx'] as number | undefined),
          headers: httpHeaders,
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

  private evictExpiredJtis(): void {
    const now = Date.now();
    for (const [jti, expiresAt] of this.usedJtis.entries()) {
      if (expiresAt <= now) {
        this.usedJtis.delete(jti);
      }
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
