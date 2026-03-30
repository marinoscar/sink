import { useState } from 'react';
import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Typography,
  Box,
  CircularProgress,
  Alert,
  Tooltip,
  IconButton,
  Snackbar,
} from '@mui/material';
import { Sms as SmsIcon, ContentCopy } from '@mui/icons-material';
import type { SmsMessageItem } from '../../types';

const MAX_BODY_PREVIEW = 100;

interface MessagesTableProps {
  messages: SmsMessageItem[];
  total: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  error: string | null;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function SimCell({ item }: { item: SmsMessageItem }) {
  if (item.carrierName) return <>{item.carrierName}</>;
  if (item.simSlotIndex !== null) return <>SIM {item.simSlotIndex + 1}</>;
  return <Typography variant="body2" color="text.disabled">—</Typography>;
}

function MessageBodyCell({ body }: { body: string }) {
  const [expanded, setExpanded] = useState(false);

  if (body.length <= MAX_BODY_PREVIEW) {
    return <>{body}</>;
  }

  if (expanded) {
    return (
      <span>
        {body}{' '}
        <Typography
          component="span"
          variant="caption"
          color="primary"
          sx={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
          onClick={() => setExpanded(false)}
        >
          show less
        </Typography>
      </span>
    );
  }

  return (
    <Tooltip title={body} placement="top">
      <span>
        {body.slice(0, MAX_BODY_PREVIEW)}
        {'... '}
        <Typography
          component="span"
          variant="caption"
          color="primary"
          sx={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
          onClick={() => setExpanded(true)}
        >
          more
        </Typography>
      </span>
    </Tooltip>
  );
}

export function MessagesTable({
  messages,
  total,
  page,
  pageSize,
  isLoading,
  error,
  onPageChange,
  onPageSizeChange,
}: MessagesTableProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (msg: SmsMessageItem) => {
    try {
      await navigator.clipboard.writeText(msg.body);
      setCopiedId(msg.id);
    } catch {
      // Fallback: silently fail
    }
  };

  const handleChangePage = (_: unknown, newPage: number) => {
    onPageChange(newPage + 1);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    onPageSizeChange(parseInt(event.target.value, 10));
  };

  if (error) {
    return (
      <Alert severity="error" sx={{ mt: 2 }}>
        {error}
      </Alert>
    );
  }

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (messages.length === 0) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          py: 8,
          gap: 2,
          color: 'text.secondary',
        }}
      >
        <SmsIcon sx={{ fontSize: 48, opacity: 0.4 }} />
        <Typography color="text.secondary">No messages found</Typography>
      </Box>
    );
  }

  return (
    <>
    <Paper>
      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>Date / Time</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>Sender</TableCell>
              <TableCell>Message</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>Device</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>SIM</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {messages.map((msg) => (
              <TableRow key={msg.id} hover>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  <Typography variant="body2">
                    {formatDateTime(msg.smsTimestamp)}
                  </Typography>
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  <Typography variant="body2">{msg.sender}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">
                    <MessageBodyCell body={msg.body} />
                  </Typography>
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  <Typography variant="body2">{msg.device.name}</Typography>
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  <Typography variant="body2">
                    <SimCell item={msg} />
                  </Typography>
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap', width: 48 }}>
                  <Tooltip title="Copy message">
                    <IconButton size="small" onClick={() => handleCopy(msg)}>
                      <ContentCopy fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={total}
        page={page - 1}
        onPageChange={handleChangePage}
        rowsPerPage={pageSize}
        onRowsPerPageChange={handleChangeRowsPerPage}
        rowsPerPageOptions={[10, 25, 50, 100]}
      />
    </Paper>
    <Snackbar
      open={copiedId !== null}
      autoHideDuration={2000}
      onClose={() => setCopiedId(null)}
      message="Copied to clipboard"
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    />
    </>
  );
}
