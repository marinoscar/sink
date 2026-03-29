import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { render, mockUser } from '../utils/test-utils';
import MessagesPage from '../../pages/MessagesPage';
import { server } from '../mocks/server';

// ---------------------------------------------------------------------------
// Mock data helpers
// ---------------------------------------------------------------------------

function makeMockMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    sender: '+15559876543',
    body: 'Hello, world!',
    smsTimestamp: '2024-06-01T10:00:00.000Z',
    receivedAt: '2024-06-01T10:00:01.000Z',
    simSlotIndex: 0,
    carrierName: 'T-Mobile',
    device: { id: 'device-1', name: 'My Phone' },
    ...overrides,
  };
}

function makePaginatedResponse(items: unknown[] = [], total = 0) {
  return {
    data: {
      items,
      total,
      page: 1,
      pageSize: 25,
      totalPages: Math.ceil(total / 25) || 1,
    },
  };
}

// ---------------------------------------------------------------------------
// Shared MSW handler helpers
// ---------------------------------------------------------------------------

function setMessagesHandler(items: unknown[] = [], total = 0) {
  server.use(
    http.get('*/api/device-text-messages', () => {
      return HttpResponse.json(makePaginatedResponse(items, total));
    }),
  );
}

function setSendersHandler(senders: string[] = []) {
  server.use(
    http.get('*/api/device-text-messages/senders', () => {
      return HttpResponse.json({ data: senders });
    }),
  );
}

function setDevicesHandler(devices: unknown[] = []) {
  server.use(
    http.get('*/api/device-text-messages/devices', () => {
      return HttpResponse.json({ data: devices });
    }),
  );
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

describe('MessagesPage', () => {
  beforeEach(() => {
    // Default handlers return empty results
    setMessagesHandler();
    setSendersHandler();
    setDevicesHandler();
  });

  describe('Rendering', () => {
    it('should render the page heading', async () => {
      render(<MessagesPage />, {
        wrapperOptions: { authenticated: true, user: mockUser },
      });

      expect(screen.getByRole('heading', { name: /messages/i })).toBeInTheDocument();
    });

    it('should show a loading indicator while fetching messages', async () => {
      // Delay the response to observe the loading state
      server.use(
        http.get('*/api/device-text-messages', async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return HttpResponse.json(makePaginatedResponse());
        }),
      );

      render(<MessagesPage />, {
        wrapperOptions: { authenticated: true, user: mockUser },
      });

      expect(screen.getByRole('progressbar')).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      });
    });

    it('should display "No messages found" when there are no results', async () => {
      setMessagesHandler([], 0);

      render(<MessagesPage />, {
        wrapperOptions: { authenticated: true, user: mockUser },
      });

      await waitFor(() => {
        expect(screen.getByText(/no messages found/i)).toBeInTheDocument();
      });
    });

    it('should display an error message when the API call fails', async () => {
      server.use(
        http.get('*/api/device-text-messages', () => {
          return HttpResponse.error();
        }),
      );

      render(<MessagesPage />, {
        wrapperOptions: { authenticated: true, user: mockUser },
      });

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });

    it('should render the filters toolbar', async () => {
      render(<MessagesPage />, {
        wrapperOptions: { authenticated: true, user: mockUser },
      });

      // The toolbar shows a "Filters" label
      await waitFor(() => {
        expect(screen.getByText(/^filters$/i)).toBeInTheDocument();
      });
    });
  });

  describe('Message list', () => {
    it('should render message rows with correct columns', async () => {
      const message = makeMockMessage();
      setMessagesHandler([message], 1);

      render(<MessagesPage />, {
        wrapperOptions: { authenticated: true, user: mockUser },
      });

      await waitFor(() => {
        // Table should show sender, body, and device name
        expect(screen.getByText(message.sender)).toBeInTheDocument();
        expect(screen.getByText(message.body)).toBeInTheDocument();
        expect(screen.getByText(message.device.name)).toBeInTheDocument();
      });
    });

    it('should show the carrier name in the SIM column', async () => {
      const message = makeMockMessage({ carrierName: 'Verizon' });
      setMessagesHandler([message], 1);

      render(<MessagesPage />, {
        wrapperOptions: { authenticated: true, user: mockUser },
      });

      await waitFor(() => {
        expect(screen.getByText('Verizon')).toBeInTheDocument();
      });
    });

    it('should truncate long message bodies with a "more" link', async () => {
      const longBody = 'A'.repeat(150);
      const message = makeMockMessage({ body: longBody });
      setMessagesHandler([message], 1);

      render(<MessagesPage />, {
        wrapperOptions: { authenticated: true, user: mockUser },
      });

      await waitFor(() => {
        expect(screen.getByText(/more/i)).toBeInTheDocument();
      });
    });
  });

  describe('Date filter presets', () => {
    it('should render all date preset buttons', async () => {
      render(<MessagesPage />, {
        wrapperOptions: { authenticated: true, user: mockUser },
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /all time/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^today$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /this week/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /this month/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /custom range/i })).toBeInTheDocument();
      });
    });

    it('should re-fetch messages when a date preset is clicked', async () => {
      const fetchSpy = vi.fn().mockImplementation(() =>
        Promise.resolve(makePaginatedResponse()),
      );

      server.use(
        http.get('*/api/device-text-messages', () => {
          fetchSpy();
          return HttpResponse.json(makePaginatedResponse());
        }),
      );

      render(<MessagesPage />, {
        wrapperOptions: { authenticated: true, user: mockUser },
      });

      // Wait for initial fetch
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /^today$/i }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    });

    it('should show custom date inputs when "Custom" preset is selected', async () => {
      render(<MessagesPage />, {
        wrapperOptions: { authenticated: true, user: mockUser },
      });

      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /custom range/i }));

      await waitFor(() => {
        expect(screen.getByLabelText(/^from$/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/^to$/i)).toBeInTheDocument();
      });
    });
  });

  describe('Pagination', () => {
    it('should render pagination controls when there are messages', async () => {
      const messages = Array.from({ length: 5 }, (_, i) =>
        makeMockMessage({ id: `msg-${i}`, sender: `+1555000000${i}` }),
      );
      setMessagesHandler(messages, 5);

      render(<MessagesPage />, {
        wrapperOptions: { authenticated: true, user: mockUser },
      });

      await waitFor(() => {
        // MUI TablePagination renders rows-per-page selector
        expect(screen.getByText(/rows per page/i)).toBeInTheDocument();
      });
    });
  });
});
