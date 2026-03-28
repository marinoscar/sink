import { Injectable, Logger } from '@nestjs/common';
import { google, calendar_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

@Injectable()
export class GoogleCalendarClient {
  private readonly logger = new Logger(GoogleCalendarClient.name);

  createOAuth2Client(
    clientId: string,
    clientSecret: string,
    redirectUri: string,
  ): OAuth2Client {
    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  }

  getCalendarApi(auth: OAuth2Client): calendar_v3.Calendar {
    return google.calendar({ version: 'v3', auth });
  }

  async createEvent(
    calendar: calendar_v3.Calendar,
    calendarId: string,
    event: calendar_v3.Schema$Event,
  ): Promise<string> {
    return this.withRetry(async () => {
      const res = await calendar.events.insert({
        calendarId,
        requestBody: event,
      });
      this.logger.debug(`Created Google Calendar event: ${res.data.id}`);
      return res.data.id!;
    }, 'createEvent');
  }

  async updateEvent(
    calendar: calendar_v3.Calendar,
    calendarId: string,
    eventId: string,
    event: calendar_v3.Schema$Event,
  ): Promise<void> {
    return this.withRetry(async () => {
      await calendar.events.update({ calendarId, eventId, requestBody: event });
      this.logger.debug(`Updated Google Calendar event: ${eventId}`);
    }, 'updateEvent');
  }

  async deleteEvent(
    calendar: calendar_v3.Calendar,
    calendarId: string,
    eventId: string,
  ): Promise<void> {
    return this.withRetry(async () => {
      await calendar.events.delete({ calendarId, eventId });
      this.logger.debug(`Deleted Google Calendar event: ${eventId}`);
    }, 'deleteEvent');
  }

  async listCalendars(
    calendar: calendar_v3.Calendar,
  ): Promise<calendar_v3.Schema$CalendarListEntry[]> {
    const res = await calendar.calendarList.list();
    return res.data.items || [];
  }

  /**
   * Wraps a Google Calendar API operation with truncated exponential backoff
   * and jitter. Only retries on rate limit errors (HTTP 429, or HTTP 403 with
   * rateLimitExceeded/userRateLimitExceeded). All other errors are rethrown
   * immediately without retrying.
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
  ): Promise<T> {
    const MAX_RETRIES = 5;
    const INITIAL_DELAY_MS = 500;
    const MAX_DELAY_MS = 32000;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await operation();
      } catch (err) {
        if (!this.isRateLimitError(err) || attempt === MAX_RETRIES) {
          throw err;
        }
        const delay =
          Math.min(INITIAL_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS) +
          Math.random() * 250;
        this.logger.warn(
          `Rate limited on ${operationName}, retry ${attempt + 1}/${MAX_RETRIES} after ${Math.round(delay)}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    // Unreachable: the loop always returns or throws before exhausting attempts
    throw new Error('Unreachable');
  }

  /**
   * Returns true when the error is a Google rate limit response.
   * Handles both 429 (Too Many Requests) and 403 with rateLimitExceeded reason.
   */
  isRateLimitError(err: unknown): boolean {
    if (err && typeof err === 'object') {
      const status = (err as any).code || (err as any).status;
      if (status === 429) return true;
      if (status === 403) {
        const message = (err as any).message || '';
        return (
          message.includes('rateLimitExceeded') ||
          message.includes('userRateLimitExceeded') ||
          message.includes('Rate Limit Exceeded')
        );
      }
    }
    return false;
  }
}
