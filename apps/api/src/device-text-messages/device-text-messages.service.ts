import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryMessagesDto } from './dto/query-messages.dto';

@Injectable()
export class DeviceTextMessagesService {
  private readonly logger = new Logger(DeviceTextMessagesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * List SMS messages for the current user with optional filtering and pagination.
   */
  async listMessages(userId: string, query: QueryMessagesDto) {
    const { page, pageSize, dateFrom, dateTo, sender, deviceId, deviceSimId, messageType, isOtp } = query;
    const skip = (page - 1) * pageSize;

    const where: Prisma.SmsMessageWhereInput = { userId };

    if (sender) {
      where.sender = { contains: sender, mode: 'insensitive' };
    }

    if (deviceId) {
      where.deviceId = deviceId;
    }

    if (deviceSimId) {
      where.deviceSimId = deviceSimId;
    }

    if (messageType) {
      where.messageType = messageType;
    }

    if (isOtp !== undefined) {
      where.isOtp = isOtp;
    }

    if (dateFrom || dateTo) {
      where.smsTimestamp = {};
      if (dateFrom) {
        where.smsTimestamp.gte = new Date(dateFrom);
      }
      if (dateTo) {
        where.smsTimestamp.lte = new Date(dateTo);
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.smsMessage.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { smsTimestamp: 'desc' },
        include: {
          device: {
            select: { id: true, name: true, platform: true },
          },
          sim: {
            select: { id: true, displayName: true, carrierName: true, phoneNumber: true },
          },
        },
      }),
      this.prisma.smsMessage.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * List distinct message senders for the current user.
   */
  async listSenders(userId: string): Promise<string[]> {
    const rows = await this.prisma.smsMessage.findMany({
      where: { userId },
      distinct: ['sender'],
      select: { sender: true },
      orderBy: { sender: 'asc' },
    });

    return rows.map((r) => r.sender);
  }
}
