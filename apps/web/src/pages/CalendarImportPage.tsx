import { useState, useCallback } from 'react';
import {
  Container,
  Typography,
  Box,
  Paper,
  Button,
  Alert,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableRow,
} from '@mui/material';
import { UploadFile as UploadIcon } from '@mui/icons-material';
import { uploadCalendarJson, ApiError } from '../services/api';
import type { CalendarUploadResponse } from '../types';

export default function CalendarImportPage() {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CalendarUploadResponse | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset state
    setError(null);
    setResult(null);
    setFileName(file.name);

    // Validate file type
    if (!file.name.endsWith('.json')) {
      setError('Please select a JSON file.');
      return;
    }

    setIsUploading(true);
    try {
      const text = await file.text();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        setError('Invalid JSON file. Please check the file format.');
        return;
      }

      const response = await uploadCalendarJson(data);
      setResult(response);
    } catch (err) {
      if (err instanceof ApiError) {
        const parts = [`${err.message} (${err.status})`];
        if (err.code) parts.push(`Code: ${err.code}`);
        if (err.details) {
          if (Array.isArray(err.details)) {
            parts.push(...err.details.map((d: any) => d.message || String(d)));
          } else if (typeof err.details === 'string') {
            parts.push(err.details);
          }
        }
        setError(parts.join('\n'));
      } else {
        setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
      }
    } finally {
      setIsUploading(false);
      // Reset the input so the same file can be re-selected
      event.target.value = '';
    }
  }, []);

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" gutterBottom>
          Calendar Import
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Upload an Outlook calendar export JSON file. Entries will be created, updated, or
          marked as deleted based on changes since the last upload.
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2, whiteSpace: 'pre-line' }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {result && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setResult(null)}>
          Import completed successfully.
        </Alert>
      )}

      <Paper sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <Button
            component="label"
            variant="contained"
            startIcon={isUploading ? <CircularProgress size={20} color="inherit" /> : <UploadIcon />}
            disabled={isUploading}
            size="large"
          >
            {isUploading ? 'Uploading...' : 'Select JSON File'}
            <input
              type="file"
              accept=".json"
              hidden
              onChange={handleFileSelect}
            />
          </Button>

          {fileName && !isUploading && (
            <Typography variant="body2" color="text.secondary">
              Last file: {fileName}
            </Typography>
          )}
        </Box>

        {result && (
          <Box sx={{ mt: 3 }}>
            <Typography variant="h6" gutterBottom>
              Import Summary
            </Typography>
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell component="th" sx={{ fontWeight: 500 }}>Entries Processed</TableCell>
                  <TableCell align="right">{result.entriesProcessed}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell component="th" sx={{ fontWeight: 500, color: 'success.main' }}>Created</TableCell>
                  <TableCell align="right">{result.entriesCreated}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell component="th" sx={{ fontWeight: 500, color: 'info.main' }}>Updated</TableCell>
                  <TableCell align="right">{result.entriesUpdated}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell component="th" sx={{ fontWeight: 500, color: 'warning.main' }}>Deleted</TableCell>
                  <TableCell align="right">{result.entriesDeleted}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Box>
        )}
      </Paper>
    </Container>
  );
}
