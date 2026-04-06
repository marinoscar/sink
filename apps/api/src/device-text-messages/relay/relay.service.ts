import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDeviceDto } from '../dto/register-device.dto';
import { SyncSimsDto } from '../dto/sync-sims.dto';
import { RelaySmsDto } from '../dto/relay-sms.dto';
import {
  OtpExtractorService,
} from '../otp-extractor.service';

@Injectable()
export class RelayService {
  private readonly logger = new Logger(RelayService.name);

  private static readonly OTP_CANDIDATE_REGEX = /\d{4,10}/;

  constructor(
    private readonly prisma: PrismaService,
    private readonly otpExtractorService: OtpExtractorService,
  ) {}

  /**
   * Register or update a device for a user.
   * Upserts by (userId, name) — the unique constraint on the Device model.
   */
  async registerDevice(userId: string, dto: RegisterDeviceDto) {
    const device = await this.prisma.device.upsert({
      where: {
        userId_name: {
          userId,
          name: dto.name,
        },
      },
      create: {
        userId,
        name: dto.name,
        platform: dto.platform ?? 'android',
        manufacturer: dto.manufacturer,
        model: dto.model,
        osVersion: dto.osVersion,
        appVersion: dto.appVersion,
        deviceCodeId: dto.deviceCodeId ?? null,
        lastSeenAt: new Date(),
      },
      update: {
        platform: dto.platform ?? 'android',
        manufacturer: dto.manufacturer,
        model: dto.model,
        osVersion: dto.osVersion,
        appVersion: dto.appVersion,
        lastSeenAt: new Date(),
      },
      include: { sims: true },
    });

    this.logger.log(`Device registered/updated: ${device.id} for user ${userId}`);
    return device;
  }

  /**
   * Sync SIM cards for a device.
   * Upserts each SIM by (deviceId, subscriptionId) and removes stale SIMs.
   */
  async syncSims(userId: string, deviceId: string, dto: SyncSimsDto) {
    await this.verifyDeviceOwnership(userId, deviceId);

    const incomingSubscriptionIds = dto.sims.map((s) => s.subscriptionId);

    // Upsert each SIM
    for (const sim of dto.sims) {
      await this.prisma.deviceSim.upsert({
        where: {
          deviceId_subscriptionId: {
            deviceId,
            subscriptionId: sim.subscriptionId,
          },
        },
        create: {
          deviceId,
          slotIndex: sim.slotIndex,
          subscriptionId: sim.subscriptionId,
          carrierName: sim.carrierName,
          phoneNumber: sim.phoneNumber,
          iccId: sim.iccId,
          displayName: sim.displayName,
        },
        update: {
          slotIndex: sim.slotIndex,
          carrierName: sim.carrierName,
          phoneNumber: sim.phoneNumber,
          iccId: sim.iccId,
          displayName: sim.displayName,
        },
      });
    }

    // Remove stale SIMs no longer present on the device
    await this.prisma.deviceSim.deleteMany({
      where: {
        deviceId,
        subscriptionId: { notIn: incomingSubscriptionIds },
      },
    });

    const updatedSims = await this.prisma.deviceSim.findMany({
      where: { deviceId },
      orderBy: { slotIndex: 'asc' },
    });

    this.logger.log(
      `SIMs synced for device ${deviceId}: ${updatedSims.length} active`,
    );
    return updatedSims;
  }

  /**
   * Relay SMS messages from an Android device.
   * Computes a SHA-256 hash per message for deduplication.
   */
  async relaySms(userId: string, dto: RelaySmsDto) {
    await this.verifyDeviceOwnership(userId, dto.deviceId);

    const messagesToInsert: Array<{
      userId: string;
      deviceId: string;
      deviceSimId: string | null;
      sender: string;
      body: string;
      smsTimestamp: Date;
      messageHash: string;
      simSlotIndex: number | null;
      messageType: string;
      senderDisplayName: string | null;
      smsTimezoneOffset: string | null;
    }> = [];

    for (const msg of dto.messages) {
      const messageType = msg.messageType ?? 'sms';
      const messageHash = createHash('sha256')
        .update(`${dto.deviceId}:${messageType}:${msg.sender}:${msg.body}:${msg.smsTimestamp}`)
        .digest('hex');

      // Resolve SIM only for SMS messages
      let deviceSimId: string | null = null;
      if (messageType === 'sms' && msg.simSubscriptionId != null) {
        const sim = await this.prisma.deviceSim.findUnique({
          where: {
            deviceId_subscriptionId: {
              deviceId: dto.deviceId,
              subscriptionId: msg.simSubscriptionId,
            },
          },
          select: { id: true },
        });
        deviceSimId = sim?.id ?? null;
      }

      messagesToInsert.push({
        userId,
        deviceId: dto.deviceId,
        deviceSimId,
        sender: msg.sender,
        body: msg.body,
        smsTimestamp: new Date(msg.smsTimestamp),
        messageHash,
        simSlotIndex: messageType === 'sms' ? (msg.simSlotIndex ?? null) : null,
        messageType,
        senderDisplayName: msg.senderDisplayName ?? null,
        smsTimezoneOffset: msg.smsTimezoneOffset ?? null,
      });
    }

    const result = await this.prisma.smsMessage.createMany({
      data: messagesToInsert,
      skipDuplicates: true,
    });

    const stored = result.count;
    const duplicates = dto.messages.length - stored;

    // Run OTP extraction on newly stored messages (fire-and-forget, don't block relay response)
    const messageHashes = messagesToInsert.map((m) => m.messageHash);
    this.processOtpExtraction(messageHashes, messagesToInsert).catch((err) => {
      this.logger.error(`OTP extraction failed: ${(err as Error).message}`);
    });

    this.logger.log(
      `SMS relay for device ${dto.deviceId}: ${stored} stored, ${duplicates} duplicates skipped`,
    );

    return { stored, duplicates };
  }

  /**
   * List all devices registered by a user.
   */
  async listDevices(userId: string) {
    return this.prisma.device.findMany({
      where: { userId },
      include: { sims: { orderBy: { slotIndex: 'asc' } } },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private mightContainOtp(body: string): boolean {
    return RelayService.OTP_CANDIDATE_REGEX.test(body);
  }

  private async processOtpExtraction(
    messageHashes: string[],
    insertedMessages: Array<{ messageHash: string; body: string }>,
  ): Promise<void> {
    // Find stored messages by hash to get their IDs
    const storedMessages = await this.prisma.smsMessage.findMany({
      where: { messageHash: { in: messageHashes } },
      select: { id: true, messageHash: true, body: true },
    });

    const hashToId = new Map(storedMessages.map((m) => [m.messageHash, m.id]));

    for (const msg of insertedMessages) {
      const id = hashToId.get(msg.messageHash);
      if (!id) continue; // was a duplicate, skip

      if (!this.mightContainOtp(msg.body)) continue;

      try {
        const extraction = await this.otpExtractorService.extractOtp(msg.body);
        if (extraction.code) {
          await this.prisma.smsMessage.update({
            where: { id },
            data: {
              isOtp: true,
              metadata: {
                otp: {
                  code: extraction.code,
                  confidence: extraction.confidence,
                  reason: extraction.reason,
                  extractedAt: new Date().toISOString(),
                },
              },
            },
          });
          this.logger.log(
            `OTP extracted for message ${id}: code=${extraction.code}, confidence=${extraction.confidence}`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `OTP extraction failed for message ${id}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async verifyDeviceOwnership(
    userId: string,
    deviceId: string,
  ): Promise<void> {
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: { userId: true },
    });

    if (!device) {
      throw new NotFoundException(`Device ${deviceId} not found`);
    }

    if (device.userId !== userId) {
      throw new ForbiddenException(
        'You do not have access to this device',
      );
    }
  }
}
