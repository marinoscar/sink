import { z } from 'zod';

const recurrencePatternSchema = z
  .object({
    type: z.enum(['Daily', 'Weekly', 'Monthly', 'MonthlyNth', 'Yearly', 'YearlyNth']),
    interval: z.number().int().min(1).optional().nullable(),
    daysOfWeek: z.array(z.string()).optional().nullable(),
    dayOfMonth: z.number().int().min(0).max(31).optional().nullable(),
    monthOfYear: z.number().int().min(0).max(12).optional().nullable(),
    instance: z.number().int().min(0).max(5).optional().nullable(),
    patternStart: z.string().optional().nullable(),
    patternEnd: z.string().nullable().optional(),
    occurrences: z.number().int().min(0).optional().nullable(),
  })
  .passthrough();

export const calendarEntrySchema = z
  .object({
    entryId: z.string().min(1),
    lastModified: z.string().optional().nullable(),
    subject: z.string().optional().nullable(),
    location: z.string().nullable().optional(),
    start: z.string(),
    startTimeZone: z.string().optional().nullable(),
    end: z.string(),
    endTimeZone: z.string().optional().nullable(),
    isAllDay: z.boolean().optional().nullable(),
    isRecurring: z.boolean().optional().nullable(),
    attendeeCount: z.number().int().min(0).optional().nullable(),
    attendeeDomains: z.array(z.string()).optional().nullable(),
    organizerDomain: z.string().nullable().optional(),
    busyStatus: z.string().optional().nullable(),
    responseStatus: z.string().optional().nullable(),
    recurrencePattern: recurrencePatternSchema.nullable().optional(),
  })
  .passthrough();

export const uploadCalendarSchema = z.object({
  exportDate: z.string(),
  rangeStart: z.string(),
  rangeEnd: z.string(),
  itemCount: z.number().int().min(0),
  entries: z.array(calendarEntrySchema),
});

export type UploadCalendarDto = z.infer<typeof uploadCalendarSchema>;
export type CalendarEntryData = z.infer<typeof calendarEntrySchema>;
