import { calendar_v3 } from 'googleapis';

export interface RecurrencePattern {
  type: string;
  interval?: number;
  daysOfWeek?: string[];
  dayOfMonth?: number;
  monthOfYear?: number;
  instance?: string;
  patternStart?: string;
  patternEnd?: string;
  occurrences?: number;
}

export interface CalendarEntryData {
  entryId: string;
  lastModified: string;
  subject: string;
  location?: string;
  start: string;
  startTimeZone: string;
  end: string;
  endTimeZone: string;
  isAllDay: boolean;
  isRecurring: boolean;
  attendeeCount: number;
  attendeeDomains: string[];
  organizerDomain?: string;
  busyStatus: 'Free' | 'Tentative' | 'Busy' | 'OutOfOffice' | 'WorkingElsewhere';
  responseStatus: string;
  recurrencePattern?: RecurrencePattern;
}

/**
 * Maps a day-of-week string to RFC 5545 two-letter abbreviation.
 */
export function mapDayOfWeek(day: string): string {
  const map: Record<string, string> = {
    Sunday: 'SU',
    Monday: 'MO',
    Tuesday: 'TU',
    Wednesday: 'WE',
    Thursday: 'TH',
    Friday: 'FR',
    Saturday: 'SA',
  };
  return map[day] ?? day.slice(0, 2).toUpperCase();
}

/**
 * Builds an RRULE string array from a RecurrencePattern.
 */
function buildRrule(pattern: RecurrencePattern): string[] {
  const parts: string[] = [];

  // FREQ
  const freqMap: Record<string, string> = {
    Daily: 'DAILY',
    Weekly: 'WEEKLY',
    Monthly: 'MONTHLY',
    Yearly: 'YEARLY',
    AbsoluteMonthly: 'MONTHLY',
    RelativeMonthly: 'MONTHLY',
    AbsoluteYearly: 'YEARLY',
    RelativeYearly: 'YEARLY',
  };
  const freq = freqMap[pattern.type] ?? 'DAILY';
  parts.push(`FREQ=${freq}`);

  // INTERVAL
  if (pattern.interval && pattern.interval > 1) {
    parts.push(`INTERVAL=${pattern.interval}`);
  }

  // BYDAY
  if (pattern.daysOfWeek && pattern.daysOfWeek.length > 0) {
    const days = pattern.daysOfWeek.map(mapDayOfWeek);
    if (pattern.instance) {
      // RelativeMonthly/RelativeYearly: e.g. 1MO for "first Monday"
      const instanceMap: Record<string, string> = {
        First: '1',
        Second: '2',
        Third: '3',
        Fourth: '4',
        Last: '-1',
      };
      const instanceNum = instanceMap[pattern.instance] ?? '1';
      parts.push(`BYDAY=${days.map((d) => `${instanceNum}${d}`).join(',')}`);
    } else {
      parts.push(`BYDAY=${days.join(',')}`);
    }
  }

  // BYMONTHDAY
  if (
    pattern.dayOfMonth &&
    !pattern.daysOfWeek?.length &&
    (freq === 'MONTHLY' || freq === 'YEARLY')
  ) {
    parts.push(`BYMONTHDAY=${pattern.dayOfMonth}`);
  }

  // BYMONTH
  if (pattern.monthOfYear && freq === 'YEARLY') {
    parts.push(`BYMONTH=${pattern.monthOfYear}`);
  }

  // COUNT or UNTIL
  if (pattern.occurrences) {
    parts.push(`COUNT=${pattern.occurrences}`);
  } else if (pattern.patternEnd) {
    // Strip time portion for all-day-friendly UNTIL, keep full ISO for timed
    const until = pattern.patternEnd.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    parts.push(`UNTIL=${until}`);
  }

  return [`RRULE:${parts.join(';')}`];
}

/**
 * Maps a CalendarEntry database record to a Google Calendar event resource.
 */
export function mapToGoogleEvent(
  entryId: string,
  entryUuid: string,
  data: CalendarEntryData,
): calendar_v3.Schema$Event {
  const event: calendar_v3.Schema$Event = {
    summary: data.subject,
  };

  // Location
  if (data.location) {
    event.location = data.location;
  }

  // Start / End
  if (data.isAllDay) {
    // Extract date portion only: YYYY-MM-DD
    const startDate = data.start.split('T')[0];
    const endDate = data.end.split('T')[0];
    event.start = { date: startDate };
    event.end = { date: endDate };
  } else {
    event.start = { dateTime: data.start, timeZone: data.startTimeZone };
    event.end = { dateTime: data.end, timeZone: data.endTimeZone };
  }

  // Transparency (busy/free)
  event.transparency = data.busyStatus === 'Free' ? 'transparent' : 'opaque';

  // Recurrence
  if (data.isRecurring && data.recurrencePattern) {
    event.recurrence = buildRrule(data.recurrencePattern);
  }

  // Structured description block for traceability
  const metaLines: string[] = [
    '--- Sink Calendar Sync ---',
    `Database ID: ${entryUuid}`,
    `Source ID: ${entryId}`,
  ];
  if (data.organizerDomain) {
    metaLines.push(`Organizer Domain: ${data.organizerDomain}`);
  }
  if (data.attendeeDomains.length > 0) {
    metaLines.push(`Attendee Domains: ${data.attendeeDomains.join(', ')}`);
  }
  metaLines.push(`Attendee Count: ${data.attendeeCount}`);
  metaLines.push(`Response Status: ${data.responseStatus}`);
  metaLines.push(`Busy Status: ${data.busyStatus}`);

  event.description = metaLines.join('\n');

  return event;
}
