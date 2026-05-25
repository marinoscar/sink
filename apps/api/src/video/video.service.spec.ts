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

/**
 * Build a fake ChildProcess-like object whose events fire on the next tick so
 * callers can attach listeners first.
 */
function makeFakeProcess(opts: {
  exitCode: number;
  stdout: string;
  stderr: string;
}): EventEmitter & { stdout: EventEmitter; stderr: EventEmitter } {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();

  setImmediate(() => {
    if (opts.stdout) proc.stdout.emit('data', Buffer.from(opts.stdout));
    if (opts.stderr) proc.stderr.emit('data', Buffer.from(opts.stderr));
    proc.emit('close', opts.exitCode);
  });

  return proc;
}

// The jest.fn() is stored outside so tests can override it per-case.
const spawnMock = jest.fn();

jest.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
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
    clearInterval((service as any).cleanupInterval);
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
                return defaultVal;
              }),
            },
          },
        ],
      }).compile();

      realService = module.get<VideoService>(VideoService);
    });

    afterEach(() => {
      clearInterval((realService as any).cleanupInterval);
    });

    it('should verify a freshly signed token and return upstream URL and filename', async () => {
      spawnMock.mockImplementation(() =>
        makeFakeProcess({
          exitCode: 0,
          stdout: JSON.stringify({ url: 'https://cdn.example.com/v.mp4', ext: 'mp4', title: 'RT Video', filesize: 500 }),
          stderr: '',
        }),
      );

      const { token } = await realService.prepareDownload(
        'https://www.youtube.com/watch?v=abc',
        'user-rt',
      );

      const result = await realService.consumeToken(token);
      expect(result).toMatchObject({
        upstreamUrl: 'https://cdn.example.com/v.mp4',
        filename: 'RT Video.mp4',
      });
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

      clearInterval((expiredService as any).cleanupInterval);
    });

    it('should throw UnauthorizedException on second use of the same token (single-use)', async () => {
      spawnMock.mockImplementation(() =>
        makeFakeProcess({
          exitCode: 0,
          stdout: JSON.stringify({ url: 'https://cdn.example.com/v.mp4', ext: 'mp4', title: 'Single Use', filesize: 200 }),
          stderr: '',
        }),
      );

      const { token } = await realService.prepareDownload(
        'https://www.youtube.com/watch?v=abc',
        'user-once',
      );

      // First use: should succeed
      await expect(realService.consumeToken(token)).resolves.toBeDefined();

      // Second use: should be rejected
      await expect(realService.consumeToken(token)).rejects.toThrow(
        UnauthorizedException,
      );
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
});
