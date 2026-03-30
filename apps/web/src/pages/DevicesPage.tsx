import { useState, useEffect } from 'react';
import {
  Container,
  Typography,
  Box,
  CircularProgress,
  Alert,
  Grid,
} from '@mui/material';
import { PhoneAndroid as PhoneIcon } from '@mui/icons-material';
import { DeviceCard } from '../components/devices/DeviceCard';
import { getDeviceTextMessageDevices } from '../services/api';
import type { UserDevice } from '../types';

export default function DevicesPage() {
  const [devices, setDevices] = useState<UserDevice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    getDeviceTextMessageDevices()
      .then(setDevices)
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load devices');
      })
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Typography variant="h4" gutterBottom>
        Devices
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {!isLoading && !error && devices.length === 0 && (
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
          <PhoneIcon sx={{ fontSize: 48, opacity: 0.4 }} />
          <Typography color="text.secondary">No devices registered</Typography>
        </Box>
      )}

      {!isLoading && devices.length > 0 && (
        <Grid container spacing={2}>
          {devices.map((device) => (
            <Grid item xs={12} sm={6} md={4} key={device.id}>
              <DeviceCard device={device} />
            </Grid>
          ))}
        </Grid>
      )}
    </Container>
  );
}
