import { useState, useEffect, useCallback } from 'react';
import { Container, Typography, Box } from '@mui/material';
import { MessagesToolbar } from '../components/messages/MessagesToolbar';
import { MessagesTable } from '../components/messages/MessagesTable';
import { getDeviceTextMessages } from '../services/api';
import type { SmsMessageItem, MessageQueryParams } from '../types';

export default function MessagesPage() {
  const [messages, setMessages] = useState<SmsMessageItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState<string | undefined>(undefined);
  const [dateTo, setDateTo] = useState<string | undefined>(undefined);
  const [sender, setSender] = useState<string | undefined>(undefined);
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);

  const fetchMessages = useCallback(async (params: MessageQueryParams) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await getDeviceTextMessages(params);
      setMessages(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages');
      setMessages([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMessages({ page, pageSize, dateFrom, dateTo, sender, deviceId });
  }, [page, pageSize, dateFrom, dateTo, sender, deviceId, fetchMessages]);

  const handleDateChange = (from?: string, to?: string) => {
    setDateFrom(from);
    setDateTo(to);
    setPage(1);
  };

  const handleSenderChange = (newSender?: string) => {
    setSender(newSender);
    setPage(1);
  };

  const handleDeviceChange = (newDeviceId?: string) => {
    setDeviceId(newDeviceId);
    setPage(1);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(1);
  };

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Typography variant="h4" gutterBottom>
        Messages
      </Typography>

      <MessagesToolbar
        onDateChange={handleDateChange}
        onSenderChange={handleSenderChange}
        onDeviceChange={handleDeviceChange}
      />

      <Box sx={{ mt: 2 }}>
        <MessagesTable
          messages={messages}
          total={total}
          page={page}
          pageSize={pageSize}
          isLoading={isLoading}
          error={error}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
        />
      </Box>
    </Container>
  );
}
