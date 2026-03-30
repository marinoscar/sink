import { Command } from 'commander';
import { writeFileSync } from 'fs';
import { getMessages, resolvePhoneNumber } from '../lib/api-client.js';
import { formatMessageTable, formatMessagesCsv } from '../lib/formatters.js';
import { OutputManager } from '../utils/output.js';
import * as out from '../utils/output.js';
import type {
  GlobalOptions,
  MessageQueryParams,
  SmsMessage,
  PaginatedMessages,
} from '../utils/types.js';

function getOutput(cmd: Command): OutputManager {
  const opts = cmd.optsWithGlobals<GlobalOptions>();
  return new OutputManager(opts.json ? 'json' : opts.quiet ? 'quiet' : 'human');
}

/** Sleep helper. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build MessageQueryParams from the shared filter options that appear on
 * several subcommands.
 */
async function buildQueryParams(opts: Record<string, string | undefined>): Promise<MessageQueryParams> {
  const params: MessageQueryParams = {};
  if (opts.sender) params.sender = opts.sender;
  if (opts.from) params.dateFrom = opts.from;
  if (opts.to) params.dateTo = opts.to;
  if (opts.device) params.deviceId = opts.device;
  if (opts.sim) params.deviceSimId = opts.sim;
  if (opts.page) params.page = Number(opts.page);
  if (opts.pageSize) params.pageSize = Number(opts.pageSize);

  if (opts.type) params.messageType = opts.type;

  // --number resolves a phone number to a deviceSimId
  if (opts.number) {
    params.deviceSimId = await resolvePhoneNumber(opts.number);
  }

  return params;
}

// Shared filter option definitions (reused across subcommands)
function addFilterOptions(cmd: Command): Command {
  return cmd
    .option(
      '--sender <pattern>',
      'Filter messages by sender address. Case-insensitive substring match. ' +
      'Example: --sender "ACME" matches "ACME-BANK", "ACME Corp", etc.',
    )
    .option(
      '--number <phone>',
      'Filter messages by the receiving phone number (your SIM card\'s number). ' +
      'Useful when you have multiple SIM cards/phone lines. Supports full number ' +
      '("+12488057580") or suffix match ("7580"). The CLI resolves this to a SIM ID automatically.',
    )
    .option(
      '--from <iso-date>',
      'Only show messages with SMS timestamp on or after this date. ISO 8601 format ' +
      '(e.g., "2026-03-29T00:00:00Z").',
    )
    .option(
      '--to <iso-date>',
      'Only show messages with SMS timestamp on or before this date. ISO 8601 format.',
    )
    .option(
      '--device <uuid>',
      'Filter messages from a specific registered device by its UUID. ' +
      'Use "smscli devices list" to find device IDs.',
    )
    .option(
      '--sim <uuid>',
      'Filter messages received on a specific SIM card by its UUID. ' +
      'Use "smscli devices list" to see SIM IDs. Prefer --number for a more user-friendly alternative.',
    )
    .option(
      '--type <sms|rcs>',
      'Filter messages by protocol type: "sms" for traditional SMS, "rcs" for Rich Communication Services ' +
      '(captured via notification listener from Google Messages). If omitted, shows both SMS and RCS messages.',
    );
}

export function registerMessagesCommands(program: Command): void {
  const messages = program
    .command('messages')
    .description(
      'List, search, watch, and export SMS messages received on your registered Android devices.',
    );

  // -----------------------------------------------------------------------
  // list
  // -----------------------------------------------------------------------
  const listCmd = messages
    .command('list')
    .description(
      'List SMS messages with pagination and filtering. Results are ordered by SMS timestamp (newest first).',
    )
    .option('--page <n>', 'Page number for pagination (1-based, default: 1).')
    .option(
      '--page-size <n>',
      'Number of messages per page (1-100, default: 20).',
    )
    .option(
      '--limit <n>',
      'Maximum total messages to return. When set, the CLI automatically fetches multiple pages ' +
      'until the limit is reached. Overrides --page.',
    )
    .action(async (opts: Record<string, string>, cmd: Command) => {
      const output = getOutput(cmd);
      try {
        const params = await buildQueryParams(opts);

        if (opts.limit) {
          // Multi-page fetch
          const limit = Number(opts.limit);
          const allMessages: SmsMessage[] = [];
          let page = 1;
          const pageSize = Number(opts.pageSize) || 20;

          while (allMessages.length < limit) {
            const result = await getMessages({ ...params, page, pageSize });
            allMessages.push(...result.items);
            if (page >= result.totalPages) break;
            page++;
          }

          const trimmed = allMessages.slice(0, limit);
          output.result(
            { items: trimmed, total: trimmed.length },
            () => {
              out.header(`Messages (${trimmed.length} shown)`);
              formatMessageTable(trimmed);
            },
            () => {
              for (const m of trimmed) {
                console.log(`${m.smsTimestamp}\t${m.sender}\t${m.body.replace(/\n/g, ' ').slice(0, 80)}`);
              }
            },
          );
        } else {
          const result = await getMessages(params);
          output.result(
            result,
            (data) => {
              out.header(`Messages (page ${data.page}/${data.totalPages}, ${data.total} total)`);
              formatMessageTable(data.items);
            },
            (data) => {
              for (const m of data.items) {
                console.log(`${m.smsTimestamp}\t${m.sender}\t${m.body.replace(/\n/g, ' ').slice(0, 80)}`);
              }
            },
          );
        }
      } catch (err) {
        output.fail((err as Error).message, 'LIST_FAILED');
        process.exit(1);
      }
    });
  addFilterOptions(listCmd);

  // -----------------------------------------------------------------------
  // search
  // -----------------------------------------------------------------------
  const searchCmd = messages
    .command('search')
    .description(
      'Shorthand for "smscli messages list --sender <pattern>". Searches messages by sender ' +
      'address with case-insensitive substring matching.',
    )
    .argument('<pattern>', 'The sender address pattern to search for.')
    .option('--page <n>', 'Page number (default: 1).')
    .option('--page-size <n>', 'Results per page (default: 20).')
    .action(async (pattern: string, opts: Record<string, string>, cmd: Command) => {
      const output = getOutput(cmd);
      try {
        const params = await buildQueryParams({ ...opts, sender: pattern });
        const result = await getMessages(params);
        output.result(
          result,
          (data) => {
            out.header(`Search results for "${pattern}" (${data.total} total)`);
            formatMessageTable(data.items);
          },
          (data) => {
            for (const m of data.items) {
              console.log(`${m.smsTimestamp}\t${m.sender}\t${m.body.replace(/\n/g, ' ').slice(0, 80)}`);
            }
          },
        );
      } catch (err) {
        output.fail((err as Error).message, 'SEARCH_FAILED');
        process.exit(1);
      }
    });
  addFilterOptions(searchCmd);

  // -----------------------------------------------------------------------
  // latest
  // -----------------------------------------------------------------------
  const latestCmd = messages
    .command('latest')
    .description(
      'Show the most recent messages. Convenience shorthand for "messages list" with a small page size.',
    )
    .option(
      '-n, --count <number>',
      'Number of recent messages to show (default: 10, max: 100).',
      '10',
    )
    .action(async (opts: Record<string, string>, cmd: Command) => {
      const output = getOutput(cmd);
      try {
        const params = await buildQueryParams(opts);
        params.page = 1;
        params.pageSize = Math.min(Number(opts.count) || 10, 100);
        const result = await getMessages(params);
        output.result(
          result,
          (data) => {
            out.header(`Latest ${data.items.length} messages`);
            formatMessageTable(data.items);
          },
          (data) => {
            for (const m of data.items) {
              console.log(`${m.smsTimestamp}\t${m.sender}\t${m.body.replace(/\n/g, ' ').slice(0, 80)}`);
            }
          },
        );
      } catch (err) {
        output.fail((err as Error).message, 'LATEST_FAILED');
        process.exit(1);
      }
    });
  addFilterOptions(latestCmd);

  // -----------------------------------------------------------------------
  // watch
  // -----------------------------------------------------------------------
  const watchCmd = messages
    .command('watch')
    .description(
      'Continuously poll for new messages and print them as they arrive. ' +
      'Runs until interrupted with Ctrl+C. In JSON mode, outputs one JSON object per line (NDJSON format).',
    )
    .option(
      '--interval <seconds>',
      'How often to poll the API for new messages (default: 5 seconds).',
      '5',
    )
    .action(async (opts: Record<string, string>, cmd: Command) => {
      const output = getOutput(cmd);
      const interval = (Number(opts.interval) || 5) * 1000;
      const seenIds = new Set<string>();
      let dateFrom = new Date().toISOString();

      try {
        const params = await buildQueryParams(opts);

        output.humanOnly(() => out.info('Watching for new messages… (Ctrl+C to stop)'));

        // Graceful shutdown
        let running = true;
        process.on('SIGINT', () => { running = false; });

        while (running) {
          try {
            const result = await getMessages({
              ...params,
              dateFrom,
              page: 1,
              pageSize: 20,
            });

            for (const msg of result.items) {
              if (!seenIds.has(msg.id)) {
                seenIds.add(msg.id);
                if (output.mode === 'json') {
                  output.ndjson(msg);
                } else if (output.mode === 'quiet') {
                  console.log(`${msg.smsTimestamp}\t${msg.sender}\t${msg.body.replace(/\n/g, ' ').slice(0, 80)}`);
                } else {
                  out.blank();
                  out.info(`[${msg.smsTimestamp}] ${msg.sender}`);
                  console.log(`  ${msg.body.replace(/\n/g, '\n  ')}`);
                }
              }
            }

            // Prune seen set if it grows large
            if (seenIds.size > 10_000) {
              const entries = Array.from(seenIds);
              const half = Math.floor(entries.length / 2);
              for (let i = 0; i < half; i++) seenIds.delete(entries[i]);
            }
          } catch (err) {
            output.humanOnly(() => out.warn(`Poll error: ${(err as Error).message}`));
          }

          await sleep(interval);
        }

        output.humanOnly(() => out.dim('\nStopped watching.'));
      } catch (err) {
        output.fail((err as Error).message, 'WATCH_FAILED');
        process.exit(1);
      }
    });
  addFilterOptions(watchCmd);

  // -----------------------------------------------------------------------
  // export
  // -----------------------------------------------------------------------
  const exportCmd = messages
    .command('export')
    .description(
      'Export all messages matching the filter criteria. Fetches all pages automatically.',
    )
    .option(
      '--format <type>',
      'Output format: "json" or "csv" (default: json). CSV includes headers: timestamp, sender, body, device, sim_phone_number.',
      'json',
    )
    .option(
      '--output <file>',
      'Write output to a file instead of stdout.',
    )
    .action(async (opts: Record<string, string>, cmd: Command) => {
      const output = getOutput(cmd);
      try {
        const params = await buildQueryParams(opts);
        const allMessages: SmsMessage[] = [];
        let page = 1;
        const pageSize = 100;

        output.humanOnly(() => out.info('Exporting messages…'));

        while (true) {
          const result = await getMessages({ ...params, page, pageSize });
          allMessages.push(...result.items);
          output.humanOnly(() => out.dim(`  Fetched page ${page}/${result.totalPages} (${allMessages.length}/${result.total})…`));
          if (page >= result.totalPages) break;
          page++;
        }

        let content: string;
        if (opts.format === 'csv') {
          content = formatMessagesCsv(allMessages);
        } else {
          content = JSON.stringify(allMessages, null, 2);
        }

        if (opts.output) {
          writeFileSync(opts.output, content, 'utf-8');
          output.humanOnly(() => out.success(`Exported ${allMessages.length} messages to ${opts.output}`));
        } else {
          process.stdout.write(content + '\n');
        }
      } catch (err) {
        output.fail((err as Error).message, 'EXPORT_FAILED');
        process.exit(1);
      }
    });
  addFilterOptions(exportCmd);
}
