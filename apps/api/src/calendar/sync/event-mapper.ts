import { calendar_v3 } from 'googleapis';

const WINDOWS_TO_IANA: Record<string, string> = {
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Alaska Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Atlantic Standard Time': 'America/Halifax',
  'Newfoundland Standard Time': 'America/St_Johns',
  'Central Europe Standard Time': 'Europe/Budapest',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'GTB Standard Time': 'Europe/Bucharest',
  'Russian Standard Time': 'Europe/Moscow',
  'Israel Standard Time': 'Asia/Jerusalem',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'Singapore Standard Time': 'Asia/Singapore',
  'Arabian Standard Time': 'Asia/Dubai',
  'SA Pacific Standard Time': 'America/Bogota',
  'SA Eastern Standard Time': 'America/Cayenne',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'Central America Standard Time': 'America/Guatemala',
  'US Mountain Standard Time': 'America/Phoenix',
  'Canada Central Standard Time': 'America/Regina',
  'SA Western Standard Time': 'America/La_Paz',
  'US Eastern Standard Time': 'America/Indianapolis',
  'Venezuela Standard Time': 'America/Caracas',
  'Central Pacific Standard Time': 'Pacific/Guadalcanal',
  'Fiji Standard Time': 'Pacific/Fiji',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'Taipei Standard Time': 'Asia/Taipei',
  'West Asia Standard Time': 'Asia/Tashkent',
  'Pakistan Standard Time': 'Asia/Karachi',
  'Central Asia Standard Time': 'Asia/Almaty',
  UTC: 'UTC',
};

function toIanaTimeZone(tz: string): string {
  return WINDOWS_TO_IANA[tz] || tz;
}

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
  lastModified?: string | null;
  subject?: string | null;
  location?: string;
  start: string;
  startTimeZone?: string | null;
  end: string;
  endTimeZone?: string | null;
  isAllDay?: boolean | null;
  isRecurring?: boolean | null;
  attendeeCount?: number | null;
  attendeeDomains?: string[] | null;
  organizerDomain?: string;
  busyStatus?: 'Free' | 'Tentative' | 'Busy' | 'OutOfOffice' | 'WorkingElsewhere' | null;
  responseStatus?: string | null;
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
    summary: data.subject || 'No Subject',
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
    event.start = { dateTime: data.start, timeZone: toIanaTimeZone(data.startTimeZone || 'UTC') };
    event.end = { dateTime: data.end, timeZone: toIanaTimeZone(data.endTimeZone || 'UTC') };
  }

  // Transparency (busy/free)
  event.transparency = data.busyStatus === 'Free' ? 'transparent' : 'opaque';

  // Recurrence
  if (data.isRecurring && data.recurrencePattern) {
    event.recurrence = buildRrule(data.recurrencePattern);
  }

  // Structured description block for traceability
  const attendeeDomains = data.attendeeDomains || [];
  const attendeeCount = data.attendeeCount || 0;
  const responseStatus = data.responseStatus || '';
  const busyStatus = data.busyStatus || 'Busy';

  const metaLines: string[] = [
    '--- Sink Calendar Sync ---',
    `Database ID: ${entryUuid}`,
    `Source ID: ${entryId}`,
  ];
  if (data.organizerDomain) {
    metaLines.push(`Organizer Domain: ${data.organizerDomain}`);
  }
  if (attendeeDomains.length > 0) {
    metaLines.push(`Attendee Domains: ${attendeeDomains.join(', ')}`);
  }
  metaLines.push(`Attendee Count: ${attendeeCount}`);
  metaLines.push(`Response Status: ${responseStatus}`);
  metaLines.push(`Busy Status: ${busyStatus}`);

  event.description = metaLines.join('\n');

  return event;
}
