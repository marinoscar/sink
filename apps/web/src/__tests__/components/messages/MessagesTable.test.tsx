import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import { MessagesTable } from '../../../components/messages/MessagesTable';
import type { SmsMessageItem } from '../../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<SmsMessageItem> = {}): SmsMessageItem {
  return {
    id: 'msg-1',
    sender: '+15559876543',
    body: 'Test message body',
    smsTimestamp: '2024-06-01T10:00:00.000Z',
    receivedAt: '2024-06-01T10:00:01.000Z',
    simSlotIndex: 0,
    carrierName: 'T-Mobile',
    device: { id: 'device-1', name: 'My Phone' },
    ...overrides,
  };
}

const defaultProps = {
  messages: [] as SmsMessageItem[],
  total: 0,
  page: 1,
  pageSize: 25,
  isLoading: false,
  error: null,
  onPageChange: vi.fn(),
  onPageSizeChange: vi.fn(),
};

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

describe('MessagesTable', () => {
  describe('Loading state', () => {
    it('should show a spinner when isLoading is true', () => {
      render(<MessagesTable {...defaultProps} isLoading={true} />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('should not render the table while loading', () => {
      render(<MessagesTable {...defaultProps} isLoading={true} />);

      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  describe('Error state', () => {
    it('should display the error message as an alert', () => {
      render(
        <MessagesTable {...defaultProps} error="Network request failed" />,
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/network request failed/i)).toBeInTheDocument();
    });

    it('should not render the table when error is present', () => {
      render(<MessagesTable {...defaultProps} error="Something went wrong" />);

      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('should show "No messages found" when messages array is empty', () => {
      render(<MessagesTable {...defaultProps} messages={[]} />);

      expect(screen.getByText(/no messages found/i)).toBeInTheDocument();
    });

    it('should not render a table when messages array is empty', () => {
      render(<MessagesTable {...defaultProps} messages={[]} />);

      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  describe('Column headers', () => {
    it('should render all expected column headers', () => {
      render(
        <MessagesTable
          {...defaultProps}
          messages={[makeMessage()]}
          total={1}
        />,
      );

      expect(screen.getByText(/date \/ time/i)).toBeInTheDocument();
      expect(screen.getByText(/^sender$/i)).toBeInTheDocument();
      expect(screen.getByText(/^message$/i)).toBeInTheDocument();
      expect(screen.getByText(/^device$/i)).toBeInTheDocument();
      expect(screen.getByText(/^sim$/i)).toBeInTheDocument();
    });
  });

  describe('Message rows', () => {
    it('should render a row for each message', () => {
      const messages = [
        makeMessage({ id: 'msg-1', sender: '+15551111111' }),
        makeMessage({ id: 'msg-2', sender: '+15552222222' }),
      ];

      render(
        <MessagesTable {...defaultProps} messages={messages} total={2} />,
      );

      expect(screen.getByText('+15551111111')).toBeInTheDocument();
      expect(screen.getByText('+15552222222')).toBeInTheDocument();
    });

    it('should display the sender in the Sender column', () => {
      const message = makeMessage({ sender: '+15559999999' });

      render(
        <MessagesTable {...defaultProps} messages={[message]} total={1} />,
      );

      expect(screen.getByText('+15559999999')).toBeInTheDocument();
    });

    it('should display the message body', () => {
      const message = makeMessage({ body: 'Hello from the test' });

      render(
        <MessagesTable {...defaultProps} messages={[message]} total={1} />,
      );

      expect(screen.getByText('Hello from the test')).toBeInTheDocument();
    });

    it('should display the device name', () => {
      const message = makeMessage({
        device: { id: 'dev-42', name: 'Pixel 7 Pro' },
      });

      render(
        <MessagesTable {...defaultProps} messages={[message]} total={1} />,
      );

      expect(screen.getByText('Pixel 7 Pro')).toBeInTheDocument();
    });

    it('should show carrier name in the SIM column when available', () => {
      const message = makeMessage({ carrierName: 'AT&T', simSlotIndex: 0 });

      render(
        <MessagesTable {...defaultProps} messages={[message]} total={1} />,
      );

      expect(screen.getByText('AT&T')).toBeInTheDocument();
    });

    it('should show SIM slot index when carrier name is absent', () => {
      const message = makeMessage({ carrierName: null, simSlotIndex: 1 });

      render(
        <MessagesTable {...defaultProps} messages={[message]} total={1} />,
      );

      // simSlotIndex 1 → "SIM 2" (0-indexed display + 1)
      expect(screen.getByText(/sim 2/i)).toBeInTheDocument();
    });

    it('should show a dash when both carrierName and simSlotIndex are absent', () => {
      const message = makeMessage({ carrierName: null, simSlotIndex: null });

      render(
        <MessagesTable {...defaultProps} messages={[message]} total={1} />,
      );

      expect(screen.getByText('—')).toBeInTheDocument();
    });
  });

  describe('Long message body', () => {
    it('should truncate body over 100 characters and show a "more" link', () => {
      const longBody = 'B'.repeat(150);
      const message = makeMessage({ body: longBody });

      render(
        <MessagesTable {...defaultProps} messages={[message]} total={1} />,
      );

      expect(screen.getByText(/more/i)).toBeInTheDocument();
    });

    it('should expand the full body when clicking "more"', async () => {
      const longBody = 'C'.repeat(150);
      const message = makeMessage({ body: longBody });

      render(
        <MessagesTable {...defaultProps} messages={[message]} total={1} />,
      );

      const moreLink = screen.getByText(/more/i);
      fireEvent.click(moreLink);

      await waitFor(() => {
        expect(screen.getByText(/show less/i)).toBeInTheDocument();
      });
    });

    it('should collapse again when clicking "show less"', async () => {
      const longBody = 'D'.repeat(150);
      const message = makeMessage({ body: longBody });

      render(
        <MessagesTable {...defaultProps} messages={[message]} total={1} />,
      );

      fireEvent.click(screen.getByText(/more/i));
      await waitFor(() => screen.getByText(/show less/i));

      fireEvent.click(screen.getByText(/show less/i));
      await waitFor(() => {
        expect(screen.getByText(/more/i)).toBeInTheDocument();
        expect(screen.queryByText(/show less/i)).not.toBeInTheDocument();
      });
    });

    it('should not show a "more" link for short bodies', () => {
      const shortBody = 'Short message';
      const message = makeMessage({ body: shortBody });

      render(
        <MessagesTable {...defaultProps} messages={[message]} total={1} />,
      );

      expect(screen.queryByText(/more/i)).not.toBeInTheDocument();
    });
  });

  describe('Pagination', () => {
    it('should render TablePagination with the correct total count', () => {
      const messages = [makeMessage()];

      render(
        <MessagesTable {...defaultProps} messages={messages} total={42} />,
      );

      // MUI TablePagination shows "X–Y of <total>"; match just the total
      expect(screen.getByText(/of 42/i)).toBeInTheDocument();
    });

    it('should call onPageChange when the next-page button is clicked', async () => {
      const onPageChange = vi.fn();
      const messages = Array.from({ length: 25 }, (_, i) =>
        makeMessage({ id: `msg-${i}`, sender: `+1555000${i.toString().padStart(4, '0')}` }),
      );

      render(
        <MessagesTable
          {...defaultProps}
          messages={messages}
          total={50}
          onPageChange={onPageChange}
        />,
      );

      const nextButton = screen.getByRole('button', { name: /go to next page/i });
      fireEvent.click(nextButton);

      await waitFor(() => {
        // Page 1 → 2; handler receives 1-based page number so page 0 MUI + 1 = 1, but
        // the component translates MUI's 0-based index: onPageChange(newPage + 1)
        // So clicking from page 0 gives newPage=1, callback receives 2
        expect(onPageChange).toHaveBeenCalledWith(2);
      });
    });

    it('should render the rows-per-page label in the pagination bar', () => {
      const messages = [makeMessage()];

      render(
        <MessagesTable
          {...defaultProps}
          messages={messages}
          total={100}
          pageSize={25}
          onPageSizeChange={vi.fn()}
        />,
      );

      // MUI TablePagination always renders the "Rows per page:" label
      expect(screen.getByText(/rows per page/i)).toBeInTheDocument();
    });
  });
});
