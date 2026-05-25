import { useState, useCallback, useEffect, useRef, KeyboardEvent } from 'react';
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
  Stack,
  InputAdornment,
  IconButton,
} from '@mui/material';
import { Download as DownloadIcon } from '@mui/icons-material';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import { prepareVideoDownload, getVideoStreamUrl, ApiError } from '../services/api';

const SUPPORTED_PLATFORMS = 'YouTube, X (Twitter), Instagram, TikTok, Facebook';

const AUTO_RESET_DELAY_MS = 10_000;

/** Returns true if the browser exposes the async Clipboard API. */
const hasClipboardApi = (): boolean =>
  typeof navigator !== 'undefined' &&
  navigator.clipboard != null &&
  typeof navigator.clipboard.readText === 'function';

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

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
  const [pasteError, setPasteError] = useState<string | null>(null);

  const autoResetTimerRef = useRef<number | null>(null);
  const clipboardAvailable = hasClipboardApi();

  // Derived URL validity: only flag error when non-empty and invalid
  const trimmedUrl = url.trim();
  const urlIsInvalid = trimmedUrl.length > 0 && !isValidUrl(trimmedUrl);
  const downloadDisabled = isLoading || trimmedUrl.length === 0 || urlIsInvalid;

  const cancelAutoReset = useCallback(() => {
    if (autoResetTimerRef.current !== null) {
      clearTimeout(autoResetTimerRef.current);
      autoResetTimerRef.current = null;
    }
  }, []);

  const handleReset = useCallback(() => {
    cancelAutoReset();
    setUrl('');
    setSuccessInfo(null);
    setErrorMessage(null);
  }, [cancelAutoReset]);

  const scheduleAutoReset = useCallback(
    (delayMs: number) => {
      cancelAutoReset();
      autoResetTimerRef.current = window.setTimeout(() => {
        autoResetTimerRef.current = null;
        setUrl('');
        setSuccessInfo(null);
        setErrorMessage(null);
      }, delayMs);
    },
    [cancelAutoReset],
  );

  // Cancel timer on unmount
  useEffect(() => {
    return () => {
      cancelAutoReset();
    };
  }, [cancelAutoReset]);

  const handleUrlChange = useCallback(
    (value: string) => {
      cancelAutoReset();
      setUrl(value);
    },
    [cancelAutoReset],
  );

  const handleDownload = useCallback(async () => {
    if (!trimmedUrl || urlIsInvalid) return;

    setIsLoading(true);
    setSuccessInfo(null);
    setErrorMessage(null);

    try {
      const { token, filename } = await prepareVideoDownload(trimmedUrl);
      setSuccessInfo({ filename });
      window.location.href = getVideoStreamUrl(token);
      scheduleAutoReset(AUTO_RESET_DELAY_MS);
    } catch (err) {
      setErrorMessage(mapErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [trimmedUrl, urlIsInvalid, scheduleAutoReset]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' && !downloadDisabled) {
        handleDownload();
      }
    },
    [handleDownload, downloadDisabled],
  );

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        setPasteError('Could not read clipboard');
        return;
      }
      cancelAutoReset();
      setUrl(text);
    } catch {
      setPasteError('Could not read clipboard');
    }
  }, [cancelAutoReset]);

  const resetDisabled = trimmedUrl.length === 0 && !successInfo && !errorMessage;

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
            onChange={(e) => handleUrlChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            autoComplete="off"
            inputProps={{ 'aria-label': 'Video URL' }}
            error={urlIsInvalid}
            helperText={urlIsInvalid ? 'Enter a valid http(s) URL' : undefined}
            InputProps={
              clipboardAvailable
                ? {
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          onClick={handlePaste}
                          disabled={isLoading}
                          aria-label="Paste from clipboard"
                          edge="end"
                          size="small"
                        >
                          <ContentPasteIcon fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ),
                  }
                : undefined
            }
          />

          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button
              variant="outlined"
              size="large"
              startIcon={<RestartAltIcon />}
              onClick={handleReset}
              disabled={resetDisabled}
              aria-label="Reset form"
            >
              Reset
            </Button>

            <Button
              variant="contained"
              size="large"
              startIcon={isLoading ? <CircularProgress size={20} color="inherit" /> : <DownloadIcon />}
              onClick={handleDownload}
              disabled={downloadDisabled}
              aria-label="Download video"
            >
              {isLoading ? 'Preparing…' : 'Download'}
            </Button>
          </Stack>

          {successInfo && (
            <Alert severity="success" onClose={() => { cancelAutoReset(); setSuccessInfo(null); }}>
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

      <Snackbar
        open={!!pasteError}
        autoHideDuration={4000}
        onClose={() => setPasteError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="warning" onClose={() => setPasteError(null)} sx={{ width: '100%' }}>
          {pasteError}
        </Alert>
      </Snackbar>
    </Container>
  );
}
