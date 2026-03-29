import { useState, useEffect } from 'react';
import {
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  type SelectChangeEvent,
} from '@mui/material';
import { getDeviceTextMessageDevices } from '../../services/api';
import type { UserDevice } from '../../types';

interface MessageDeviceFilterProps {
  onDeviceChange: (deviceId?: string) => void;
}

function getDeviceLabel(device: UserDevice): string {
  if (device.model) {
    return `${device.name} (${device.model})`;
  }
  return device.name;
}

export function MessageDeviceFilter({ onDeviceChange }: MessageDeviceFilterProps) {
  const [devices, setDevices] = useState<UserDevice[]>([]);
  const [value, setValue] = useState('');

  useEffect(() => {
    getDeviceTextMessageDevices()
      .then(setDevices)
      .catch(() => {
        // Non-fatal: filter degrades gracefully
      });
  }, []);

  const handleChange = (event: SelectChangeEvent<string>) => {
    const newValue = event.target.value;
    setValue(newValue);
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
