import {
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  type SelectChangeEvent,
} from '@mui/material';
import type { UserDevice } from '../../types';

interface MessageDeviceFilterProps {
  devices: UserDevice[];
  value: string;
  onDeviceChange: (deviceId?: string) => void;
}

function getDeviceLabel(device: UserDevice): string {
  if (device.model) {
    return `${device.name} (${device.model})`;
  }
  return device.name;
}

export function MessageDeviceFilter({ devices, value, onDeviceChange }: MessageDeviceFilterProps) {
  const handleChange = (event: SelectChangeEvent<string>) => {
    const newValue = event.target.value;
    onDeviceChange(newValue || undefined);
  };

  return (
    <FormControl size="small" sx={{ minWidth: 180 }}>
      <InputLabel id="device-filter-label">Device</InputLabel>
      <Select
        labelId="device-filter-label"
        value={value}
        label="Device"
        onChange={handleChange}
      >
        <MenuItem value="">All Devices</MenuItem>
        {devices.map((device) => (
          <MenuItem key={device.id} value={device.id}>
            {getDeviceLabel(device)}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
