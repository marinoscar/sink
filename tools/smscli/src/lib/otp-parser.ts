/**
 * OTP code extraction engine.
 *
 * Extracts 4–8 digit OTP / verification codes from SMS message text.
 * All functions are pure (no I/O, no side effects) — designed for easy testing.
 */

// ---------------------------------------------------------------------------
// High-confidence labelled patterns (order matters – first match wins)
// ---------------------------------------------------------------------------

const LABELLED_PATTERNS: RegExp[] = [
  // "code is 123456", "code: 123456"
  /\bcode[\s:]+is[\s:]*(\d{4,8})\b/i,
  /\bcode[\s:]*(\d{4,8})\b/i,
  // "OTP: 1234", "OTP 123456", "OTP is 123456"
  /\bOTP[\s:]+is[\s:]*(\d{4,8})\b/i,
  /\bOTP[\s:]*(\d{4,8})\b/i,
  // "verification code: 123456", "verification code is 123456"
  /\bverification\s+code[\s:]+is[\s:]*(\d{4,8})\b/i,
  /\bverification\s+code[\s:]*(\d{4,8})\b/i,
  // "security code: 123456"
  /\bsecurity\s+code[\s:]*(\d{4,8})\b/i,
  // "confirmation code: 123456"
  /\bconfirmation\s+code[\s:]*(\d{4,8})\b/i,
  // "PIN: 1234", "pin is 5678"
  /\bPIN[\s:]+is[\s:]*(\d{4,8})\b/i,
  /\bPIN[\s:]*(\d{4,8})\b/i,
  // "passcode: 123456"
  /\bpasscode[\s:]*(\d{4,8})\b/i,
  // "123456 is your (verification|one-time|) code/OTP/PIN"
  /\b(\d{4,8})\s+is\s+your\s+(?:\w+\s+)?(?:code|OTP|PIN|passcode)\b/i,
  // "use 123456 to verify/confirm/login/sign in"
  /\buse\s+(\d{4,8})\s+to\s+(?:verify|confirm|log\s*in|sign\s*in|authenticate)\b/i,
  // "enter 123456"
  /\benter[\s:]*(\d{4,8})\b/i,
];

// ---------------------------------------------------------------------------
// Fallback: standalone digit group not part of a phone number
// ---------------------------------------------------------------------------

/**
 * Matches a standalone 4–8 digit group that does NOT look like a phone number.
 * A phone-number heuristic: preceded by '+' or a digit-dense context.
 */
const STANDALONE_DIGITS = /(?<!\+)(?<!\d)\b(\d{4,8})\b(?!\d)/g;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract the first OTP code found in the given text.
 *
 * Strategy:
 * 1. Try each labelled pattern in order (high confidence).
 * 2. Fall back to the first standalone 4–8 digit group.
 *
 * @returns The OTP code string, or `null` if none is found.
 */
export function extractOtp(text: string): string | null {
  // 1. Labelled patterns
  for (const re of LABELLED_PATTERNS) {
    const m = re.exec(text);
    if (m) return m[1];
  }

  // 2. Fallback: standalone digits
  const fallback = STANDALONE_DIGITS.exec(text);
  // Reset lastIndex since the regex is global
  STANDALONE_DIGITS.lastIndex = 0;
  if (fallback) return fallback[1];

  return null;
}

/**
 * Extract all OTP-like codes found in the text (useful for ambiguous messages).
 */
export function extractAllOtps(text: string): string[] {
  const codes = new Set<string>();

  for (const re of LABELLED_PATTERNS) {
    const m = re.exec(text);
    if (m) codes.add(m[1]);
  }

  let match: RegExpExecArray | null;
  while ((match = STANDALONE_DIGITS.exec(text)) !== null) {
    codes.add(match[1]);
  }
  STANDALONE_DIGITS.lastIndex = 0;

  return Array.from(codes);
}
