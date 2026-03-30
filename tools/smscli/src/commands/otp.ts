import { Command } from 'commander';
import { getMessages, resolvePhoneNumber } from '../lib/api-client.js';
import { extractOtp } from '../lib/otp-parser.js';
import { formatOtpResult } from '../lib/formatters.js';
import { OutputManager } from '../utils/output.js';
import * as out from '../utils/output.js';
import type { GlobalOptions, MessageQueryParams } from '../utils/types.js';

function getOutput(cmd: Command): OutputManager {
  const opts = cmd.optsWithGlobals<GlobalOptions>();
  return new OutputManager(opts.json ? 'json' : opts.quiet ? 'quiet' : 'human');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function registerOtpCommands(program: Command): void {
  const otp = program
    .command('otp')
    .description(
      'Extract OTP (One-Time Password) codes from SMS messages. ' +
      'Designed for AI agent automation — use "otp wait" to poll for a new OTP ' +
      'and get just the code back.',
    );

  // -----------------------------------------------------------------------
  // wait
  // -----------------------------------------------------------------------
  otp
    .command('wait')
    .description(
      'The primary command for AI agent OTP automation. Polls the API for new SMS messages, ' +
      'extracts the OTP code from the message body, and returns just the code. ' +
      'Exits with code 0 on success, code 1 on timeout. ' +
      'The --sender flag is optional — omit it to watch ALL incoming messages for an OTP code. ' +
      'This is useful when the sender name is unknown or changes between messages. ' +
      'In quiet mode (-q), prints only the bare numeric code — ideal for shell scripting: ' +
      'OTP=$(smscli otp wait -q) or OTP=$(smscli otp wait --sender "MyBank" -q)',
    )
    .option(
      '--sender <pattern>',
      'Filter for messages from this sender. Case-insensitive substring match. ' +
      'Example: --sender "MyBank" catches messages from "MyBank Alerts", "MYBANK", etc. ' +
      'If omitted, all incoming messages are checked for OTP codes.',
    )
    .option(
      '--number <phone>',
      'Only watch for OTP messages received on this specific phone number/SIM. ' +
      'Important when you have multiple SIM cards. Supports full number ("+12488057580") ' +
      'or suffix match ("7580").',
    )
    .option(
      '--timeout <seconds>',
      'Maximum time to wait for an OTP message before giving up (default: 120 seconds). ' +
      'Process exits with code 1 on timeout.',
      '120',
    )
    .option(
      '--interval <seconds>',
      'How often to poll the API for new messages (default: 3 seconds). ' +
      'Lower values detect OTPs faster but increase API load.',
      '3',
    )
    .option(
      '--since <iso-date>',
      'Start looking for messages from this time instead of "now". ' +
      'Useful if the OTP was sent moments before running this command. ISO 8601 format.',
    )
    .option(
      '--device <uuid>',
      'Only consider messages from a specific device.',
    )
    .action(async (opts: Record<string, string>, cmd: Command) => {
      const output = getOutput(cmd);
      const timeout = (Number(opts.timeout) || 120) * 1000;
      const interval = (Number(opts.interval) || 3) * 1000;
      const startTime = opts.since || new Date().toISOString();
      const deadline = Date.now() + timeout;

      try {
        const params: MessageQueryParams = {
          dateFrom: startTime,
          page: 1,
          pageSize: 10,
        };

        if (opts.sender) params.sender = opts.sender;
        if (opts.number) {
          params.deviceSimId = await resolvePhoneNumber(opts.number);
        }
        if (opts.device) {
          params.deviceId = opts.device;
        }

        const senderLabel = opts.sender ? `from "${opts.sender}"` : 'from any sender';
        output.humanOnly(() => {
          out.info(`Waiting for OTP ${senderLabel}…`);
          out.dim(`Timeout: ${opts.timeout}s | Interval: ${opts.interval}s | Since: ${startTime}`);
        });

        const seenIds = new Set<string>();

        while (Date.now() < deadline) {
          try {
            const result = await getMessages(params);

            for (const msg of result.items) {
              if (seenIds.has(msg.id)) continue;
              seenIds.add(msg.id);

              const code = extractOtp(msg.body);
              if (code) {
                output.result(
                  {
                    code,
                    sender: msg.sender,
                    body: msg.body,
                    smsTimestamp: msg.smsTimestamp,
                    receivedAt: msg.receivedAt,
                    messageId: msg.id,
                  },
                  () => formatOtpResult(code, msg),
                  () => console.log(code),
                );
                process.exit(0);
              }
            }
          } catch (err) {
            output.humanOnly(() => out.warn(`Poll error: ${(err as Error).message}`));
          }

          output.humanOnly(() => process.stdout.write('.'));
          await sleep(interval);
        }

        // Timeout
        output.humanOnly(() => out.blank());
        output.fail(
          `Timeout after ${opts.timeout}s waiting for OTP ${senderLabel}`,
          'TIMEOUT',
        );
        process.exit(1);
      } catch (err) {
        output.fail((err as Error).message, 'OTP_WAIT_FAILED');
        process.exit(1);
      }
    });

  // -----------------------------------------------------------------------
  // extract
  // -----------------------------------------------------------------------
  otp
    .command('extract')
    .description(
      'Extract an OTP code from arbitrary text. Pure offline utility — does not call the API. ' +
      'Useful for testing OTP extraction patterns or processing message text from other sources. ' +
      'Reads from --message flag or stdin (for piping). ' +
      'Example: echo "Your code is 123456" | smscli otp extract',
    )
    .option(
      '--message <text>',
      'The message text to extract an OTP from. If not provided, reads from stdin (for piping).',
    )
    .action(async (opts: Record<string, string>, cmd: Command) => {
      const output = getOutput(cmd);

      let text = opts.message;

      if (!text) {
        // Read from stdin
        if (process.stdin.isTTY) {
          output.fail(
            'No --message provided and stdin is a terminal. ' +
            'Provide --message <text> or pipe text via stdin.',
            'NO_INPUT',
          );
          process.exit(1);
        }
        text = await readStdin();
      }

      const code = extractOtp(text);

      if (code) {
        output.result(
          { code, source: text },
          () => {
            out.blank();
            console.log(`  OTP Code: ${code}`);
          },
          () => console.log(code),
        );
      } else {
        output.fail('No OTP code found in the provided text.', 'NO_OTP_FOUND');
        process.exit(1);
      }
    });

  // -----------------------------------------------------------------------
  // latest
  // -----------------------------------------------------------------------
  otp
    .command('latest')
    .description(
      'Get the most recent OTP code without waiting/polling. ' +
      'Fetches the latest messages, finds the first one containing an OTP code, and returns it. ' +
      'Use this when you know the OTP has already been sent. ' +
      'All filters are optional — without --sender, checks messages from any sender.',
    )
    .option(
      '--sender <pattern>',
      'Filter by sender address (case-insensitive substring match). ' +
      'If omitted, messages from all senders are checked for OTP codes.',
    )
    .option(
      '--number <phone>',
      'Filter by receiving phone number. Supports full or suffix match.',
    )
    .option(
      '--since <iso-date>',
      'Only consider messages from this time onwards. ISO 8601 format.',
    )
    .option(
      '--device <uuid>',
      'Only consider messages from a specific device.',
    )
    .action(async (opts: Record<string, string>, cmd: Command) => {
      const output = getOutput(cmd);

      try {
        const params: MessageQueryParams = {
          page: 1,
          pageSize: 20,
        };
        if (opts.sender) params.sender = opts.sender;
        if (opts.since) params.dateFrom = opts.since;
        if (opts.device) params.deviceId = opts.device;
        if (opts.number) {
          params.deviceSimId = await resolvePhoneNumber(opts.number);
        }

        const result = await getMessages(params);

        for (const msg of result.items) {
          const code = extractOtp(msg.body);
          if (code) {
            output.result(
              {
                code,
                sender: msg.sender,
                body: msg.body,
                smsTimestamp: msg.smsTimestamp,
                receivedAt: msg.receivedAt,
                messageId: msg.id,
              },
              () => formatOtpResult(code, msg),
              () => console.log(code),
            );
            return;
          }
        }

        output.fail('No OTP code found in recent messages.', 'NO_OTP_FOUND');
        process.exit(1);
      } catch (err) {
        output.fail((err as Error).message, 'OTP_LATEST_FAILED');
        process.exit(1);
      }
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data.trim()));
    process.stdin.on('error', reject);
  });
}
