import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import { MessageDateFilter } from '../../../components/messages/MessageDateFilter';

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

describe('MessageDateFilter', () => {
  let onDateChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onDateChange = vi.fn();
  });

  describe('Rendering', () => {
    it('should render all preset buttons', () => {
      render(<MessageDateFilter onDateChange={onDateChange} />);

      // Buttons use aria-label values from the ToggleButton aria-label prop
      expect(screen.getByRole('button', { name: /all time/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^today$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /this week/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /this month/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /custom range/i })).toBeInTheDocument();
    });

    it('should default to "All" preset selected', () => {
      render(<MessageDateFilter onDateChange={onDateChange} />);

      const allButton = screen.getByRole('button', { name: /all time/i });
      // MUI ToggleButton marks the selected button with aria-pressed="true"
      expect(allButton).toHaveAttribute('aria-pressed', 'true');
    });

    it('should not render custom date inputs by default', () => {
      render(<MessageDateFilter onDateChange={onDateChange} />);

      expect(screen.queryByLabelText(/^from$/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/^to$/i)).not.toBeInTheDocument();
    });
  });

  describe('Preset selection', () => {
    it('should call onDateChange with undefined values when "All" is clicked', async () => {
      const user = userEvent.setup();
      render(<MessageDateFilter onDateChange={onDateChange} />);

      // First click "Today" to deselect "All", then click "All" to trigger the callback
      await user.click(screen.getByRole('button', { name: /^today$/i }));
      await user.click(screen.getByRole('button', { name: /all time/i }));

      expect(onDateChange).toHaveBeenCalledWith(undefined, undefined);
    });

    it('should call onDateChange with today range when "Today" is clicked', async () => {
      const user = userEvent.setup();
      render(<MessageDateFilter onDateChange={onDateChange} />);

      await user.click(screen.getByRole('button', { name: /^today$/i }));

      expect(onDateChange).toHaveBeenCalledTimes(1);
      const [dateFrom, dateTo] = onDateChange.mock.calls[0];
      expect(dateFrom).toBeTruthy();
      expect(dateTo).toBeTruthy();

      // Both from and to should be ISO strings from today
      const fromDate = new Date(dateFrom);
      const toDate = new Date(dateTo);
      const today = new Date();

      expect(fromDate.getFullYear()).toBe(today.getFullYear());
      expect(fromDate.getMonth()).toBe(today.getMonth());
      expect(fromDate.getDate()).toBe(today.getDate());
      expect(toDate.getFullYear()).toBe(today.getFullYear());
      expect(toDate.getMonth()).toBe(today.getMonth());
      expect(toDate.getDate()).toBe(today.getDate());
    });

    it('should call onDateChange when "This Week" is clicked', async () => {
      const user = userEvent.setup();
      render(<MessageDateFilter onDateChange={onDateChange} />);



      await user.click(screen.getByRole('button', { name: /^this week$/i }));

      expect(onDateChange).toHaveBeenCalledTimes(1);
      const [dateFrom, dateTo] = onDateChange.mock.calls[0];
      expect(dateFrom).toBeTruthy();
      expect(dateTo).toBeTruthy();

      // dateFrom should be before dateTo (Monday ≤ now)
      expect(new Date(dateFrom).getTime()).toBeLessThanOrEqual(
        new Date(dateTo).getTime(),
      );
    });

    it('should call onDateChange when "This Month" is clicked', async () => {
      const user = userEvent.setup();
      render(<MessageDateFilter onDateChange={onDateChange} />);

      await user.click(screen.getByRole('button', { name: /^this month$/i }));

      expect(onDateChange).toHaveBeenCalledTimes(1);
      const [dateFrom, dateTo] = onDateChange.mock.calls[0];
      expect(dateFrom).toBeTruthy();
      expect(dateTo).toBeTruthy();

      // dateFrom should be day 1 of the current month
      const fromDate = new Date(dateFrom);
      expect(fromDate.getDate()).toBe(1);
    });

    it('should mark the clicked preset as selected', async () => {
      const user = userEvent.setup();
      render(<MessageDateFilter onDateChange={onDateChange} />);

      await user.click(screen.getByRole('button', { name: /^today$/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^today$/i })).toHaveAttribute(
          'aria-pressed',
          'true',
        );
      });
    });
  });

  describe('Custom date range', () => {
    it('should show From and To inputs when "Custom" is selected', async () => {
      const user = userEvent.setup();
      render(<MessageDateFilter onDateChange={onDateChange} />);

      await user.click(screen.getByRole('button', { name: /custom range/i }));

      await waitFor(() => {
        expect(screen.getByLabelText(/^from$/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/^to$/i)).toBeInTheDocument();
      });
    });

    it('should call onDateChange when From date is changed in custom mode', async () => {
      render(<MessageDateFilter onDateChange={onDateChange} />);

      // Switch to custom mode
      fireEvent.click(screen.getByRole('button', { name: /custom range/i }));

      await waitFor(() => screen.getByLabelText(/^from$/i));

      fireEvent.change(screen.getByLabelText(/^from$/i), {
        target: { value: '2024-06-01' },
      });

      await waitFor(() => {
        // onDateChange should be called — at least once for the preset click,
        // and once more for the date input change
        expect(onDateChange).toHaveBeenCalledTimes(2);
        const lastCall = onDateChange.mock.calls[onDateChange.mock.calls.length - 1];
        expect(lastCall[0]).toContain('2024-06-01');
      });
    });

    it('should call onDateChange when To date is changed in custom mode', async () => {
      render(<MessageDateFilter onDateChange={onDateChange} />);

      fireEvent.click(screen.getByRole('button', { name: /custom range/i }));

      await waitFor(() => screen.getByLabelText(/^to$/i));

      fireEvent.change(screen.getByLabelText(/^to$/i), {
        target: { value: '2024-06-30' },
      });

      await waitFor(() => {
        expect(onDateChange).toHaveBeenCalledTimes(2);
        const lastCall = onDateChange.mock.calls[onDateChange.mock.calls.length - 1];
        // The component appends T23:59:59 and converts to ISO; the exact UTC value
        // depends on the local timezone, so just verify dateTo is a non-empty string
        expect(lastCall[1]).toBeTruthy();
        expect(typeof lastCall[1]).toBe('string');
      });
    });

    it('should hide custom date inputs when switching back to a preset', async () => {
      const user = userEvent.setup();
      render(<MessageDateFilter onDateChange={onDateChange} />);

      await user.click(screen.getByRole('button', { name: /custom range/i }));
      await waitFor(() => screen.getByLabelText(/^from$/i));

      await user.click(screen.getByRole('button', { name: /all time/i }));

      await waitFor(() => {
        expect(screen.queryByLabelText(/^from$/i)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/^to$/i)).not.toBeInTheDocument();
      });
    });
  });
});
