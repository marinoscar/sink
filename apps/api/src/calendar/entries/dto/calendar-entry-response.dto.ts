export interface CalendarEntryResponseDto {
  id: string;
  entryId: string;
  data: Record<string, unknown>;
  version: number;
  syncStatus: string;
  googleEventId: string | null;
  lastSyncedAt: string | null;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}
