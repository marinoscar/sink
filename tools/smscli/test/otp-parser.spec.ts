import { describe, it, expect } from '@jest/globals';
import { extractOtp, extractAllOtps } from '../src/lib/otp-parser.js';

describe('extractOtp', () => {
  // -----------------------------------------------------------------------
  // Labelled patterns — high confidence
  // -----------------------------------------------------------------------

  it('extracts "Your verification code is 123456"', () => {
    expect(extractOtp('Your verification code is 123456')).toBe('123456');
  });

  it('extracts "Your verification code: 654321"', () => {
    expect(extractOtp('Your verification code: 654321')).toBe('654321');
  });

  it('extracts "OTP: 4567"', () => {
    expect(extractOtp('OTP: 4567')).toBe('4567');
  });

  it('extracts "OTP is 9876"', () => {
    expect(extractOtp('Your OTP is 9876')).toBe('9876');
  });

  it('extracts "OTP 123456"', () => {
    expect(extractOtp('Your OTP 123456 expires in 5 mins')).toBe('123456');
  });

  it('extracts "code: 543210"', () => {
    expect(extractOtp('Your code: 543210. It expires in 5 minutes.')).toBe('543210');
  });

  it('extracts "Use code 12345678 to verify"', () => {
    expect(extractOtp('Use code 12345678 to verify your account')).toBe('12345678');
  });

  it('extracts "123456 is your verification code"', () => {
    expect(extractOtp('123456 is your verification code')).toBe('123456');
  });

  it('extracts "123456 is your one-time code"', () => {
    expect(extractOtp('123456 is your one-time code')).toBe('123456');
  });

  it('extracts "PIN: 9876"', () => {
    expect(extractOtp('Your PIN: 9876')).toBe('9876');
  });

  it('extracts "PIN is 5678"', () => {
    expect(extractOtp('Your PIN is 5678')).toBe('5678');
  });

  it('extracts "security code: 234567"', () => {
    expect(extractOtp('Your security code: 234567')).toBe('234567');
  });

  it('extracts "confirmation code: 345678"', () => {
    expect(extractOtp('Your confirmation code: 345678')).toBe('345678');
  });

  it('extracts "passcode: 456789"', () => {
    expect(extractOtp('Your passcode: 456789')).toBe('456789');
  });

  it('extracts "use 123456 to verify"', () => {
    expect(extractOtp('Please use 123456 to verify your identity')).toBe('123456');
  });

  it('extracts "use 123456 to log in"', () => {
    expect(extractOtp('Use 123456 to log in to your account')).toBe('123456');
  });

  it('extracts "use 654321 to sign in"', () => {
    expect(extractOtp('Use 654321 to sign in')).toBe('654321');
  });

  it('extracts "enter 789012"', () => {
    expect(extractOtp('Please enter 789012 to continue')).toBe('789012');
  });

  // -----------------------------------------------------------------------
  // 4-digit codes
  // -----------------------------------------------------------------------

  it('extracts 4-digit OTP', () => {
    expect(extractOtp('Your code is 1234')).toBe('1234');
  });

  // -----------------------------------------------------------------------
  // 8-digit codes
  // -----------------------------------------------------------------------

  it('extracts 8-digit OTP', () => {
    expect(extractOtp('Your verification code is 12345678')).toBe('12345678');
  });

  // -----------------------------------------------------------------------
  // Fallback: standalone digits
  // -----------------------------------------------------------------------

  it('falls back to standalone digit group', () => {
    expect(extractOtp('Your account alert: 876543 for today.')).toBe('876543');
  });

  // -----------------------------------------------------------------------
  // Negative cases
  // -----------------------------------------------------------------------

  it('returns null for no digits', () => {
    expect(extractOtp('Hello, your package has been shipped!')).toBeNull();
  });

  it('returns null for 3-digit number (too short)', () => {
    expect(extractOtp('Your code is 123')).toBeNull();
  });

  it('returns null for 9-digit number (too long)', () => {
    expect(extractOtp('Reference: 123456789')).toBeNull();
  });

  it('does not match phone numbers with + prefix', () => {
    // The phone number +15551234567 should not be matched
    expect(extractOtp('Call +15551234567 for support')).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Labelled match wins over fallback
  // -----------------------------------------------------------------------

  it('labelled match wins when both exist', () => {
    // "12345" is the order number (fallback candidate), "678901" is the labelled code
    expect(extractOtp('Your order #12345 is ready. Code: 678901')).toBe('678901');
  });

  // -----------------------------------------------------------------------
  // Real-world examples
  // -----------------------------------------------------------------------

  it('handles Google verification', () => {
    expect(extractOtp('G-123456 is your Google verification code.')).toBe('123456');
  });

  it('handles bank transaction alert with OTP', () => {
    expect(
      extractOtp(
        'Transaction of $50.00 at Amazon. OTP: 456789. Do not share this code.',
      ),
    ).toBe('456789');
  });

  it('handles WhatsApp-style code', () => {
    expect(extractOtp('Your WhatsApp code is 123-456')).toBeNull();
    // Dash-separated codes are not supported (by design — ambiguous)
  });

  it('handles multi-line message', () => {
    expect(
      extractOtp('Hello,\n\nYour verification code is 112233.\n\nThanks.'),
    ).toBe('112233');
  });
});

describe('extractAllOtps', () => {
  it('returns all OTP-like codes', () => {
    const codes = extractAllOtps(
      'Code: 111111. Your backup code is 222222. Reference 333333.',
    );
    expect(codes).toContain('111111');
    expect(codes).toContain('222222');
    expect(codes).toContain('333333');
  });

  it('returns empty array when no codes found', () => {
    expect(extractAllOtps('No codes here!')).toEqual([]);
  });
});
