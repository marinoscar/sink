import { useState } from 'react';
import {
  Box,
  ToggleButton,
  ToggleButtonGroup,
  TextField,
  Typography,
} from '@mui/material';

type DatePreset = 'today' | 'week' | 'month' | 'custom' | 'all';

interface MessageDateFilterProps {
  onDateChange: (dateFrom?: string, dateTo?: string) => void;
}

function getStartOfDay(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function getEndOfDay(date: Date): string {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toDateInputValue(isoString: string): string {
  return isoString.slice(0, 10);
}

export function MessageDateFilter({ onDateChange }: MessageDateFilterProps) {
  const [preset, setPreset] = useState<DatePreset>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const handlePresetChange = (_: React.MouseEvent<HTMLElement>, value: DatePreset | null) => {
    if (!value) return;
    setPreset(value);

    const now = new Date();

    if (value === 'all') {
      onDateChange(undefined, undefined);
    } else if (value === 'today') {
      onDateChange(getStartOfDay(now), getEndOfDay(now));
    } else if (value === 'week') {
      onDateChange(getMondayOfWeek(now).toISOString(), now.toISOString());
    } else if (value === 'month') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      startOfMonth.setHours(0, 0, 0, 0);
      onDateChange(startOfMonth.toISOString(), now.toISOString());
    } else if (value === 'custom') {
      // Emit whatever custom values are currently set
      onDateChange(
        customFrom ? new Date(customFrom).toISOString() : undefined,
        customTo ? new Date(customTo + 'T23:59:59').toISOString() : undefined,
      );
    }
  };

  const handleCustomFromChange = (value: string) => {
    setCustomFrom(value);
    if (preset === 'custom') {
      onDateChange(
        value ? new Date(value).toISOString() : undefined,
        customTo ? new Date(customTo + 'T23:59:59').toISOString() : undefined,
      );
    }
  };

  const handleCustomToChange = (value: string) => {
    setCustomTo(value);
    if (preset === 'custom') {
      onDateChange(
        customFrom ? new Date(customFrom).toISOString() : undefined,
        value ? new Date(value + 'T23:59:59').toISOString() : undefined,
      );
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <ToggleButtonGroup
        value={preset}
        exclusive
        onChange={handlePresetChange}
        size="small"
        aria-label="date filter"
      >
        <ToggleButton value="all" aria-label="all time">
          All
        </ToggleButton>
        <ToggleButton value="today" aria-label="today">
          Today
        </ToggleButton>
        <ToggleButton value="week" aria-label="this week">
          This Week
        </ToggleButton>
        <ToggleButton value="month" aria-label="this month">
          This Month
        </ToggleButton>
        <ToggleButton value="custom" aria-label="custom range">
          Custom
        </ToggleButton>
      </ToggleButtonGroup>

      {preset === 'custom' && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            label="From"
            type="date"
            size="small"
            value={customFrom}
            onChange={(e) => handleCustomFromChange(e.target.value)}
            InputLabelProps={{ shrink: true }}
            inputProps={{ max: toDateInputValue(new Date().toISOString()) }}
          />
          <Typography variant="body2" color="text.secondary">
            to
          </Typography>
          <TextField
            label="To"
            type="date"
            size="small"
            value={customTo}
            onChange={(e) => handleCustomToChange(e.target.value)}
            InputLabelProps={{ shrink: true }}
            inputProps={{
              min: customFrom || undefined,
              max: toDateInputValue(new Date().toISOString()),
            }}
          />
        </Box>
      )}
    </Box>
  );
}
