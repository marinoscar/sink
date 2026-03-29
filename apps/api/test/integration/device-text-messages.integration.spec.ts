import { randomUUID } from 'crypto';
import request from 'supertest';
import {
  TestContext,
  createTestApp,
  closeTestApp,
} from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import {
  createMockTestUser,
  authHeader,
} from '../helpers/auth-mock.helper';

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function makeDevice(userId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: randomUUID(),
    userId,
    name: 'Test Phone',
    platform: 'android',
    manufacturer: 'Google',
    model: 'Pixel 7',
    osVersion: '14',
    appVersion: '1.0.0',
    deviceCodeId: null,
    lastSeenAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    sims: [],
    ...overrides,
  };
}

function makeSim(deviceId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: randomUUID(),
    deviceId,
    slotIndex: 0,
    subscriptionId: 1,
    carrierName: 'T-Mobile',
    phoneNumber: '+15551234567',
    iccId: '8901260000000000001',
    displayName: 'SIM 1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeMessage(
  userId: string,
  deviceId: string,
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    id: randomUUID(),
    userId,
    deviceId,
    deviceSimId: null,
    sender: '+15559876543',
    body: 'Hello, test message',
    smsTimestamp: new Date('2024-06-01T10:00:00Z'),
    receivedAt: new Date('2024-06-01T10:00:01Z'),
    messageHash: randomUUID(),
    simSlotIndex: null,
    createdAt: new Date(),
    device: { id: deviceId, name: 'Test Phone', platform: 'android' },
    sim: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

describe('DeviceTextMessages (Integration)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
  });

  // =========================================================================
  // Device registration
  // =========================================================================

  describe('POST /api/device-text-messages/devices/register', () => {
    it('should return 401 without authentication', async () => {
      await request(context.app.getHttpServer())
        .post('/api/device-text-messages/devices/register')
        .send({ name: 'My Phone', platform: 'android' })
        .expect(401);
    });

    it('should register a new device and return 201', async () => {
      const user = await createMockTestUser(context);
      const device = makeDevice(user.id);

      context.prismaMock.device.upsert.mockResolvedValue(device);

      const response = await request(context.app.getHttpServer())
        .post('/api/device-text-messages/devices/register')
        .set(authHeader(user.accessToken))
        .send({ name: 'My Phone', platform: 'android', model: 'Pixel 7' })
        .expect(201);

      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data).toHaveProperty('name');
      expect(context.prismaMock.device.upsert).toHaveBeenCalledTimes(1);
    });

    it('should be idempotent — upserting the same device returns the existing record', async () => {
      const user = await createMockTestUser(context);
      const existingDevice = makeDevice(user.id, { name: 'My Phone' });

      context.prismaMock.device.upsert.mockResolvedValue(existingDevice);

      // First call
      await request(context.app.getHttpServer())
        .post('/api/device-text-messages/devices/register')
        .set(authHeader(user.accessToken))
        .send({ name: 'My Phone', platform: 'android' })
        .expect(201);

      // Second call with the same name — upsert returns same device
      const response = await request(context.app.getHttpServer())
        .post('/api/device-text-messages/devices/register')
        .set(authHeader(user.accessToken))
        .send({ name: 'My Phone', platform: 'android', appVersion: '1.1.0' })
        .expect(201);

      expect(response.body.data.id).toBe(existingDevice.id);
      expect(context.prismaMock.device.upsert).toHaveBeenCalledTimes(2);
    });

    it('should reject missing name with 400', async () => {
      const user = await createMockTestUser(context);

      await request(context.app.getHttpServer())
        .post('/api/device-text-messages/devices/register')
        .set(authHeader(user.accessToken))
        .send({ platform: 'android' }) // name is required
        .expect(400);
    });
  });

  // =========================================================================
  // SIM sync
  // =========================================================================

  describe('POST /api/device-text-messages/devices/:deviceId/sims', () => {
    const validSim = {
      slotIndex: 0,
      subscriptionId: 1,
      carrierName: 'T-Mobile',
      phoneNumber: '+15551234567',
    };

    it('should return 401 without authentication', async () => {
      await request(context.app.getHttpServer())
        .post(`/api/device-text-messages/devices/${randomUUID()}/sims`)
        .send({ sims: [validSim] })
        .expect(401);
    });

    it('should sync SIMs and return 201', async () => {
      const user = await createMockTestUser(context);
      const device = makeDevice(user.id);
      const sim = makeSim(device.id);

      context.prismaMock.device.findUnique.mockResolvedValue(device);
      context.prismaMock.deviceSim.upsert.mockResolvedValue(sim);
      context.prismaMock.deviceSim.deleteMany.mockResolvedValue({ count: 0 });
      context.prismaMock.deviceSim.findMany.mockResolvedValue([sim]);

      const response = await request(context.app.getHttpServer())
        .post(`/api/device-text-messages/devices/${device.id}/sims`)
        .set(authHeader(user.accessToken))
        .send({ sims: [validSim] })
        .expect(201);

      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data).toHaveLength(1);
    });

    it('should return 403 when device belongs to a different user', async () => {
      const ownerUser = await createMockTestUser(context);
      const attackerUser = await createMockTestUser(context, { email: 'attacker@example.com' });
      const device = makeDevice(ownerUser.id);

      // The device lookup returns a device owned by ownerUser
      context.prismaMock.device.findUnique.mockResolvedValue(device);

      await request(context.app.getHttpServer())
        .post(`/api/device-text-messages/devices/${device.id}/sims`)
        .set(authHeader(attackerUser.accessToken))
        .send({ sims: [validSim] })
        .expect(403);
    });

    it('should return 404 when device does not exist', async () => {
      const user = await createMockTestUser(context);

      context.prismaMock.device.findUnique.mockResolvedValue(null);

      await request(context.app.getHttpServer())
        .post(`/api/device-text-messages/devices/${randomUUID()}/sims`)
        .set(authHeader(user.accessToken))
        .send({ sims: [validSim] })
        .expect(404);
    });

    it('should return 400 when sims array is empty', async () => {
      const user = await createMockTestUser(context);

      await request(context.app.getHttpServer())
        .post(`/api/device-text-messages/devices/${randomUUID()}/sims`)
        .set(authHeader(user.accessToken))
        .send({ sims: [] }) // min(1) validation
        .expect(400);
    });
  });

  // =========================================================================
  // SMS relay
  // =========================================================================

  describe('POST /api/device-text-messages/relay', () => {
    const makeSmsPayload = (deviceId: string) => ({
      deviceId,
      messages: [
        {
          sender: '+15559876543',
          body: 'Test message body',
          smsTimestamp: '2024-06-01T10:00:00.000Z',
          simSlotIndex: 0,
        },
      ],
    });

    it('should return 401 without authentication', async () => {
      await request(context.app.getHttpServer())
        .post('/api/device-text-messages/relay')
        .send(makeSmsPayload(randomUUID()))
        .expect(401);
    });

    it('should relay messages successfully and return 201', async () => {
      const user = await createMockTestUser(context);
      const device = makeDevice(user.id);

      context.prismaMock.device.findUnique.mockResolvedValue(device);
      context.prismaMock.deviceSim.findUnique.mockResolvedValue(null);
      context.prismaMock.smsMessage.createMany.mockResolvedValue({ count: 1 });

      const response = await request(context.app.getHttpServer())
        .post('/api/device-text-messages/relay')
        .set(authHeader(user.accessToken))
        .send(makeSmsPayload(device.id))
        .expect(201);

      expect(response.body.data).toMatchObject({ stored: 1, duplicates: 0 });
      expect(context.prismaMock.smsMessage.createMany).toHaveBeenCalledTimes(1);
    });

    it('should skip duplicates — second relay of the same messages returns count=0 stored', async () => {
      const user = await createMockTestUser(context);
      const device = makeDevice(user.id);

      context.prismaMock.device.findUnique.mockResolvedValue(device);
      context.prismaMock.deviceSim.findUnique.mockResolvedValue(null);

      // First call: 1 inserted
      context.prismaMock.smsMessage.createMany.mockResolvedValueOnce({ count: 1 });

      await request(context.app.getHttpServer())
        .post('/api/device-text-messages/relay')
        .set(authHeader(user.accessToken))
        .send(makeSmsPayload(device.id))
        .expect(201);

      // Second call: 0 inserted (duplicate skipped by unique constraint)
      context.prismaMock.smsMessage.createMany.mockResolvedValueOnce({ count: 0 });

      const response = await request(context.app.getHttpServer())
        .post('/api/device-text-messages/relay')
        .set(authHeader(user.accessToken))
        .send(makeSmsPayload(device.id))
        .expect(201);

      expect(response.body.data).toMatchObject({ stored: 0, duplicates: 1 });
    });

    it('should return 403 when device belongs to another user', async () => {
      const ownerUser = await createMockTestUser(context);
      const attackerUser = await createMockTestUser(context, { email: 'attacker@example.com' });
      const device = makeDevice(ownerUser.id);

      context.prismaMock.device.findUnique.mockResolvedValue(device);

      await request(context.app.getHttpServer())
        .post('/api/device-text-messages/relay')
        .set(authHeader(attackerUser.accessToken))
        .send(makeSmsPayload(device.id))
        .expect(403);
    });

    it('should return 400 when messages array is empty', async () => {
      const user = await createMockTestUser(context);

      await request(context.app.getHttpServer())
        .post('/api/device-text-messages/relay')
        .set(authHeader(user.accessToken))
        .send({ deviceId: randomUUID(), messages: [] })
        .expect(400);
    });

    it('should return 400 when deviceId is missing', async () => {
      const user = await createMockTestUser(context);

      await request(context.app.getHttpServer())
        .post('/api/device-text-messages/relay')
        .set(authHeader(user.accessToken))
        .send({
          messages: [
            {
              sender: '+15559876543',
              body: 'Hello',
              smsTimestamp: '2024-06-01T10:00:00.000Z',
            },
          ],
        })
        .expect(400);
    });
  });

  // =========================================================================
  // List messages
  // =========================================================================

  describe('GET /api/device-text-messages', () => {
    it('should return 401 without authentication', async () => {
      await request(context.app.getHttpServer())
        .get('/api/device-text-messages')
        .expect(401);
    });

    it('should return a paginated list of messages for the authenticated user', async () => {
      const user = await createMockTestUser(context);
      const device = makeDevice(user.id);
      const message = makeMessage(user.id, device.id);

      context.prismaMock.smsMessage.findMany.mockResolvedValue([message]);
      context.prismaMock.smsMessage.count.mockResolvedValue(1);

      const response = await request(context.app.getHttpServer())
        .get('/api/device-text-messages')
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(response.body.data).toMatchObject({
        items: expect.any(Array),
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
      expect(response.body.data.items).toHaveLength(1);
    });

    it('should apply dateFrom and dateTo filters', async () => {
      const user = await createMockTestUser(context);

      context.prismaMock.smsMessage.findMany.mockResolvedValue([]);
      context.prismaMock.smsMessage.count.mockResolvedValue(0);

      const response = await request(context.app.getHttpServer())
        .get('/api/device-text-messages')
        .query({
          dateFrom: '2024-06-01T00:00:00.000Z',
          dateTo: '2024-06-30T23:59:59.999Z',
        })
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(response.body.data.items).toHaveLength(0);
      // Verify that smsMessage.findMany was called with the date where clause
      const findManyCall = context.prismaMock.smsMessage.findMany.mock.calls[0][0];
      expect(findManyCall.where).toHaveProperty('smsTimestamp');
      expect(findManyCall.where.smsTimestamp).toHaveProperty('gte');
      expect(findManyCall.where.smsTimestamp).toHaveProperty('lte');
    });

    it('should apply sender filter', async () => {
      const user = await createMockTestUser(context);
      const device = makeDevice(user.id);
      const message = makeMessage(user.id, device.id, { sender: '+15551111111' });

      context.prismaMock.smsMessage.findMany.mockResolvedValue([message]);
      context.prismaMock.smsMessage.count.mockResolvedValue(1);

      const response = await request(context.app.getHttpServer())
        .get('/api/device-text-messages')
        .query({ sender: '+15551111111' })
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(response.body.data.total).toBe(1);
      const findManyCall = context.prismaMock.smsMessage.findMany.mock.calls[0][0];
      expect(findManyCall.where.sender).toMatchObject({ contains: '+15551111111' });
    });

    it('should apply deviceId filter', async () => {
      const user = await createMockTestUser(context);
      const device = makeDevice(user.id);
      const message = makeMessage(user.id, device.id);

      context.prismaMock.smsMessage.findMany.mockResolvedValue([message]);
      context.prismaMock.smsMessage.count.mockResolvedValue(1);

      const response = await request(context.app.getHttpServer())
        .get('/api/device-text-messages')
        .query({ deviceId: device.id })
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(response.body.data.total).toBe(1);
      const findManyCall = context.prismaMock.smsMessage.findMany.mock.calls[0][0];
      expect(findManyCall.where.deviceId).toBe(device.id);
    });

    it('should only return messages belonging to the authenticated user', async () => {
      const user = await createMockTestUser(context);

      context.prismaMock.smsMessage.findMany.mockResolvedValue([]);
      context.prismaMock.smsMessage.count.mockResolvedValue(0);

      await request(context.app.getHttpServer())
        .get('/api/device-text-messages')
        .set(authHeader(user.accessToken))
        .expect(200);

      const findManyCall = context.prismaMock.smsMessage.findMany.mock.calls[0][0];
      // The where clause must scope results to the calling user
      expect(findManyCall.where.userId).toBe(user.id);
    });

    it('should respect pagination parameters', async () => {
      const user = await createMockTestUser(context);

      context.prismaMock.smsMessage.findMany.mockResolvedValue([]);
      context.prismaMock.smsMessage.count.mockResolvedValue(0);

      const response = await request(context.app.getHttpServer())
        .get('/api/device-text-messages')
        .query({ page: 2, pageSize: 10 })
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(response.body.data.page).toBe(2);
      expect(response.body.data.pageSize).toBe(10);

      const findManyCall = context.prismaMock.smsMessage.findMany.mock.calls[0][0];
      expect(findManyCall.skip).toBe(10); // (page-1) * pageSize
      expect(findManyCall.take).toBe(10);
    });
  });

  // =========================================================================
  // List senders
  // =========================================================================

  describe('GET /api/device-text-messages/senders', () => {
    it('should return 401 without authentication', async () => {
      await request(context.app.getHttpServer())
        .get('/api/device-text-messages/senders')
        .expect(401);
    });

    it('should return distinct senders for the authenticated user', async () => {
      const user = await createMockTestUser(context);

      context.prismaMock.smsMessage.findMany.mockResolvedValue([
        { sender: '+15551111111' },
        { sender: '+15552222222' },
      ]);

      const response = await request(context.app.getHttpServer())
        .get('/api/device-text-messages/senders')
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data).toContain('+15551111111');
      expect(response.body.data).toContain('+15552222222');

      const findManyCall = context.prismaMock.smsMessage.findMany.mock.calls[0][0];
      expect(findManyCall.where.userId).toBe(user.id);
      expect(findManyCall.distinct).toContain('sender');
    });

    it('should return an empty array when the user has no messages', async () => {
      const user = await createMockTestUser(context);

      context.prismaMock.smsMessage.findMany.mockResolvedValue([]);

      const response = await request(context.app.getHttpServer())
        .get('/api/device-text-messages/senders')
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(response.body.data).toEqual([]);
    });
  });

  // =========================================================================
  // List devices
  // =========================================================================

  describe('GET /api/device-text-messages/devices', () => {
    it('should return 401 without authentication', async () => {
      await request(context.app.getHttpServer())
        .get('/api/device-text-messages/devices')
        .expect(401);
    });

    it('should return the list of devices for the authenticated user', async () => {
      const user = await createMockTestUser(context);
      const device = makeDevice(user.id);

      context.prismaMock.device.findMany.mockResolvedValue([device]);

      const response = await request(context.app.getHttpServer())
        .get('/api/device-text-messages/devices')
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toHaveProperty('id', device.id);

      const findManyCall = context.prismaMock.device.findMany.mock.calls[0][0];
      expect(findManyCall.where.userId).toBe(user.id);
    });

    it('should return an empty array when the user has no devices', async () => {
      const user = await createMockTestUser(context);

      context.prismaMock.device.findMany.mockResolvedValue([]);

      const response = await request(context.app.getHttpServer())
        .get('/api/device-text-messages/devices')
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(response.body.data).toEqual([]);
    });
  });
});
