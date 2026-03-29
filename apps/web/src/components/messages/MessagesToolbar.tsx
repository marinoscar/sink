import { Paper, Box, Typography } from '@mui/material';
import { MessageDateFilter } from './MessageDateFilter';
import { MessageSenderFilter } from './MessageSenderFilter';
import { MessageDeviceFilter } from './MessageDeviceFilter';

interface MessagesToolbarProps {
  onDateChange: (dateFrom?: string, dateTo?: string) => void;
  onSenderChange: (sender?: string) => void;
  onDeviceChange: (deviceId?: string) => void;
}

export function MessagesToolbar({
  onDateChange,
  onSenderChange,
  onDeviceChange,
}: MessagesToolbarProps) {
  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5 }}>
        Filters
      </Typography>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 2,
          alignItems: 'flex-start',
        }}
      >
        <MessageDateFilter onDateChange={onDateChange} />
        <MessageSenderFilter onSenderChange={onSenderChange} />
        <MessageDeviceFilter onDeviceChange={onDeviceChange} />
      </Box>
    </Paper>
  );
}
