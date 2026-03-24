import { useState, FormEvent } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Alert,
  Box,
  MenuItem,
  IconButton,
  InputAdornment,
  Typography,
} from '@mui/material';
import { ContentCopy as CopyIcon } from '@mui/icons-material';

interface CreateTokenDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (name: string, expiresInHours: number) => Promise<{ token: string }>;
}

const EXPIRATION_PRESETS = [
  { label: '1 hour', hours: 1 },
  { label: '24 hours', hours: 24 },
  { label: '7 days', hours: 168 },
  { label: '30 days', hours: 720 },
  { label: '90 days', hours: 2160 },
  { label: '1 year', hours: 8760 },
  { label: '100 years', hours: 876000 },
];

export function CreateTokenDialog({ open, onClose, onSubmit }: CreateTokenDialogProps) {
  const [name, setName] = useState('');
  const [expiresInHours, setExpiresInHours] = useState(720); // 30 days default
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setError(null);
    setIsSubmitting(true);
    try {
      const result = await onSubmit(name.trim(), expiresInHours);
      setCreatedToken(result.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create token');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopy = async () => {
    if (createdToken) {
      await navigator.clipboard.writeText(createdToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    if (isSubmitting) return;
    setName('');
    setExpiresInHours(720);
    setError(null);
    setCreatedToken(null);
    setCopied(false);
    onClose();
  };

  // After token is created, show the token value
  if (createdToken) {
    return (
      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>Token Created</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Copy this token now. You won't be able to see it again.
          </Alert>
          <TextField
            fullWidth
            value={createdToken}
            InputProps={{
              readOnly: true,
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton onClick={handleCopy} edge="end">
                    <CopyIcon />
                  </IconButton>
                </InputAdornment>
              ),
              sx: { fontFamily: 'monospace', fontSize: '0.85rem' },
            }}
          />
          {copied && (
            <Typography variant="caption" color="success.main" sx={{ mt: 0.5, display: 'block' }}>
              Copied to clipboard
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} variant="contained">
            Done
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>Create Access Token</DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              label="Token Name"
              placeholder="e.g., calendar-sync-script"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              fullWidth
              autoFocus
            />
            <TextField
              select
              label="Expiration"
              value={expiresInHours}
              onChange={(e) => setExpiresInHours(Number(e.target.value))}
              fullWidth
            >
              {EXPIRATION_PRESETS.map((preset) => (
                <MenuItem key={preset.hours} value={preset.hours}>
                  {preset.label}
                </MenuItem>
              ))}
            </TextField>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={isSubmitting || !name.trim()}
          >
            {isSubmitting ? 'Creating...' : 'Create Token'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
