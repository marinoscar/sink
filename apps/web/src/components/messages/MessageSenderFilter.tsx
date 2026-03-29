import { useState, useEffect } from 'react';
import { Autocomplete, TextField } from '@mui/material';
import { getDeviceTextMessageSenders } from '../../services/api';

interface MessageSenderFilterProps {
  onSenderChange: (sender?: string) => void;
}

export function MessageSenderFilter({ onSenderChange }: MessageSenderFilterProps) {
  const [senders, setSenders] = useState<string[]>([]);
  const [value, setValue] = useState<string | null>(null);

  useEffect(() => {
    getDeviceTextMessageSenders()
      .then(setSenders)
      .catch(() => {
        // Non-fatal: filters work without suggestions
      });
  }, []);

  const handleChange = (_: React.SyntheticEvent, newValue: string | null) => {
    setValue(newValue);
    onSenderChange(newValue || undefined);
  };

  return (
    <Autocomplete
      freeSolo
      options={senders}
      value={value}
      onChange={handleChange}
      onInputChange={(_, _inputValue, reason) => {
        if (reason === 'clear') {
          setValue(null);
          onSenderChange(undefined);
        }
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Sender"
          size="small"
          placeholder="Filter by sender"
          sx={{ minWidth: 180 }}
        />
      )}
      size="small"
    />
  );
}
