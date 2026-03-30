import { Command } from 'commander';
import { getSenders } from '../lib/api-client.js';
import { formatSenderList } from '../lib/formatters.js';
import { OutputManager } from '../utils/output.js';
import * as out from '../utils/output.js';
import type { GlobalOptions } from '../utils/types.js';

function getOutput(cmd: Command): OutputManager {
  const opts = cmd.optsWithGlobals<GlobalOptions>();
  return new OutputManager(opts.json ? 'json' : opts.quiet ? 'quiet' : 'human');
}

export function registerSendersCommands(program: Command): void {
  const senders = program
    .command('senders')
    .description(
      'View unique sender addresses that have sent SMS messages to your devices.',
    );

  senders
    .command('list')
    .description(
      'List all unique sender addresses that have sent SMS messages to your devices. ' +
      'Returns a deduplicated, alphabetically sorted list. Useful for discovering available ' +
      'senders before filtering with --sender on other commands like "messages list" or "otp wait".',
    )
    .action(async (_opts: unknown, cmd: Command) => {
      const output = getOutput(cmd);
      try {
        const senderList = await getSenders();
        output.result(
          senderList,
          (data) => {
            out.header(`Senders (${data.length})`);
            formatSenderList(data);
          },
          (data) => {
            for (const s of data) console.log(s);
          },
        );
      } catch (err) {
        output.fail((err as Error).message, 'SENDERS_FAILED');
        process.exit(1);
      }
    });
}
