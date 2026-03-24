export interface SyncLogResponseDto {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: string;
  entriesProcessed: number;
  entriesCreated: number;
  entriesUpdated: number;
  entriesDeleted: number;
  errorMessage: string | null;
  errorDetails: unknown | null;
}

export interface SyncLogsListResponseDto {
  items: SyncLogResponseDto[];
  meta: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}
