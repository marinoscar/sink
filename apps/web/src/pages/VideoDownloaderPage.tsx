import { useState, useCallback, KeyboardEvent } from 'react';
import {
  Container,
  Typography,
  Box,
  Card,
  CardContent,
  TextField,
  Button,
  CircularProgress,
  Snackbar,
  Alert,
} from '@mui/material';
import { Download as DownloadIcon } from '@mui/icons-material';
import { prepareVideoDownload, getVideoStreamUrl, ApiError } from '../services/api';

const SUPPORTED_PLATFORMS = 'YouTube, X (Twitter), Instagram, TikTok, Facebook';

function mapErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 400) return 'Unsupported platform. Please paste a YouTube, X, Instagram, TikTok, or Facebook URL.';
    if (err.status === 422) return err.message || 'Video is unavailable or private.';
    return err.message || 'Could not fetch video. Try a different URL.';
  }
  return err instanceof Error ? err.message : 'Could not fetch video. Try a different URL.';
}

export default function VideoDownloaderPage() {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [successInfo, setSuccessInfo] = useState<{ filename: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleDownload = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    setIsLoading(true);
    setSuccessInfo(null);
    setErrorMessage(null);

    try {
      const { token, filename } = await prepareVideoDownload(trimmed);
      setSuccessInfo({ filename });
      window.location.href = getVideoStreamUrl(token);
    } catch (err) {
      setErrorMessage(mapErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [url]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' && !isLoading && url.trim()) {
        handleDownload();
      }
    },
    [handleDownload, isLoading, url],
  );

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" gutterBottom>
          Video Downloader
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Supported platforms: {SUPPORTED_PLATFORMS}
        </Typography>
      </Box>

      <Card>
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            fullWidth
            label="Video URL"
            placeholder="Paste a YouTube, X, Instagram, TikTok or Facebook URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            autoComplete="off"
            inputProps={{ 'aria-label': 'Video URL' }}
          />

          <Button
            variant="contained"
            size="large"
            startIcon={isLoading ? <CircularProgress size={20} color="inherit" /> : <DownloadIcon />}
            onClick={handleDownload}
            disabled={isLoading || !url.trim()}
            aria-label="Download video"
          >
            {isLoading ? 'Preparing…' : 'Download'}
          </Button>

          {successInfo && (
            <Alert severity="success" onClose={() => setSuccessInfo(null)}>
              Starting download: <strong>{successInfo.filename}</strong>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Snackbar
        open={!!errorMessage}
        autoHideDuration={8000}
        onClose={() => setErrorMessage(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setErrorMessage(null)} sx={{ width: '100%' }}>
          {errorMessage}
        </Alert>
      </Snackbar>
    </Container>
  );
}
