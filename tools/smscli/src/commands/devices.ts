import { Command } from 'commander';
import { getDevices } from '../lib/api-client.js';
import { formatDeviceList } from '../lib/formatters.js';
import { OutputManager } from '../utils/output.js';
import * as out from '../utils/output.js';
import type { GlobalOptions } from '../utils/types.js';

function getOutput(cmd: Command): OutputManager {
  const opts = cmd.optsWithGlobals<GlobalOptions>();
  return new OutputManager(opts.json ? 'json' : opts.quiet ? 'quiet' : 'human');
}

export function registerDevicesCommands(program: Command): void {
  const devices = program
    .command('devices')
    .description(
      'Manage and inspect registered Android devices and their SIM cards. ' +
      'Use "devices list" to discover device IDs, SIM IDs, and phone numbers ' +
      'for use with --device, --sim, and --number filters on other commands.',
    );

  // -----------------------------------------------------------------------
  // list
  // -----------------------------------------------------------------------
  devices
    .command('list')
    .description(
      'List all Android devices registered to your account with complete SIM card information ' +
      'including carrier name, phone number, slot index, display name, and ICC ID. ' +
      'Use this to find device IDs, SIM IDs, and phone numbers for use with --device, ' +
      '--sim, and --number filters on other commands.',
    )
    .action(async (_opts: unknown, cmd: Command) => {
      const output = getOutput(cmd);
      try {
        const deviceList = await getDevices();
        output.result(
          deviceList,
          (data) => {
            out.header(`Devices (${data.length})`);
            formatDeviceList(data);
          },
          (data) => {
            for (const d of data) {
              const sims = d.sims
                .map((s) => `${s.phoneNumber || 'no-number'}(${s.carrierName || 'unknown'})`)
                .join(', ');
              console.log(`${d.id}\t${d.name}\t${d.platform}\t${sims}`);
            }
          },
        );
      } catch (err) {
        output.fail((err as Error).message, 'DEVICES_LIST_FAILED');
        process.exit(1);
      }
    });

  // -----------------------------------------------------------------------
  // inspect
  // -----------------------------------------------------------------------
  devices
    .command('inspect')
    .description(
      'Show detailed information for a single device including all metadata ' +
      '(manufacturer, model, OS version, app version, last seen, active status) ' +
      'and a complete table of all SIM cards with carrier name, phone number, ' +
      'slot index, display name, and ICC ID.',
    )
    .argument('<id>', 'The UUID of the device to inspect. Use "smscli devices list" to find device IDs.')
    .action(async (id: string, _opts: unknown, cmd: Command) => {
      const output = getOutput(cmd);
      try {
        const deviceList = await getDevices();
        const device = deviceList.find(
          (d) => d.id === id || d.id.startsWith(id),
        );

        if (!device) {
          output.fail(
            `Device "${id}" not found. Run "smscli devices list" to see your devices.`,
            'DEVICE_NOT_FOUND',
          );
          process.exit(1);
        }

        output.result(
          device,
          (d) => {
            out.header(d.name);
            formatDeviceList([d]);
          },
          (d) => {
            console.log(JSON.stringify(d));
          },
        );
      } catch (err) {
        output.fail((err as Error).message, 'DEVICE_INSPECT_FAILED');
        process.exit(1);
      }
    });
}
