import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
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
      expect(screen.getByRole('button', { name: /download video/i })).toBeDisabled();
    });

    it('shows supported platforms text', () => {
      renderPage();
      expect(screen.getByText(/supported platforms/i)).toBeInTheDocument();
    });

    it('renders the Reset button', () => {
      renderPage();
      expect(screen.getByRole('button', { name: /reset form/i })).toBeInTheDocument();
    });

    it('Reset button is disabled when form is empty and no state', () => {
      renderPage();
      expect(screen.getByRole('button', { name: /reset form/i })).toBeDisabled();
    });
  });

  // =========================================================================
  // 2. Typing enables the button
  // =========================================================================

  describe('URL input interaction', () => {
    it('enables the Download button once a valid URL is typed', async () => {
      const user = userEvent.setup();
      renderPage();

      const input = screen.getByLabelText(/video url/i);
      await user.type(input, YOUTUBE_URL);

      expect(screen.getByRole('button', { name: /download video/i })).toBeEnabled();
    });

    it('keeps button disabled when input contains only whitespace', async () => {
      const user = userEvent.setup();
      renderPage();

      const input = screen.getByLabelText(/video url/i);
      await user.type(input, '   ');

      expect(screen.getByRole('button', { name: /download video/i })).toBeDisabled();
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
      await user.click(screen.getByRole('button', { name: /download video/i }));

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
      await user.click(screen.getByRole('button', { name: /download video/i }));

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
      await user.click(screen.getByRole('button', { name: /download video/i }));

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
      await user.click(screen.getByRole('button', { name: /download video/i }));

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
      await user.click(screen.getByRole('button', { name: /download video/i }));

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
      await user.click(screen.getByRole('button', { name: /download video/i }));

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

  // =========================================================================
  // 8. Inline URL validation
  // =========================================================================

  describe('Inline URL validation', () => {
    it('shows helper text and disables Download when input is not a valid URL', async () => {
      const user = userEvent.setup();
      renderPage();

      const input = screen.getByLabelText(/video url/i);
      await user.type(input, 'not a url');

      expect(screen.getByText(/enter a valid http\(s\) url/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /download video/i })).toBeDisabled();
    });

    it('shows helper text and disables Download for an ftp:// URL', async () => {
      const user = userEvent.setup();
      renderPage();

      const input = screen.getByLabelText(/video url/i);
      await user.type(input, 'ftp://example.com/video.mp4');

      expect(screen.getByText(/enter a valid http\(s\) url/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /download video/i })).toBeDisabled();
    });

    it('clears the error and enables Download when a valid https:// URL is entered', async () => {
      const user = userEvent.setup();
      renderPage();

      const input = screen.getByLabelText(/video url/i);
      await user.type(input, 'not a url');

      // Error should be showing
      expect(screen.getByText(/enter a valid http\(s\) url/i)).toBeInTheDocument();

      // Clear and type a valid URL
      await user.clear(input);
      await user.type(input, YOUTUBE_URL);

      expect(screen.queryByText(/enter a valid http\(s\) url/i)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /download video/i })).toBeEnabled();
    });

    it('shows no error when input is empty', async () => {
      renderPage();
      expect(screen.queryByText(/enter a valid http\(s\) url/i)).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // 9. Auto-reset after successful download
  // =========================================================================

  describe('Auto-reset after success', () => {
    it('clears input and success state after 10 seconds following a successful download', async () => {
      // Use fake timers but configure them to also advance async microtasks
      vi.useFakeTimers();

      // Resolve immediately so the async path completes synchronously
      let resolveApi!: (v: { token: string; filename: string; sizeBytes: number }) => void;
      const apiPromise = new Promise<{ token: string; filename: string; sizeBytes: number }>(
        (r) => { resolveApi = r; },
      );
      mockPrepareVideoDownload.mockReturnValue(apiPromise);
      mockGetVideoStreamUrl.mockReturnValue('/api/video/download/stream?token=auto-tok');

      renderPage();

      const input = screen.getByLabelText(/video url/i);
      fireEvent.change(input, { target: { value: YOUTUBE_URL } });
      fireEvent.click(screen.getByRole('button', { name: /download video/i }));

      // Resolve the API call and flush microtasks inside act
      await act(async () => {
        resolveApi({ token: 'auto-tok', filename: 'Auto Reset Video.mp4', sizeBytes: 1000 });
      });

      // Success alert should now be visible (real DOM check, no timer needed)
      expect(screen.getByText(/auto reset video\.mp4/i)).toBeInTheDocument();

      // Advance fake clock by 10 seconds to trigger the auto-reset setTimeout
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });

      // Input should be cleared and success alert should be gone
      expect(screen.queryByText(/auto reset video\.mp4/i)).not.toBeInTheDocument();
      expect((screen.getByLabelText(/video url/i) as HTMLInputElement).value).toBe('');

      vi.useRealTimers();
    });
  });

  // =========================================================================
  // 10. Manual Reset button
  // =========================================================================

  describe('Manual Reset button', () => {
    it('clears the input, success state, and cancels auto-reset when Reset is clicked', async () => {
      vi.useFakeTimers();

      let resolveApi!: (v: { token: string; filename: string; sizeBytes: number }) => void;
      const apiPromise = new Promise<{ token: string; filename: string; sizeBytes: number }>(
        (r) => { resolveApi = r; },
      );
      mockPrepareVideoDownload.mockReturnValue(apiPromise);
      mockGetVideoStreamUrl.mockReturnValue('/api/video/download/stream?token=reset-tok');

      renderPage();

      const input = screen.getByLabelText(/video url/i);
      fireEvent.change(input, { target: { value: YOUTUBE_URL } });
      fireEvent.click(screen.getByRole('button', { name: /download video/i }));

      // Resolve API and flush
      await act(async () => {
        resolveApi({ token: 'reset-tok', filename: 'Reset Test Video.mp4', sizeBytes: 1000 });
      });

      // Success alert visible
      expect(screen.getByText(/reset test video\.mp4/i)).toBeInTheDocument();

      // Click Reset — this should cancel the pending auto-reset timer
      fireEvent.click(screen.getByRole('button', { name: /reset form/i }));

      // Input cleared, success gone immediately
      expect((screen.getByLabelText(/video url/i) as HTMLInputElement).value).toBe('');
      expect(screen.queryByText(/reset test video\.mp4/i)).not.toBeInTheDocument();

      // Advancing the timer should NOT re-trigger a reset (it was cancelled)
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });

      // Still empty, still no success
      expect(screen.queryByText(/reset test video\.mp4/i)).not.toBeInTheDocument();
      expect((screen.getByLabelText(/video url/i) as HTMLInputElement).value).toBe('');

      vi.useRealTimers();
    });

    it('Reset button is enabled when there is an error message', async () => {
      const user = userEvent.setup();
      mockPrepareVideoDownload.mockRejectedValue(
        new ApiError('Something went wrong.', 500),
      );

      renderPage();

      await user.type(screen.getByLabelText(/video url/i), YOUTUBE_URL);
      await user.click(screen.getByRole('button', { name: /download video/i }));

      await waitFor(() => {
        expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
      });

      // After error, Reset should be enabled (input has content)
      expect(screen.getByRole('button', { name: /reset form/i })).toBeEnabled();
    });
  });

  // =========================================================================
  // 11. Paste button
  // =========================================================================

  describe('Paste button', () => {
    let readTextSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      // Use vi.fn() so Vitest recognises it as a spy
      readTextSpy = vi.fn().mockResolvedValue('https://youtu.be/abc');
      Object.defineProperty(navigator, 'clipboard', {
        value: { readText: readTextSpy },
        configurable: true,
        writable: true,
      });
    });

    afterEach(() => {
      // Restore clipboard to undefined to clean up between tests
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        configurable: true,
        writable: true,
      });
    });

    it('renders the Paste button when clipboard API is available', () => {
      renderPage();
      expect(screen.getByRole('button', { name: /paste from clipboard/i })).toBeInTheDocument();
    });

    it('clicking Paste calls clipboard.readText and populates the input', async () => {
      renderPage();

      const pasteBtn = screen.getByRole('button', { name: /paste from clipboard/i });
      // fireEvent.click is more reliable for icon buttons inside adornments in jsdom
      fireEvent.click(pasteBtn);

      await waitFor(() => {
        expect(readTextSpy).toHaveBeenCalled();
        expect((screen.getByLabelText(/video url/i) as HTMLInputElement).value).toBe(
          'https://youtu.be/abc',
        );
      });
    });

    it('shows a warning Snackbar when clipboard.readText rejects', async () => {
      const user = userEvent.setup();
      // Override to reject
      const failSpy = vi.fn().mockRejectedValue(new Error('Permission denied'));
      Object.defineProperty(navigator, 'clipboard', {
        value: { readText: failSpy },
        configurable: true,
        writable: true,
      });

      renderPage();

      const pasteBtn = screen.getByRole('button', { name: /paste from clipboard/i });
      await user.click(pasteBtn);

      await waitFor(() => {
        expect(screen.getByText(/could not read clipboard/i)).toBeInTheDocument();
      });
    });

    it('shows a warning Snackbar when clipboard.readText returns empty string', async () => {
      const user = userEvent.setup();
      const emptySpy = vi.fn().mockResolvedValue('');
      Object.defineProperty(navigator, 'clipboard', {
        value: { readText: emptySpy },
        configurable: true,
        writable: true,
      });

      renderPage();

      const pasteBtn = screen.getByRole('button', { name: /paste from clipboard/i });
      await user.click(pasteBtn);

      await waitFor(() => {
        expect(screen.getByText(/could not read clipboard/i)).toBeInTheDocument();
      });
    });
  });
});
