import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Container,
  Box,
  Paper,
  Typography,
  Tabs,
  Tab,
  Alert,
  Snackbar,
  Button,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  FormControlLabel,
  Switch,
  CircularProgress,
  Chip,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  TablePagination,
  Divider,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import {
  LinkOff as DisconnectIcon,
  Link as ConnectIcon,
  Sync as SyncIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';
import { usePermissions } from '../hooks/usePermissions';
import { useCalendarSync } from '../hooks/useCalendarSync';
import { getGoogleCalendarAuthUrl } from '../services/api';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { SyncLogDetailDialog } from '../components/calendar/SyncLogDetailDialog';
import type { CalendarSyncLog } from '../types';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <div role="tabpanel" hidden={value !== index}>
      {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
    </div>
  );
}

const FREQUENCY_OPTIONS = [
  { value: 5, label: 'Every 5 minutes' },
  { value: 15, label: 'Every 15 minutes' },
  { value: 60, label: 'Every hour' },
  { value: 360, label: 'Every 6 hours' },
  { value: 1440, label: 'Once a day' },
];

function formatDateTime(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString();
}

function StatusChip({ status }: { status: string }) {
  if (status === 'success') {
    return (
      <Chip
        label="Success"
        color="success"
        size="small"
        icon={<CheckCircleIcon />}
      />
    );
  }
  if (status === 'error') {
    return (
      <Chip
        label="Error"
        color="error"
        size="small"
        icon={<ErrorIcon />}
      />
    );
  }
  return <Chip label={status === 'no_changes' ? 'No changes' : status} size="small" />;
}

export default function CalendarSyncPage() {
  const { isAdmin } = usePermissions();

  const {
    config,
    logs,
    calendars,
    isLoading,
    isSaving,
    isSyncing,
    error,
    setError,
    fetchLogs,
    fetchCalendars,
    saveConfig,
    sync,
    disconnect,
    dateFilter,
    setDateFilter,
    activeSyncLog,
  } = useCalendarSync();

  const [tabIndex, setTabIndex] = useState(0);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<CalendarSyncLog | null>(null);

  // Local form state
  const [localEnabled, setLocalEnabled] = useState(false);
  const [localCalendarId, setLocalCalendarId] = useState('');
  const [localFrequency, setLocalFrequency] = useState(15);

  // Logs pagination
  const [logsPage, setLogsPage] = useState(0);
  const [logsPageSize, setLogsPageSize] = useState(20);

  // Redirect non-admins
  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  // Sync local form with loaded config
  useEffect(() => {
    if (config) {
      setLocalEnabled(config.enabled);
      setLocalCalendarId(config.calendarId ?? '');
      setLocalFrequency(config.syncFrequencyMinutes ?? 15);
    }
  }, [config]);

  // Load calendars when connected
  useEffect(() => {
    if (config?.isConnected) {
      fetchCalendars();
    }
  }, [config?.isConnected, fetchCalendars]);

  // Re-fetch logs when dateFilter changes (only when on the logs tab)
  useEffect(() => {
    if (tabIndex === 1) {
      fetchLogs(1, logsPageSize, dateFilter);
      setLogsPage(0);
    }
  }, [dateFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load logs when switching to logs tab
  const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
    setTabIndex(newValue);
    if (newValue === 1) {
      fetchLogs(logsPage + 1, logsPageSize, dateFilter);
    }
  };

  const handleSave = async () => {
    try {
      await saveConfig({
        enabled: localEnabled,
        calendarId: localCalendarId,
        syncFrequencyMinutes: localFrequency,
      });
      setSuccessMessage('Configuration saved');
    } catch {
      // error is set in the hook
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
      setSuccessMessage('Google Calendar disconnected');
    } catch {
      // error is set in the hook
    }
  };

  const handleSyncNow = async () => {
    try {
      const log = await sync();
      // Open the detail dialog immediately with the running (or completed) log
      setSelectedLog(log);
      setSuccessMessage('Sync triggered successfully');
    } catch {
      // error is set in the hook
    }
  };

  const handleLogsPageChange = (_: unknown, newPage: number) => {
    setLogsPage(newPage);
    fetchLogs(newPage + 1, logsPageSize, dateFilter);
  };

  const handleLogsRowsPerPageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newSize = parseInt(event.target.value, 10);
    setLogsPageSize(newSize);
    setLogsPage(0);
    fetchLogs(1, newSize, dateFilter);
  };

  const handleDateFilterChange = (_: React.MouseEvent<HTMLElement>, val: string | null) => {
    if (val) setDateFilter(val);
  };

  const handleDialogClose = () => {
    setSelectedLog(null);
  };

  // Dialog shows the selected row, or the active running sync if no row is explicitly selected
  const dialogLog = selectedLog ?? (activeSyncLog?.status === 'running' ? activeSyncLog : null);
  const dialogOpen = !!(selectedLog || activeSyncLog?.status === 'running');

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" gutterBottom>
        Calendar Sync
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Paper>
        <Tabs
          value={tabIndex}
          onChange={handleTabChange}
          sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}
        >
          <Tab label="Configuration" />
          <Tab label="Sync Logs" />
        </Tabs>

        {/* Tab 1: Configuration */}
        <TabPanel value={tabIndex} index={0}>
          <Box sx={{ px: 3 }}>
            {/* Connection Status */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" gutterBottom>
                Google Account
              </Typography>
              {config?.isConnected ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                  <Chip
                    label={config.googleEmail ?? 'Connected'}
                    color="success"
                    icon={<CheckCircleIcon />}
                  />
                  <Button
                    variant="outlined"
                    color="error"
                    size="small"
                    startIcon={<DisconnectIcon />}
                    onClick={handleDisconnect}
                    disabled={isSaving}
                  >
                    Disconnect
                  </Button>
                </Box>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Alert severity="info">
                    Connect your Google account to enable calendar synchronization.
                  </Alert>
                  <Box>
                    <Button
                      variant="contained"
                      startIcon={<ConnectIcon />}
                      href={getGoogleCalendarAuthUrl()}
                    >
                      Connect Google Calendar
                    </Button>
                  </Box>
                </Box>
              )}
            </Box>

            {config?.isConnected && (config?.lastSyncStatus === 'token_revoked' || config?.lastSyncStatus === 'auth_error') && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                Your Google Calendar authorization has been revoked or expired.
                Please disconnect and reconnect your Google account to resume syncing.
              </Alert>
            )}

            <Divider sx={{ mb: 3 }} />

            {/* Sync Settings - always visible */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" gutterBottom>
                Sync Settings
              </Typography>

              {/* Calendar Picker - only when connected */}
              {config?.isConnected && (
                <FormControl fullWidth sx={{ mb: 2 }}>
                  <InputLabel id="calendar-select-label">Calendar</InputLabel>
                  <Select
                    labelId="calendar-select-label"
                    value={localCalendarId}
                    label="Calendar"
                    onChange={(e) => setLocalCalendarId(e.target.value)}
                  >
                    {calendars.length === 0 && (
                      <MenuItem value="" disabled>
                        No calendars available
                      </MenuItem>
                    )}
                    {calendars.map((cal) => (
                      <MenuItem key={cal.id} value={cal.id}>
                        {cal.summary}
                        {cal.primary && (
                          <Chip label="Primary" size="small" sx={{ ml: 1 }} />
                        )}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              <FormControl fullWidth sx={{ mb: 2 }}>
                <InputLabel id="frequency-select-label">Sync Frequency</InputLabel>
                <Select
                  labelId="frequency-select-label"
                  value={localFrequency}
                  label="Sync Frequency"
                  onChange={(e) => setLocalFrequency(Number(e.target.value))}
                >
                  {FREQUENCY_OPTIONS.map((opt) => (
                    <MenuItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControlLabel
                control={
                  <Switch
                    checked={localEnabled}
                    onChange={(e) => setLocalEnabled(e.target.checked)}
                    disabled={!config?.isConnected}
                  />
                }
                label={
                  config?.isConnected
                    ? 'Enable automatic sync'
                    : 'Enable automatic sync (connect Google account first)'
                }
                sx={{ mb: 2 }}
              />
            </Box>

            {/* Last Sync Info */}
            {config && (config.lastSyncAt || config.lastSyncStatus) && (
              <>
                <Divider sx={{ mb: 2 }} />
                <Box sx={{ mb: 3 }}>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Last Sync
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                    <Typography variant="body2">
                      {formatDateTime(config.lastSyncAt)}
                    </Typography>
                    {config.lastSyncStatus && (
                      <StatusChip status={config.lastSyncStatus} />
                    )}
                  </Box>
                </Box>
              </>
            )}

            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                variant="contained"
                onClick={handleSave}
                disabled={isSaving}
                startIcon={isSaving ? <CircularProgress size={16} /> : undefined}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </Box>
          </Box>
        </TabPanel>

        {/* Tab 2: Sync Logs */}
        <TabPanel value={tabIndex} index={1}>
          <Box sx={{ px: 3 }}>
            {/* Toolbar: date filter + sync button */}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 1,
                mb: 2,
              }}
            >
              <ToggleButtonGroup
                value={dateFilter}
                exclusive
                onChange={handleDateFilterChange}
                size="small"
              >
                <ToggleButton value="today">Today</ToggleButton>
                <ToggleButton value="yesterday">Yesterday</ToggleButton>
                <ToggleButton value="last7">Last 7 Days</ToggleButton>
                <ToggleButton value="last30">Last 30 Days</ToggleButton>
                <ToggleButton value="all">All</ToggleButton>
              </ToggleButtonGroup>

              <Button
                variant="contained"
                startIcon={
                  isSyncing ? <CircularProgress size={16} color="inherit" /> : <SyncIcon />
                }
                onClick={handleSyncNow}
                disabled={isSyncing || !config?.isConnected}
              >
                {isSyncing ? 'Syncing...' : 'Sync Now'}
              </Button>
            </Box>

            {/* Active sync progress card */}
            {activeSyncLog && activeSyncLog.status === 'running' && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  p: 2,
                  mb: 2,
                  bgcolor: 'action.hover',
                  borderRadius: 1,
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <CircularProgress size={20} />
                <Typography variant="body2">Sync in progress...</Typography>
              </Box>
            )}

            {logs && logs.items.length > 0 ? (
              <>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Time</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell align="right">Processed</TableCell>
                        <TableCell align="right">Created</TableCell>
                        <TableCell align="right">Updated</TableCell>
                        <TableCell align="right">Deleted</TableCell>
                        <TableCell>Error</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {logs.items.map((log) => (
                        <TableRow
                          key={log.id}
                          hover
                          sx={{ cursor: 'pointer' }}
                          onClick={() => setSelectedLog(log)}
                        >
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>
                            {formatDateTime(log.startedAt)}
                          </TableCell>
                          <TableCell>
                            <StatusChip status={log.status} />
                          </TableCell>
                          <TableCell align="right">{log.entriesProcessed}</TableCell>
                          <TableCell align="right">{log.entriesCreated}</TableCell>
                          <TableCell align="right">{log.entriesUpdated}</TableCell>
                          <TableCell align="right">{log.entriesDeleted}</TableCell>
                          <TableCell
                            sx={{
                              maxWidth: 200,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {log.errorMessage ?? '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <TablePagination
                  component="div"
                  count={logs.meta.totalItems}
                  page={logsPage}
                  rowsPerPage={logsPageSize}
                  rowsPerPageOptions={[10, 20, 50]}
                  onPageChange={handleLogsPageChange}
                  onRowsPerPageChange={handleLogsRowsPerPageChange}
                />
              </>
            ) : (
              <Alert severity="info">
                No sync logs yet. Trigger a sync or wait for the next scheduled run.
              </Alert>
            )}
          </Box>
        </TabPanel>
      </Paper>

      {/* Sync log detail dialog */}
      <SyncLogDetailDialog
        log={dialogLog}
        open={dialogOpen}
        onClose={handleDialogClose}
      />

      {/* Success snackbar */}
      <Snackbar
        open={!!successMessage}
        autoHideDuration={4000}
        onClose={() => setSuccessMessage(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity="success"
          onClose={() => setSuccessMessage(null)}
          sx={{ width: '100%' }}
        >
          {successMessage}
        </Alert>
      </Snackbar>
    </Container>
  );
}
