/**
 * Unit tests for VideoService.
 *
 * Strategy for child_process.spawn:
 *   jest.mock() replaces the entire module before any import runs.
 *   The mock factory returns a jest.fn() for `spawn` so we can control
 *   what each test gets back.
 */

// ---------------------------------------------------------------------------
// Module-level mock for child_process – must be hoisted above imports
// ---------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

/**
 * Build a fake ChildProcess-like object whose events fire on the next tick so
 * callers can attach listeners first.
 *
 * stdout is a real `Readable` stream so that `pipeline(proc.stdout, ...)` works
 * correctly in streamToClient tests. For the prepare-phase tests (resolveWithYtDlp),
 * the service manually attaches `.on('data')` / `.on('close')` listeners which also
 * work on Readable.
 *
 * Pass `streamChunks` to push video bytes through the Readable before ending it.
 * Pass `stdout` (string) to push it as a single data chunk (for JSON-parsing tests).
 */
function makeFakeProcess(opts: {
  exitCode: number;
  stdout: string;
  stderr: string;
  kill?: () => void;
  streamChunks?: Buffer[];
}): EventEmitter & {
  stdout: Readable;
  stderr: EventEmitter;
  kill: (signal?: string) => boolean;
  killed: boolean;
  stdio: unknown[];
} {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: Readable;
    stderr: EventEmitter;
    kill: (signal?: string) => boolean;
    killed: boolean;
    stdio: unknown[];
  };

  // Build a real Readable that will push the configured chunks then end.
  const stdoutReadable = new Readable({
    read() {
      // Chunks are pushed asynchronously below via setImmediate.
    },
  });
  proc.stdout = stdoutReadable;
  proc.stderr = new EventEmitter();
  proc.killed = false;
  proc.stdio = [null, proc.stdout, proc.stderr];
  proc.kill = (signal?: string) => {
    proc.killed = true;
    opts.kill?.();
    stdoutReadable.destroy();
    setImmediate(() => proc.emit('close', signal === 'SIGTERM' ? 143 : 137));
    return true;
  };

  setImmediate(() => {
    if (opts.streamChunks) {
      for (const chunk of opts.streamChunks) {
        stdoutReadable.push(chunk);
      }
    } else if (opts.stdout) {
      stdoutReadable.push(Buffer.from(opts.stdout));
    }
    if (opts.stderr) proc.stderr.emit('data', Buffer.from(opts.stderr));
    stdoutReadable.push(null); // EOF
    proc.emit('close', opts.exitCode);
  });

  return proc;
}

// The jest.fn() is stored outside so tests can override it per-case.
const spawnMock = jest.fn();

jest.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

// fs mock: existsSync is controlled per-test via existsSyncMock.mockReturnValue(...)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const existsSyncMock = jest.fn((_path?: unknown): boolean => false);

jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  existsSync: (path: unknown) => existsSyncMock(path),
}));

// ---------------------------------------------------------------------------
// Regular imports (after the mock declaration)
// ---------------------------------------------------------------------------

import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  BadGatewayException,
  UnprocessableEntityException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { VideoService } from './video.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../../test/mocks/prisma.mock';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JWT_SECRET = 'test-secret-at-least-32-chars-long!!';

const VALID_YT_JSON = JSON.stringify({
  url: 'https://cdn.example.com/video.mp4',
  ext: 'mp4',
  title: 'Test Video',
  filesize: 12345678,
});

// ---------------------------------------------------------------------------
// Factory: build a TestingModule with mocked deps
// ---------------------------------------------------------------------------

async function buildModule(opts: {
  prisma?: MockPrismaService;
  jwtService?: Partial<JwtService>;
  tokenTtlSeconds?: number;
}) {
  const prisma = opts.prisma ?? createMockPrismaService();
  const tokenTtl = opts.tokenTtlSeconds ?? 120;

  const configGet = jest.fn((key: string, defaultVal?: unknown) => {
    if (key === 'jwt.secret') return JWT_SECRET;
    if (key === 'video.tokenTtlSeconds') return tokenTtl;
    if (key === 'video.ytDlpTimeoutMs') return 15_000;
    if (key === 'video.streamTimeoutMs') return 300_000;
    if (key === 'video.cookiesPaths') return {
      youtube: '/run/secrets/youtube-cookies.txt',
      instagram: '/run/secrets/instagram-cookies.txt',
      tiktok: '/run/secrets/tiktok-cookies.txt',
      x: '/run/secrets/x-cookies.txt',
      facebook: '/run/secrets/facebook-cookies.txt',
    };
    return defaultVal;
  });

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      VideoService,
      { provide: PrismaService, useValue: prisma },
      {
        provide: JwtService,
        useValue: opts.jwtService ?? { signAsync: jest.fn(), verifyAsync: jest.fn() },
      },
      { provide: ConfigService, useValue: { get: configGet } },
    ],
  }).compile();

  return {
    service: module.get<VideoService>(VideoService),
    prisma,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('VideoService', () => {
  let service: VideoService;
  let mockPrisma: MockPrismaService;
  let mockJwtSign: jest.Mock;
  let mockJwtVerify: jest.Mock;

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();
    mockJwtSign = jest.fn();
    mockJwtVerify = jest.fn();

    const built = await buildModule({
      prisma: mockPrisma,
      jwtService: { signAsync: mockJwtSign, verifyAsync: mockJwtVerify },
    });
    service = built.service;

    // Default spawn: success with valid JSON
    spawnMock.mockImplementation(() =>
      makeFakeProcess({ exitCode: 0, stdout: VALID_YT_JSON, stderr: '' }),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // 1. Platform allowlist – table-driven
  // =========================================================================

  describe('validatePlatform (via prepareDownload)', () => {
    const ACCEPTED_URLS = [
      'https://youtu.be/abc',
      'https://www.youtube.com/watch?v=abc',
      'https://m.youtube.com/watch?v=abc',
      'https://x.com/u/status/1',
      'https://twitter.com/u/status/1',
      'https://www.instagram.com/reel/abc/',
      'https://www.tiktok.com/@u/video/1',
      'https://vm.tiktok.com/abc',
      'https://fb.watch/abc/',
      'https://www.facebook.com/watch/?v=1',
    ];

    const REJECTED_URLS = [
      'https://evil.com/foo',
      'ftp://youtube.com/x',
      'http://youtube.com.evil.com/x',
      'not-a-url',
      'https://subdomain.youtube.com.attacker/x',
      '',
    ];

    beforeEach(() => {
      mockJwtSign.mockResolvedValue('signed-token');
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);
    });

    it.each(ACCEPTED_URLS)(
      'should accept platform URL: %s',
      async (url) => {
        spawnMock.mockImplementation(() =>
          makeFakeProcess({ exitCode: 0, stdout: VALID_YT_JSON, stderr: '' }),
        );
        await expect(service.prepareDownload(url, 'user-1')).resolves.not.toThrow();
      },
    );

    it.each(REJECTED_URLS)(
      'should reject with BadRequestException for URL: %s',
      async (url) => {
        await expect(service.prepareDownload(url, 'user-1')).rejects.toThrow(
          BadRequestException,
        );
      },
    );
  });

  // =========================================================================
  // 2. Signed token round-trip
  //    Use the real JwtService to exercise actual sign/verify.
  // =========================================================================

  describe('consumeToken (round-trip with real JwtService)', () => {
    let realService: VideoService;
    let realPrisma: MockPrismaService;

    beforeEach(async () => {
      realPrisma = createMockPrismaService();
      realPrisma.auditEvent.create.mockResolvedValue({} as any);

      const module = await Test.createTestingModule({
        providers: [
          VideoService,
          { provide: PrismaService, useValue: realPrisma },
          JwtService, // real implementation
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultVal?: unknown) => {
                if (key === 'jwt.secret') return JWT_SECRET;
                if (key === 'video.tokenTtlSeconds') return 30;
                if (key === 'video.ytDlpTimeoutMs') return 15_000;
                if (key === 'video.cookiesPaths') return { youtube: '/run/secrets/youtube-cookies.txt', instagram: '/run/secrets/instagram-cookies.txt', tiktok: '/run/secrets/tiktok-cookies.txt', x: '/run/secrets/x-cookies.txt', facebook: '/run/secrets/facebook-cookies.txt' };
                return defaultVal;
              }),
            },
          },
        ],
      }).compile();

      realService = module.get<VideoService>(VideoService);
    });

    it('should verify a freshly signed token and return original URL and filename', async () => {
      spawnMock.mockImplementation(() =>
        makeFakeProcess({
          exitCode: 0,
          stdout: JSON.stringify({ url: 'https://cdn.example.com/v.mp4', ext: 'mp4', title: 'RT Video', filesize: 500 }),
          stderr: '',
        }),
      );

      const originalInput = 'https://www.youtube.com/watch?v=abc';
      const { token } = await realService.prepareDownload(originalInput, 'user-rt');

      const result = await realService.consumeToken(token);
      expect(result).toMatchObject({
        originalUrl: originalInput,
        filename: 'RT Video.mp4',
      });
      // upstream CDN URL should NOT be stored in the token
      expect(result).not.toHaveProperty('upstreamUrl');
      expect(result).not.toHaveProperty('headers');
    });

    it('should throw UnauthorizedException for a tampered token', async () => {
      spawnMock.mockImplementation(() =>
        makeFakeProcess({
          exitCode: 0,
          stdout: JSON.stringify({ url: 'https://cdn.example.com/v.mp4', ext: 'mp4', title: 'Tamper', filesize: 100 }),
          stderr: '',
        }),
      );

      const { token } = await realService.prepareDownload(
        'https://www.youtube.com/watch?v=abc',
        'user-tamper',
      );

      // Corrupt the signature part
      const parts = token.split('.');
      parts[2] = parts[2].split('').reverse().join('');
      const tampered = parts.join('.');

      await expect(realService.consumeToken(tampered)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for an expired token', async () => {
      // Build a separate service with 1-second TTL
      const expiredPrisma = createMockPrismaService();
      expiredPrisma.auditEvent.create.mockResolvedValue({} as any);

      const expiredModule = await Test.createTestingModule({
        providers: [
          VideoService,
          { provide: PrismaService, useValue: expiredPrisma },
          JwtService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultVal?: unknown) => {
                if (key === 'jwt.secret') return JWT_SECRET;
                if (key === 'video.tokenTtlSeconds') return 1; // 1-second TTL
                if (key === 'video.ytDlpTimeoutMs') return 15_000;
                if (key === 'video.cookiesPaths') return { youtube: '/run/secrets/youtube-cookies.txt', instagram: '/run/secrets/instagram-cookies.txt', tiktok: '/run/secrets/tiktok-cookies.txt', x: '/run/secrets/x-cookies.txt', facebook: '/run/secrets/facebook-cookies.txt' };
                return defaultVal;
              }),
            },
          },
        ],
      }).compile();

      const expiredService = expiredModule.get<VideoService>(VideoService);

      spawnMock.mockImplementation(() =>
        makeFakeProcess({
          exitCode: 0,
          stdout: JSON.stringify({ url: 'https://cdn.example.com/v.mp4', ext: 'mp4', title: 'Expire', filesize: 100 }),
          stderr: '',
        }),
      );

      const { token } = await expiredService.prepareDownload(
        'https://www.youtube.com/watch?v=exp',
        'user-exp',
      );

      // Wait for the token to expire
      await new Promise((r) => setTimeout(r, 1500));

      await expect(expiredService.consumeToken(token)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should allow the same valid token to be consumed twice (replay within TTL is permitted)', async () => {
      spawnMock.mockImplementation(() =>
        makeFakeProcess({
          exitCode: 0,
          stdout: JSON.stringify({ url: 'https://cdn.example.com/v.mp4', ext: 'mp4', title: 'Replay Video', filesize: 200 }),
          stderr: '',
        }),
      );

      const originalInput = 'https://www.youtube.com/watch?v=abc';
      const { token } = await realService.prepareDownload(originalInput, 'user-replay');

      const first = await realService.consumeToken(token);
      const second = await realService.consumeToken(token);

      expect(first).toMatchObject({ originalUrl: originalInput, filename: 'Replay Video.mp4' });
      expect(second).toMatchObject({ originalUrl: originalInput, filename: 'Replay Video.mp4' });
    });
  });

  // =========================================================================
  // 3. yt-dlp error mapping
  // =========================================================================

  describe('resolveWithYtDlp (via prepareDownload)', () => {
    beforeEach(() => {
      mockJwtSign.mockResolvedValue('signed-token');
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);
    });

    it('should throw UnprocessableEntityException when stderr contains "Private video"', async () => {
      spawnMock.mockImplementation(() =>
        makeFakeProcess({
          exitCode: 1,
          stdout: '',
          stderr: 'ERROR: Private video. Sign in if you have been granted access.',
        }),
      );

      await expect(
        service.prepareDownload('https://www.youtube.com/watch?v=abc', 'user-1'),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should throw UnprocessableEntityException when stderr contains "Video unavailable"', async () => {
      spawnMock.mockImplementation(() =>
        makeFakeProcess({
          exitCode: 1,
          stdout: '',
          stderr: 'ERROR: Video unavailable',
        }),
      );

      await expect(
        service.prepareDownload('https://www.youtube.com/watch?v=abc', 'user-1'),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should throw BadGatewayException when stderr does not match user-facing patterns', async () => {
      spawnMock.mockImplementation(() =>
        makeFakeProcess({
          exitCode: 1,
          stdout: '',
          stderr: 'ERROR: [youtube] abc: Unexpected network error',
        }),
      );

      await expect(
        service.prepareDownload('https://www.youtube.com/watch?v=abc', 'user-1'),
      ).rejects.toThrow(BadGatewayException);
    });

    it('should return parsed metadata on zero-exit with valid JSON', async () => {
      const ytPayload = {
        url: 'https://cdn.example.com/video.mp4',
        ext: 'mp4',
        title: 'My Cool Video',
        filesize: 12345678,
      };

      spawnMock.mockImplementation(() =>
        makeFakeProcess({ exitCode: 0, stdout: JSON.stringify(ytPayload), stderr: '' }),
      );

      const result = await service.prepareDownload(
        'https://www.youtube.com/watch?v=abc',
        'user-1',
      );

      expect(result).toMatchObject({
        filename: 'My Cool Video.mp4',
        sizeBytes: 12345678,
        token: expect.any(String),
      });
    });

    it('should throw on zero-exit with malformed JSON stdout', async () => {
      spawnMock.mockImplementation(() =>
        makeFakeProcess({ exitCode: 0, stdout: 'not valid json {{{{', stderr: '' }),
      );

      await expect(
        service.prepareDownload('https://www.youtube.com/watch?v=abc', 'user-1'),
      ).rejects.toThrow();
    });

    it('should throw BadGatewayException when JSON is valid but missing url field', async () => {
      spawnMock.mockImplementation(() =>
        makeFakeProcess({
          exitCode: 0,
          stdout: JSON.stringify({ ext: 'mp4', title: 'No URL Here' }),
          stderr: '',
        }),
      );

      await expect(
        service.prepareDownload('https://www.youtube.com/watch?v=abc', 'user-1'),
      ).rejects.toThrow(BadGatewayException);
    });
  });

  // =========================================================================
  // 4. Audit event
  // =========================================================================

  describe('writeAuditEvent (via prepareDownload)', () => {
    it('should call prisma.auditEvent.create once with the expected shape after successful prepare', async () => {
      const ytPayload = {
        url: 'https://cdn.example.com/video.mp4',
        ext: 'mp4',
        title: 'Audit Test Video',
        filesize: 99999,
      };

      spawnMock.mockImplementation(() =>
        makeFakeProcess({ exitCode: 0, stdout: JSON.stringify(ytPayload), stderr: '' }),
      );

      mockJwtSign.mockResolvedValue('audit-token');
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      const rawUrl = 'https://www.youtube.com/watch?v=audit';
      await service.prepareDownload(rawUrl, 'user-audit');

      expect(mockPrisma.auditEvent.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: 'user-audit',
          action: 'video.download.prepare',
          targetType: 'video',
          targetId: 'www.youtube.com',
          meta: expect.objectContaining({
            url: rawUrl,
            title: ytPayload.title,
            ext: ytPayload.ext,
            filesize: ytPayload.filesize,
          }),
        }),
      });
    });

    it('should not throw if audit event creation fails', async () => {
      const ytPayload = {
        url: 'https://cdn.example.com/video.mp4',
        ext: 'mp4',
        title: 'Audit Fail Safe',
        filesize: 100,
      };

      spawnMock.mockImplementation(() =>
        makeFakeProcess({ exitCode: 0, stdout: JSON.stringify(ytPayload), stderr: '' }),
      );

      mockJwtSign.mockResolvedValue('token-x');
      mockPrisma.auditEvent.create.mockRejectedValue(new Error('DB down'));

      await expect(
        service.prepareDownload('https://www.youtube.com/watch?v=audit', 'user-audit2'),
      ).resolves.toBeDefined();
    });
  });

  // =========================================================================
  // 5. streamToClient — yt-dlp subprocess smoke tests
  // =========================================================================

  describe('streamToClient', () => {
    /**
     * Build a fake ServerResponse backed by a real PassThrough stream so that
     * `pipeline(proc.stdout, rawResponse)` works correctly (pipeline requires a
     * proper Writable). We wrap the PassThrough and spy on key methods.
     */
    function makeRawResponse() {
      const { PassThrough } = require('node:stream') as typeof import('node:stream');
      const pt = new PassThrough();

      // Track whether destroy() was called on the PassThrough.
      const originalDestroy = pt.destroy.bind(pt);
      const destroyMock = jest.fn((...args: unknown[]) => {
        (pt as any)._destroyCalled = true;
        originalDestroy(...(args as Parameters<typeof originalDestroy>));
      });
      pt.destroy = destroyMock as unknown as typeof pt.destroy;

      // Overlay the extra properties that ServerResponse has but PassThrough lacks.
      const overlay = pt as typeof pt & {
        statusCode: number;
        headersSent: boolean;
        headers: Record<string, unknown>;
        setHeader: jest.Mock;
        end: jest.Mock;
        destroy: jest.Mock;
        _destroyCalled: boolean;
      };

      overlay.statusCode = 200;
      overlay.headersSent = false;
      overlay._destroyCalled = false;
      overlay.headers = {};

      overlay.setHeader = jest.fn((name: string, value: unknown) => {
        overlay.headers[name] = value;
      });

      // Override end to track writableEnded (PassThrough already sets it, but we
      // want to spy on the call and be sure it's being called by streamToClient).
      const originalEnd = pt.end.bind(pt);
      overlay.end = jest.fn((...args: unknown[]) => {
        originalEnd(...(args as Parameters<typeof originalEnd>));
      }) as unknown as jest.Mock;

      return overlay;
    }

    it('should set response headers before piping', async () => {
      const videoData = Buffer.from('fake-video-bytes');
      spawnMock.mockImplementation(() =>
        makeFakeProcess({
          exitCode: 0,
          stdout: '',
          stderr: '',
          streamChunks: [videoData],
        }),
      );

      const rawResponse = makeRawResponse();
      await service.streamToClient(
        'https://www.youtube.com/watch?v=abc',
        'My Video.mp4',
        rawResponse as any,
      );

      expect(rawResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'video/mp4');
      expect(rawResponse.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(rawResponse.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('attachment'),
      );
    });

    it('should spawn yt-dlp with the correct args including -- separator', async () => {
      const videoData = Buffer.from('bytes');
      spawnMock.mockImplementation(() =>
        makeFakeProcess({ exitCode: 0, stdout: '', stderr: '', streamChunks: [videoData] }),
      );

      const rawResponse = makeRawResponse();
      const url = 'https://www.youtube.com/watch?v=test';
      await service.streamToClient(url, 'test.mp4', rawResponse as any);

      expect(spawnMock).toHaveBeenCalledWith(
        'yt-dlp',
        expect.arrayContaining(['--', url]),
        expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] }),
      );
    });

    it('should reject unsupported platform URLs (defense-in-depth)', async () => {
      const rawResponse = makeRawResponse();
      await expect(
        service.streamToClient('https://evil.com/video', 'bad.mp4', rawResponse as any),
      ).rejects.toThrow();
      // spawn should never have been called for the stream
      expect(spawnMock).not.toHaveBeenCalled();
    });

    it('should set status 502 and end response when yt-dlp exits non-zero with no bytes sent', async () => {
      spawnMock.mockImplementation(() =>
        makeFakeProcess({
          exitCode: 1,
          stdout: '',
          stderr: 'ERROR: network failure',
          streamChunks: [], // no bytes emitted
        }),
      );

      const rawResponse = makeRawResponse();
      await service.streamToClient(
        'https://www.youtube.com/watch?v=fail',
        'fail.mp4',
        rawResponse as any,
      );

      // 502 must be set when no bytes have been sent
      expect(rawResponse.statusCode).toBe(502);
      expect(rawResponse.end).toHaveBeenCalled();
    });

    it('should not set 502 when yt-dlp exits non-zero after bytes have been piped', async () => {
      // When bytes are emitted, pipeline writes them and then ends the response
      // cleanly. If yt-dlp then exits non-zero, the response is already finalized —
      // we cannot change the status code. The service must NOT call end() a second
      // time and must NOT set statusCode = 502.
      const videoChunk = Buffer.from('partial-video-data');
      spawnMock.mockImplementation(() =>
        makeFakeProcess({
          exitCode: 1,
          stdout: '',
          stderr: 'ERROR: mid-stream failure',
          streamChunks: [videoChunk], // bytes ARE emitted before exit
        }),
      );

      const rawResponse = makeRawResponse();
      await service.streamToClient(
        'https://www.youtube.com/watch?v=partial',
        'partial.mp4',
        rawResponse as any,
      );

      // Status must NOT be 502 (bytes were already sent)
      expect(rawResponse.statusCode).toBe(200); // unchanged
      // end() is called once by pipeline completing — not a second time by error logic
      expect(rawResponse.end).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // 6. getCookiesArgsForUrl — per-platform cookie injection logic
  // =========================================================================

  describe('getCookiesArgsForUrl (via spawn args)', () => {
    beforeEach(() => {
      mockJwtSign.mockResolvedValue('signed-token');
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);
      existsSyncMock.mockReset();
      existsSyncMock.mockReturnValue(false);
    });

    // -----------------------------------------------------------------------
    // 6a. Cookies file present → --cookies injected (one test per platform)
    // -----------------------------------------------------------------------

    const PLATFORM_PRESENT_CASES: Array<{
      platform: string;
      url: string;
      cookiesPath: string;
    }> = [
      {
        platform: 'youtube',
        url: 'https://www.youtube.com/watch?v=abc',
        cookiesPath: '/run/secrets/youtube-cookies.txt',
      },
      {
        platform: 'instagram',
        url: 'https://www.instagram.com/reel/abc/',
        cookiesPath: '/run/secrets/instagram-cookies.txt',
      },
      {
        platform: 'tiktok',
        url: 'https://www.tiktok.com/@user/video/1',
        cookiesPath: '/run/secrets/tiktok-cookies.txt',
      },
      {
        platform: 'x',
        url: 'https://x.com/user/status/1',
        cookiesPath: '/run/secrets/x-cookies.txt',
      },
      {
        platform: 'facebook',
        url: 'https://www.facebook.com/watch/?v=1',
        cookiesPath: '/run/secrets/facebook-cookies.txt',
      },
    ];

    it.each(PLATFORM_PRESENT_CASES)(
      'should pass --cookies flag for $platform URL when cookies file exists',
      async ({ url, cookiesPath }) => {
        // Only the target platform's cookies file exists.
        existsSyncMock.mockImplementation((p: unknown) => p === cookiesPath);

        spawnMock.mockImplementation(() =>
          makeFakeProcess({ exitCode: 0, stdout: VALID_YT_JSON, stderr: '' }),
        );

        await service.prepareDownload(url, 'user-1');

        const spawnArgs: string[] = spawnMock.mock.calls[0][1];
        expect(spawnArgs).toContain('--cookies');
        expect(spawnArgs).toContain(cookiesPath);
        // --cookies must appear before the -- separator
        expect(spawnArgs.indexOf('--cookies')).toBeLessThan(spawnArgs.indexOf('--'));
      },
    );

    // -----------------------------------------------------------------------
    // 6b. Cookies file absent → no --cookies flag (one test per platform)
    // -----------------------------------------------------------------------

    it.each(PLATFORM_PRESENT_CASES)(
      'should not pass --cookies flag for $platform URL when cookies file is missing',
      async ({ url }) => {
        existsSyncMock.mockReturnValue(false);

        spawnMock.mockImplementation(() =>
          makeFakeProcess({ exitCode: 0, stdout: VALID_YT_JSON, stderr: '' }),
        );

        await service.prepareDownload(url, 'user-1');

        const spawnArgs: string[] = spawnMock.mock.calls[0][1];
        expect(spawnArgs).not.toContain('--cookies');
      },
    );

    // -----------------------------------------------------------------------
    // 6c. Cross-platform isolation — cookies present for platform A must NOT
    //     be injected into a request for platform B.
    // -----------------------------------------------------------------------

    const CROSS_PLATFORM_CASES: Array<{
      cookiesPlatform: string;
      cookiesPath: string;
      requestPlatform: string;
      requestUrl: string;
    }> = [
      {
        cookiesPlatform: 'youtube',
        cookiesPath: '/run/secrets/youtube-cookies.txt',
        requestPlatform: 'instagram',
        requestUrl: 'https://www.instagram.com/reel/abc/',
      },
      {
        cookiesPlatform: 'instagram',
        cookiesPath: '/run/secrets/instagram-cookies.txt',
        requestPlatform: 'tiktok',
        requestUrl: 'https://www.tiktok.com/@user/video/1',
      },
      {
        cookiesPlatform: 'tiktok',
        cookiesPath: '/run/secrets/tiktok-cookies.txt',
        requestPlatform: 'x',
        requestUrl: 'https://x.com/user/status/1',
      },
      {
        cookiesPlatform: 'facebook',
        cookiesPath: '/run/secrets/facebook-cookies.txt',
        requestPlatform: 'youtube',
        requestUrl: 'https://www.youtube.com/watch?v=abc',
      },
    ];

    it.each(CROSS_PLATFORM_CASES)(
      'should not inject $cookiesPlatform cookies into a $requestPlatform request',
      async ({ cookiesPath, requestUrl }) => {
        // Only the wrong platform's file exists.
        existsSyncMock.mockImplementation((p: unknown) => p === cookiesPath);

        spawnMock.mockImplementation(() =>
          makeFakeProcess({ exitCode: 0, stdout: VALID_YT_JSON, stderr: '' }),
        );

        await service.prepareDownload(requestUrl, 'user-1');

        const spawnArgs: string[] = spawnMock.mock.calls[0][1];
        expect(spawnArgs).not.toContain('--cookies');
      },
    );

    // -----------------------------------------------------------------------
    // 6d. Bot-gate stderr → UnprocessableEntityException with platform name
    // -----------------------------------------------------------------------

    const BOT_GATE_CASES: Array<{
      platform: string;
      url: string;
      stderr: string;
    }> = [
      {
        platform: 'youtube',
        url: 'https://www.youtube.com/watch?v=abc',
        stderr: 'ERROR: Sign in to confirm your age. This video may be inappropriate for some users.',
      },
      {
        platform: 'instagram',
        url: 'https://www.instagram.com/reel/abc/',
        stderr: 'ERROR: Requested content is not available, rate-limit reached or login required.',
      },
    ];

    it.each(BOT_GATE_CASES)(
      'should throw UnprocessableEntityException with platform name and docs/cookies.md for $platform bot-gate',
      async ({ url, stderr, platform }) => {
        existsSyncMock.mockReturnValue(false);

        spawnMock.mockImplementation(() =>
          makeFakeProcess({ exitCode: 1, stdout: '', stderr }),
        );

        const err = await service
          .prepareDownload(url, 'user-1')
          .catch((e) => e);

        expect(err).toBeInstanceOf(UnprocessableEntityException);
        expect((err as UnprocessableEntityException).message).toContain(
          'authentication cookies',
        );
        expect((err as UnprocessableEntityException).message).toContain(platform);
        expect((err as UnprocessableEntityException).message).toContain(
          'docs/cookies.md',
        );
      },
    );
  });
});
