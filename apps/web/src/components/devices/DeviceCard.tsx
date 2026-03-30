import {
  Card,
  CardContent,
  CardActions,
  Typography,
  Chip,
  Box,
  Button,
  Divider,
} from '@mui/material';
import {
  PhoneAndroid as PhoneIcon,
  SimCard as SimCardIcon,
  Visibility as ViewIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import type { UserDevice } from '../../types';

interface DeviceCardProps {
  device: UserDevice;
}

function formatLastSeen(iso: string | null): string {
  if (!iso) return 'Never';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function getSimLabel(sim: UserDevice['sims'][number]): string {
  if (sim.carrierName && sim.phoneNumber) {
    return `${sim.carrierName} (${sim.phoneNumber})`;
  }
  if (sim.carrierName) return sim.carrierName;
  if (sim.phoneNumber) return sim.phoneNumber;
  if (sim.displayName) return sim.displayName;
  return `SIM ${sim.slotIndex + 1}`;
}

export function DeviceCard({ device }: DeviceCardProps) {
  const navigate = useNavigate();

  const handleViewMessages = () => {
    navigate(`/messages?deviceId=${device.id}`);
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <PhoneIcon color="action" />
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            {device.name}
          </Typography>
          <Chip
            label={device.isActive ? 'Active' : 'Inactive'}
            color={device.isActive ? 'success' : 'default'}
            size="small"
          />
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 1.5 }}>
          {device.model && (
            <Typography variant="body2" color="text.secondary">
              {[device.manufacturer, device.model].filter(Boolean).join(' ')}
            </Typography>
          )}
          {device.osVersion && (
            <Typography variant="body2" color="text.secondary">
              {device.platform} {device.osVersion}
            </Typography>
          )}
          <Typography variant="body2" color="text.secondary">
            Last seen: {formatLastSeen(device.lastSeenAt)}
          </Typography>
        </Box>

        {device.sims.length > 0 && (
          <>
            <Divider sx={{ my: 1 }} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
              <SimCardIcon fontSize="small" color="action" />
              <Typography variant="subtitle2" color="text.secondary">
                SIM Cards
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {device.sims.map((sim) => (
                <Chip
                  key={sim.id}
                  label={getSimLabel(sim)}
                  size="small"
                  variant="outlined"
                />
              ))}
            </Box>
          </>
        )}
      </CardContent>
      <CardActions>
        <Button
          size="small"
          startIcon={<ViewIcon />}
          onClick={handleViewMessages}
        >
          View Messages
        </Button>
      </CardActions>
    </Card>
  );
}
