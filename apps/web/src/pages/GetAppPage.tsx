import { useEffect, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  CircularProgress,
  Alert,
  Divider,
  List,
  ListItem,
  ListItemText,
  useTheme,
} from '@mui/material';
import AndroidIcon from '@mui/icons-material/Android';
import DownloadIcon from '@mui/icons-material/Download';

interface AndroidVersionInfo {
  versionName: string;
  versionCode: number;
  updatedAt: string;
  fileName: string;
  sizeBytes?: number;
}

type PageState =
  | { status: 'loading' }
  | { status: 'ready'; info: AndroidVersionInfo }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function GetAppPage() {
  const theme = useTheme();
  const [state, setState] = useState<PageState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    fetch('/api/app/android/version', { signal: controller.signal })
      .then(async (res) => {
        if (res.status === 404) {
          setState({ status: 'unavailable' });
          return;
        }
        if (!res.ok) {
          const text = await res.text().catch(() => 'Unknown error');
          setState({ status: 'error', message: text });
          return;
        }
        const data: AndroidVersionInfo = await res.json();
        setState({ status: 'ready', info: data });
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setState({ status: 'error', message: 'Failed to load version information.' });
      });

    return () => controller.abort();
  }, []);

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.palette.background.default,
        p: 2,
      }}
    >
      <Card
        sx={{
          maxWidth: 440,
          width: '100%',
          boxShadow: theme.shadows[6],
        }}
      >
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          {/* Header */}
          <Box sx={{ textAlign: 'center', mb: 3 }}>
            <AndroidIcon
              sx={{
                fontSize: 56,
                color: theme.palette.success.main,
                mb: 1,
              }}
            />
            <Typography variant="h5" component="h1" fontWeight="bold">
              Sink for Android
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Download the Android app to your device
            </Typography>
          </Box>

          <Divider sx={{ mb: 3 }} />

          {/* Content based on state */}
          {state.status === 'loading' && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress />
            </Box>
          )}

          {state.status === 'error' && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {state.message}
            </Alert>
          )}

          {state.status === 'unavailable' && (
            <Alert severity="info">
              No APK available yet. Check back soon.
            </Alert>
          )}

          {state.status === 'ready' && (
            <>
              {/* Version info */}
              <Box
                sx={{
                  backgroundColor: theme.palette.action.hover,
                  borderRadius: 1,
                  px: 2,
                  py: 1.5,
                  mb: 3,
                }}
              >
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Current version
                </Typography>
                <Typography variant="h6" fontWeight="medium">
                  {state.info.versionName}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  Updated {formatDate(state.info.updatedAt)}
                  {state.info.sizeBytes != null && (
                    <> &middot; {formatBytes(state.info.sizeBytes)}</>
                  )}
                </Typography>
              </Box>

              {/* Download button */}
              <Button
                variant="contained"
                size="large"
                fullWidth
                href="/api/app/android"
                startIcon={<DownloadIcon />}
                sx={{ mb: 3, py: 1.5 }}
              >
                Download APK
              </Button>

              {/* Installation instructions */}
              <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                Installation instructions
              </Typography>
              <List dense disablePadding>
                {[
                  'Tap "Download APK" above.',
                  'When prompted, allow installation from this source in your device settings.',
                  'Open the downloaded file and follow the on-screen steps to install.',
                ].map((step, index) => (
                  <ListItem key={index} disableGutters sx={{ alignItems: 'flex-start', py: 0.25 }}>
                    <ListItemText
                      primary={
                        <Typography variant="body2" color="text.secondary">
                          <Box component="span" fontWeight="bold" sx={{ mr: 1 }}>
                            {index + 1}.
                          </Box>
                          {step}
                        </Typography>
                      }
                    />
                  </ListItem>
                ))}
              </List>
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
