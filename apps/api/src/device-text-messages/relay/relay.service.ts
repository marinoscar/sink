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

@Injectable()
export class RelayService {
  private readonly logger = new Logger(RelayService.name);

  constructor(private readonly prisma: PrismaService) {}

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
      });
    }

    const result = await this.prisma.smsMessage.createMany({
      data: messagesToInsert,
      skipDuplicates: true,
    });

    const stored = result.count;
    const duplicates = dto.messages.length - stored;

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
