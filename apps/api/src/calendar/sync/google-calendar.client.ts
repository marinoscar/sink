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
    const res = await calendar.events.insert({
      calendarId,
      requestBody: event,
    });
    this.logger.debug(`Created Google Calendar event: ${res.data.id}`);
    return res.data.id!;
  }

  async updateEvent(
    calendar: calendar_v3.Calendar,
    calendarId: string,
    eventId: string,
    event: calendar_v3.Schema$Event,
  ): Promise<void> {
    await calendar.events.update({ calendarId, eventId, requestBody: event });
    this.logger.debug(`Updated Google Calendar event: ${eventId}`);
  }

  async deleteEvent(
    calendar: calendar_v3.Calendar,
    calendarId: string,
    eventId: string,
  ): Promise<void> {
    await calendar.events.delete({ calendarId, eventId });
    this.logger.debug(`Deleted Google Calendar event: ${eventId}`);
  }

  async listCalendars(
    calendar: calendar_v3.Calendar,
  ): Promise<calendar_v3.Schema$CalendarListEntry[]> {
    const res = await calendar.calendarList.list();
    return res.data.items || [];
  }
}
