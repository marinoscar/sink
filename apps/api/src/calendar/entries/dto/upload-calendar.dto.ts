import { z } from 'zod';

const recurrencePatternSchema = z.object({
  type: z.enum(['Daily', 'Weekly', 'Monthly', 'MonthlyNth', 'Yearly', 'YearlyNth']),
  interval: z.number().int().min(1),
  daysOfWeek: z.array(z.string()),
  dayOfMonth: z.number().int().min(0).max(31),
  monthOfYear: z.number().int().min(0).max(12),
  instance: z.number().int().min(0).max(5),
  patternStart: z.string(),
  patternEnd: z.string().nullable().optional(),
  occurrences: z.number().int().min(0),
});

export const calendarEntrySchema = z.object({
  entryId: z.string().min(1),
  lastModified: z.string(),
  subject: z.string(),
  location: z.string().nullable().optional(),
  start: z.string(),
  startTimeZone: z.string(),
  end: z.string(),
  endTimeZone: z.string(),
  isAllDay: z.boolean(),
  isRecurring: z.boolean(),
  attendeeCount: z.number().int().min(0),
  attendeeDomains: z.array(z.string()),
  organizerDomain: z.string().nullable().optional(),
  busyStatus: z.enum(['Free', 'Tentative', 'Busy', 'OutOfOffice', 'WorkingElsewhere']),
  responseStatus: z.enum(['None', 'Organized', 'Tentative', 'Accepted', 'Declined', 'NotResponded']),
  recurrencePattern: recurrencePatternSchema.nullable().optional(),
});

export const uploadCalendarSchema = z.object({
  exportDate: z.string(),
  rangeStart: z.string(),
  rangeEnd: z.string(),
  itemCount: z.number().int().min(0),
  entries: z.array(calendarEntrySchema),
});

export type UploadCalendarDto = z.infer<typeof uploadCalendarSchema>;
export type CalendarEntryData = z.infer<typeof calendarEntrySchema>;
