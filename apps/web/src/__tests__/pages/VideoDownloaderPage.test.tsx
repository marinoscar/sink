import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../utils/test-utils';
import VideoDownloaderPage from '../../pages/VideoDownloaderPage';
import { ApiError } from '../../services/api';

// ---------------------------------------------------------------------------
// Mock the API module
// ---------------------------------------------------------------------------

vi.mock('../../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/api')>();
  return {
    ...actual,
    prepareVideoDownload: vi.fn(),
    getVideoStreamUrl: vi.fn((token: string) => `/api/video/download/stream?token=${token}`),
  };
});

import { prepareVideoDownload, getVideoStreamUrl } from '../../services/api';

const mockPrepareVideoDownload = vi.mocked(prepareVideoDownload);
const mockGetVideoStreamUrl = vi.mocked(getVideoStreamUrl);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPage() {
  return render(<VideoDownloaderPage />, {
    wrapperOptions: { authenticated: true },
  });
}

const YOUTUBE_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VideoDownloaderPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset window.location.href between tests (it is writable per setup.ts)
    window.location.href = 'http://localhost:3000';
  });

  // =========================================================================
  // 1. Initial render
  // =========================================================================

  describe('Initial render', () => {
    it('renders the URL input field', () => {
      renderPage();
      expect(screen.getByLabelText(/video url/i)).toBeInTheDocument();
    });

    it('renders the Download button', () => {
      renderPage();
      expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument();
    });

    it('Download button is disabled when URL is empty', () => {
      renderPage();
      expect(screen.getByRole('button', { name: /download/i })).toBeDisabled();
    });

    it('shows supported platforms text', () => {
      renderPage();
      expect(screen.getByText(/supported platforms/i)).toBeInTheDocument();
    });
  });

  // =========================================================================
  // 2. Typing enables the button
  // =========================================================================

  describe('URL input interaction', () => {
    it('enables the Download button once a URL is typed', async () => {
      const user = userEvent.setup();
      renderPage();

      const input = screen.getByLabelText(/video url/i);
      await user.type(input, YOUTUBE_URL);

      expect(screen.getByRole('button', { name: /download/i })).toBeEnabled();
    });

    it('keeps button disabled when input contains only whitespace', async () => {
      const user = userEvent.setup();
      renderPage();

      const input = screen.getByLabelText(/video url/i);
      await user.type(input, '   ');

      expect(screen.getByRole('button', { name: /download/i })).toBeDisabled();
    });
  });

  // =========================================================================
  // 3. Successful submit – calls API and navigates
  // =========================================================================

  describe('Successful download flow', () => {
    it('calls prepareVideoDownload with the trimmed URL and redirects to the stream URL', async () => {
      const user = userEvent.setup();
      const mockToken = 'signed-jwt-token-abc123';
      const mockFilename = 'My Video.mp4';
      const mockStreamUrl = `/api/video/download/stream?token=${mockToken}`;

      mockPrepareVideoDownload.mockResolvedValue({
        token: mockToken,
        filename: mockFilename,
        sizeBytes: 12345678,
      });
      mockGetVideoStreamUrl.mockReturnValue(mockStreamUrl);

      renderPage();

      const input = screen.getByLabelText(/video url/i);
      await user.type(input, `  ${YOUTUBE_URL}  `);
      await user.click(screen.getByRole('button', { name: /download/i }));

      await waitFor(() => {
        expect(mockPrepareVideoDownload).toHaveBeenCalledWith(YOUTUBE_URL);
      });

      await waitFor(() => {
        expect(mockGetVideoStreamUrl).toHaveBeenCalledWith(mockToken);
        expect(window.location.href).toBe(mockStreamUrl);
      });
    });

    it('shows a success alert with the filename after prepare resolves', async () => {
      const user = userEvent.setup();
      mockPrepareVideoDownload.mockResolvedValue({
        token: 'tok',
        filename: 'Awesome Clip.mp4',
        sizeBytes: 5000,
      });
      mockGetVideoStreamUrl.mockReturnValue('/api/video/download/stream?token=tok');

      renderPage();

      await user.type(screen.getByLabelText(/video url/i), YOUTUBE_URL);
      await user.click(screen.getByRole('button', { name: /download/i }));

      await waitFor(() => {
        expect(screen.getByText(/awesome clip\.mp4/i)).toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // 4. Error handling – 400 (unsupported platform)
  // =========================================================================

  describe('Error handling – 400 Bad Request', () => {
    it('shows the platform error message in a Snackbar Alert', async () => {
      const user = userEvent.setup();
      mockPrepareVideoDownload.mockRejectedValue(
        new ApiError('Unsupported platform.', 400),
      );

      renderPage();

      await user.type(screen.getByLabelText(/video url/i), 'https://evil.com/foo');
      await user.click(screen.getByRole('button', { name: /download/i }));

      await waitFor(() => {
        expect(
          screen.getByText(/unsupported platform/i),
        ).toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // 5. Error handling – 422 (unavailable/private)
  // =========================================================================

  describe('Error handling – 422 Unprocessable Entity', () => {
    it('shows the error.message from the ApiError', async () => {
      const user = userEvent.setup();
      mockPrepareVideoDownload.mockRejectedValue(
        new ApiError('Private video. Sign in if you have been granted access.', 422),
      );

      renderPage();

      await user.type(screen.getByLabelText(/video url/i), YOUTUBE_URL);
      await user.click(screen.getByRole('button', { name: /download/i }));

      await waitFor(() => {
        expect(
          screen.getByText(/private video/i),
        ).toBeInTheDocument();
      });
    });

    it('falls back to generic message when 422 ApiError has no message', async () => {
      const user = userEvent.setup();
      mockPrepareVideoDownload.mockRejectedValue(
        new ApiError('', 422),
      );

      renderPage();

      await user.type(screen.getByLabelText(/video url/i), YOUTUBE_URL);
      await user.click(screen.getByRole('button', { name: /download/i }));

      await waitFor(() => {
        expect(
          screen.getByText(/video is unavailable or private/i),
        ).toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // 6. Enter key submits the form
  // =========================================================================

  describe('Enter key submission', () => {
    it('submits when Enter is pressed inside the text field', async () => {
      const user = userEvent.setup();
      mockPrepareVideoDownload.mockResolvedValue({
        token: 'enter-tok',
        filename: 'Enter Key Video.mp4',
      });
      mockGetVideoStreamUrl.mockReturnValue('/api/video/download/stream?token=enter-tok');

      renderPage();

      const input = screen.getByLabelText(/video url/i);
      await user.type(input, YOUTUBE_URL);
      await user.keyboard('{Enter}');

      await waitFor(() => {
        expect(mockPrepareVideoDownload).toHaveBeenCalledWith(YOUTUBE_URL);
      });
    });

    it('does not submit when Enter is pressed on an empty field', async () => {
      const user = userEvent.setup();
      renderPage();

      const input = screen.getByLabelText(/video url/i);
      await user.click(input);
      await user.keyboard('{Enter}');

      expect(mockPrepareVideoDownload).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 7. Loading state
  // =========================================================================

  describe('Loading state', () => {
    it('disables the button while the request is in flight', async () => {
      const user = userEvent.setup();

      // Resolve only after the test has checked the disabled state
      let resolveDownload!: (value: { token: string; filename: string }) => void;
      mockPrepareVideoDownload.mockReturnValue(
        new Promise<{ token: string; filename: string }>((r) => { resolveDownload = r; }),
      );

      renderPage();

      await user.type(screen.getByLabelText(/video url/i), YOUTUBE_URL);
      await user.click(screen.getByRole('button', { name: /download/i }));

      // While the promise is pending, button should be disabled and show a spinner
      await waitFor(() => {
        const btn = screen.getByRole('button', { name: /download video/i });
        expect(btn).toBeDisabled();
        // The spinner (CircularProgress) is rendered inside the button during loading
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
      });

      // Finish the request
      mockGetVideoStreamUrl.mockReturnValue('/api/video/stream?token=x');
      resolveDownload({ token: 'x', filename: 'v.mp4' });
    });
  });
});
