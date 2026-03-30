import {
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  type SelectChangeEvent,
} from '@mui/material';

interface SimOption {
  id: string;
  slotIndex: number;
  carrierName: string | null;
  phoneNumber: string | null;
  displayName: string | null;
}

interface MessageSimFilterProps {
  sims: SimOption[];
  value: string;
  onSimChange: (simId?: string) => void;
}

function getSimLabel(sim: SimOption): string {
  if (sim.carrierName && sim.phoneNumber) {
    return `${sim.carrierName} (${sim.phoneNumber})`;
  }
  if (sim.carrierName) return sim.carrierName;
  if (sim.phoneNumber) return sim.phoneNumber;
  if (sim.displayName) return sim.displayName;
  return `SIM ${sim.slotIndex + 1}`;
}

export function MessageSimFilter({ sims, value, onSimChange }: MessageSimFilterProps) {
  const handleChange = (event: SelectChangeEvent<string>) => {
    const newValue = event.target.value;
    onSimChange(newValue || undefined);
  };

  return (
    <FormControl size="small" sx={{ minWidth: 180 }}>
      <InputLabel id="sim-filter-label">SIM</InputLabel>
      <Select
        labelId="sim-filter-label"
        value={value}
        label="SIM"
        onChange={handleChange}
        disabled={sims.length === 0}
      >
        <MenuItem value="">All SIMs</MenuItem>
        {sims.map((sim) => (
          <MenuItem key={sim.id} value={sim.id}>
            {getSimLabel(sim)}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
