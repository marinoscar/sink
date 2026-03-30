import { useState, useEffect, useCallback } from 'react';
import { Paper, Box, Typography, Button } from '@mui/material';
import { Download as DownloadIcon } from '@mui/icons-material';
import { MessageDateFilter } from './MessageDateFilter';
import { MessageSenderFilter } from './MessageSenderFilter';
import { MessageDeviceFilter } from './MessageDeviceFilter';
import { MessageSimFilter } from './MessageSimFilter';
import { getDeviceTextMessageDevices } from '../../services/api';
import { exportMessagesToCsv } from '../../utils/csv';
import type { UserDevice, SmsMessageItem } from '../../types';

interface MessagesToolbarProps {
  onDateChange: (dateFrom?: string, dateTo?: string) => void;
  onSenderChange: (sender?: string) => void;
  onDeviceChange: (deviceId?: string) => void;
  onSimChange: (simId?: string) => void;
  messages: SmsMessageItem[];
  initialDeviceId?: string;
}

export function MessagesToolbar({
  onDateChange,
  onSenderChange,
  onDeviceChange,
  onSimChange,
  messages,
  initialDeviceId,
}: MessagesToolbarProps) {
  const [devices, setDevices] = useState<UserDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(initialDeviceId || '');
  const [selectedSimId, setSelectedSimId] = useState('');

  useEffect(() => {
    getDeviceTextMessageDevices()
      .then(setDevices)
      .catch(() => {});
  }, []);

  // If initialDeviceId is provided (from URL), notify parent
  useEffect(() => {
    if (initialDeviceId) {
      onDeviceChange(initialDeviceId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDeviceId]);

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);
  const sims = selectedDevice?.sims || [];

  const handleDeviceChange = useCallback((deviceId?: string) => {
    setSelectedDeviceId(deviceId || '');
    setSelectedSimId('');
    onDeviceChange(deviceId);
    onSimChange(undefined);
  }, [onDeviceChange, onSimChange]);

  const handleSimChange = useCallback((simId?: string) => {
    setSelectedSimId(simId || '');
    onSimChange(simId);
  }, [onSimChange]);

  const handleExportCsv = useCallback(() => {
    if (messages.length > 0) {
      exportMessagesToCsv(messages);
    }
  }, [messages]);

  return (
    <Paper sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
        <Typography variant="subtitle2" color="text.secondary">
          Filters
        </Typography>
        <Button
          size="small"
          startIcon={<DownloadIcon />}
          onClick={handleExportCsv}
          disabled={messages.length === 0}
        >
          Export CSV
        </Button>
      </Box>
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
        <MessageDeviceFilter
          devices={devices}
          value={selectedDeviceId}
          onDeviceChange={handleDeviceChange}
        />
        <MessageSimFilter
          sims={sims}
          value={selectedSimId}
          onSimChange={handleSimChange}
        />
      </Box>
    </Paper>
  );
}
