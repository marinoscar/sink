import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Box,
  Typography,
  Chip,
  Alert,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TableHead,
  Divider,
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import type { CalendarSyncLog } from '../../types';

interface Props {
  log: CalendarSyncLog | null;
  open: boolean;
  onClose: () => void;
}

interface ErrorDetail {
  entryId?: string;
  error?: string;
  [key: string]: unknown;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString();
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return 'In progress...';
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function StatusChip({ status }: { status: string }) {
  const statusConfig: Record<string, { label: string; color: 'success' | 'error' | 'info' | 'default' }> = {
    success: { label: 'Success', color: 'success' },
    error: { label: 'Error', color: 'error' },
    running: { label: 'Running', color: 'info' },
    no_changes: { label: 'No Changes', color: 'default' },
  };

  const config = statusConfig[status] ?? { label: status, color: 'default' };
  return <Chip label={config.label} color={config.color} size="small" />;
}

const MAX_ERROR_ROWS = 50;

export function SyncLogDetailDialog({ log, open, onClose }: Props) {
  if (!log) return null;

  const isRunning = log.status === 'running';
  const errorDetails = Array.isArray(log.errorDetails) ? (log.errorDetails as ErrorDetail[]) : null;
  const truncated = errorDetails && errorDetails.length > MAX_ERROR_ROWS;
  const visibleDetails = errorDetails ? errorDetails.slice(0, MAX_ERROR_ROWS) : null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 4 }}>
          <Typography variant="h6" component="span" sx={{ flexGrow: 1 }}>
            Sync Log Details
          </Typography>
          <StatusChip status={log.status} />
        </Box>
        <IconButton
          aria-label="close"
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        {isRunning && (
          <Box sx={{ mb: 2 }}>
            <LinearProgress />
          </Box>
        )}

        {/* Timestamps */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Timestamps
          </Typography>
          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell sx={{ pl: 0, borderBottom: 'none', width: 120 }}>
                  <Typography variant="body2" color="text.secondary">Started</Typography>
                </TableCell>
                <TableCell sx={{ borderBottom: 'none' }}>
                  <Typography variant="body2">{formatDateTime(log.startedAt)}</Typography>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ pl: 0, borderBottom: 'none' }}>
                  <Typography variant="body2" color="text.secondary">Completed</Typography>
                </TableCell>
                <TableCell sx={{ borderBottom: 'none' }}>
                  <Typography variant="body2">
                    {log.completedAt ? formatDateTime(log.completedAt) : 'In progress...'}
                  </Typography>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ pl: 0, borderBottom: 'none' }}>
                  <Typography variant="body2" color="text.secondary">Duration</Typography>
                </TableCell>
                <TableCell sx={{ borderBottom: 'none' }}>
                  <Typography variant="body2">
                    {formatDuration(log.startedAt, log.completedAt)}
                  </Typography>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* Stats */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Statistics
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 1,
              textAlign: 'center',
            }}
          >
            {[
              { label: 'Processed', value: log.entriesProcessed },
              { label: 'Created', value: log.entriesCreated },
              { label: 'Updated', value: log.entriesUpdated },
              { label: 'Deleted', value: log.entriesDeleted },
            ].map(({ label, value }) => (
              <Box key={label} sx={{ p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                <Typography variant="h6">{value}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {label}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>

        {/* Error message */}
        {log.errorMessage && (
          <>
            <Divider sx={{ my: 2 }} />
            <Alert severity="error" sx={{ mb: 2 }}>
              {log.errorMessage}
            </Alert>
          </>
        )}

        {/* Per-entry error details */}
        {visibleDetails && visibleDetails.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Failed Entries
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Entry ID</TableCell>
                  <TableCell>Error</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleDetails.map((detail, index) => (
                  <TableRow key={detail.entryId ?? index}>
                    <TableCell
                      sx={{
                        maxWidth: 150,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {detail.entryId ?? '—'}
                    </TableCell>
                    <TableCell
                      sx={{
                        maxWidth: 300,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {typeof detail.error === 'string' ? detail.error : JSON.stringify(detail.error)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {truncated && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                Showing first {MAX_ERROR_ROWS} of {errorDetails!.length} failed entries.
              </Typography>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
