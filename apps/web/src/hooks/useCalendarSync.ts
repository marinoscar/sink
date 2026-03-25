import { useState, useCallback, useEffect, useRef } from 'react';
import {
  getCalendarSyncConfig,
  updateCalendarSyncConfig,
  triggerCalendarSync,
  getCalendarSyncLogs,
  getCalendarSyncLog,
  disconnectGoogleCalendar,
  getGoogleCalendars,
  resetCalendarSync,
} from '../services/api';
import type {
  CalendarSyncConfig,
  CalendarSyncLog,
  CalendarSyncLogsResponse,
  GoogleCalendarListItem,
} from '../types';

export function useCalendarSync() {
  const [config, setConfig] = useState<CalendarSyncConfig | null>(null);
  const [logs, setLogs] = useState<CalendarSyncLogsResponse | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendarListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [activeSyncLog, setActiveSyncLog] = useState<CalendarSyncLog | null>(null);

  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current !== null) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  const fetchConfig = useCallback(async () => {
    try {
      const data = await getCalendarSyncConfig();
      setConfig(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load config');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchLogs = useCallback(async (page = 1, pageSize = 20, filter?: string) => {
    try {
      const data = await getCalendarSyncLogs({ page, pageSize, dateFilter: filter });
      setLogs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs');
    }
  }, []);

  const fetchCalendars = useCallback(async () => {
    try {
      const data = await getGoogleCalendars();
      setCalendars(data);
    } catch {
      // Silently fail - calendars only available when connected
      setCalendars([]);
    }
  }, []);

  const saveConfig = useCallback(
    async (
      updates: Partial<
        Pick<CalendarSyncConfig, 'enabled' | 'calendarId' | 'syncFrequencyMinutes'>
      >,
    ) => {
      setIsSaving(true);
      try {
        const updated = await updateCalendarSyncConfig(updates);
        setConfig(updated);
        setError(null);
        return updated;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to save';
        setError(msg);
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [],
  );

  const sync = useCallback(async (): Promise<CalendarSyncLog> => {
    setIsSyncing(true);
    stopPolling();

    try {
      const log = await triggerCalendarSync();
      setError(null);
      setActiveSyncLog(log);

      // If the log is already completed (synchronous path), refresh immediately
      if (log.completedAt !== null) {
        setActiveSyncLog(null);
        setIsSyncing(false);
        await Promise.all([fetchLogs(1, 20, dateFilter), fetchConfig()]);
        return log;
      }

      // Poll every 2 seconds until completedAt is set
      pollingIntervalRef.current = setInterval(async () => {
        try {
          const polled = await getCalendarSyncLog(log.id);
          setActiveSyncLog(polled);

          if (polled.completedAt !== null) {
            stopPolling();
            setIsSyncing(false);
            await Promise.all([fetchLogs(1, 20, dateFilter), fetchConfig()]);
          }
        } catch {
          // Polling errors are non-fatal; keep trying
        }
      }, 2000);

      return log;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed';
      setError(msg);
      setIsSyncing(false);
      throw err;
    }
  }, [stopPolling, fetchLogs, fetchConfig, dateFilter]);

  const reset = useCallback(async (): Promise<CalendarSyncLog> => {
    setIsSyncing(true);
    stopPolling();

    try {
      const log = await resetCalendarSync();
      setError(null);
      setActiveSyncLog(log);

      if (log.completedAt !== null) {
        setActiveSyncLog(null);
        setIsSyncing(false);
        await Promise.all([fetchLogs(1, 20, dateFilter), fetchConfig()]);
        return log;
      }

      pollingIntervalRef.current = setInterval(async () => {
        try {
          const polled = await getCalendarSyncLog(log.id);
          setActiveSyncLog(polled);

          if (polled.completedAt !== null) {
            stopPolling();
            setIsSyncing(false);
            await Promise.all([fetchLogs(1, 20, dateFilter), fetchConfig()]);
          }
        } catch {
          // Polling errors are non-fatal
        }
      }, 2000);

      return log;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Reset failed';
      setError(msg);
      setIsSyncing(false);
      throw err;
    }
  }, [stopPolling, fetchLogs, fetchConfig, dateFilter]);

  const disconnect = useCallback(async () => {
    try {
      await disconnectGoogleCalendar();
      await fetchConfig();
      setCalendars([]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    }
  }, [fetchConfig]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  return {
    config,
    logs,
    calendars,
    isLoading,
    isSaving,
    isSyncing,
    error,
    setError,
    fetchConfig,
    fetchLogs,
    fetchCalendars,
    saveConfig,
    sync,
    reset,
    disconnect,
    dateFilter,
    setDateFilter,
    activeSyncLog,
    setActiveSyncLog,
  };
}
