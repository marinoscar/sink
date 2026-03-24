import { useState, useCallback, useEffect } from 'react';
import {
  getCalendarSyncConfig,
  updateCalendarSyncConfig,
  triggerCalendarSync,
  getCalendarSyncLogs,
  disconnectGoogleCalendar,
  getGoogleCalendars,
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

  const fetchLogs = useCallback(async (page = 1, pageSize = 20) => {
    try {
      const data = await getCalendarSyncLogs({ page, pageSize });
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
    try {
      const log = await triggerCalendarSync();
      setError(null);
      // Refresh logs and config after sync
      await Promise.all([fetchLogs(), fetchConfig()]);
      return log;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed';
      setError(msg);
      throw err;
    } finally {
      setIsSyncing(false);
    }
  }, [fetchLogs, fetchConfig]);

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
    disconnect,
  };
}
