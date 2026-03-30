import chalk from 'chalk';
import type { Device, SmsMessage } from '../utils/types.js';
import * as out from '../utils/output.js';

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * Print a table of SMS messages in human-readable form.
 */
export function formatMessageTable(messages: SmsMessage[]): void {
  if (messages.length === 0) {
    out.dim('  No messages found.');
    return;
  }

  const widths = [22, 18, 60];
  out.tableHeader(['Timestamp', 'Sender', 'Message'], widths);

  for (const msg of messages) {
    const ts = formatTimestamp(msg.smsTimestamp);
    const body = msg.body.replace(/\n/g, ' ').slice(0, 60);
    out.tableRow([ts, msg.sender, body], widths);
  }
}

/**
 * Print a single message in full detail.
 */
export function formatMessageDetail(msg: SmsMessage): void {
  out.keyValue('ID', msg.id);
  out.keyValue('Sender', msg.sender);
  out.keyValue('Timestamp', formatTimestamp(msg.smsTimestamp));
  out.keyValue('Received', formatTimestamp(msg.receivedAt));
  out.keyValue('Device', msg.device?.name ?? '—');
  if (msg.sim) {
    const simLabel = [msg.sim.displayName, msg.sim.carrierName, msg.sim.phoneNumber]
      .filter(Boolean)
      .join(' / ');
    out.keyValue('SIM', simLabel || '—');
  }
  out.blank();
  console.log(msg.body);
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

/**
 * Print the full device list with SIM tables.
 */
export function formatDeviceList(devices: Device[]): void {
  if (devices.length === 0) {
    out.dim('  No devices registered.');
    return;
  }

  for (const dev of devices) {
    out.blank();
    console.log(chalk.bold(`${dev.name}`) + chalk.dim(`  (${dev.platform})`));
    out.keyValue('ID', dev.id);
    if (dev.manufacturer || dev.model) {
      out.keyValue('Model', [dev.manufacturer, dev.model].filter(Boolean).join(' '));
    }
    if (dev.osVersion) out.keyValue('OS', dev.osVersion);
    if (dev.appVersion) out.keyValue('App Version', dev.appVersion);
    out.keyValue('Last Seen', dev.lastSeenAt ? formatTimestamp(dev.lastSeenAt) : '—');
    out.keyValue('Active', dev.isActive ? chalk.green('Yes') : chalk.red('No'));

    if (dev.sims.length > 0) {
      out.blank();
      console.log(chalk.dim('  SIMs:'));
      const simWidths = [6, 14, 18, 14, 12];
      out.tableRow(['Slot', 'Carrier', 'Phone Number', 'Display Name', 'ICC ID'], simWidths);
      console.log('  ' + chalk.dim('─'.repeat(simWidths.reduce((a, b) => a + b + 2, 0))));
      for (const sim of dev.sims) {
        out.tableRow(
          [
            String(sim.slotIndex),
            sim.carrierName || '—',
            sim.phoneNumber || '—',
            sim.displayName || '—',
            sim.iccId ? sim.iccId.slice(0, 10) + '…' : '—',
          ],
          simWidths,
        );
      }
    } else {
      out.dim('  No SIMs registered.');
    }
  }
}

// ---------------------------------------------------------------------------
// Senders
// ---------------------------------------------------------------------------

/**
 * Print a list of unique senders.
 */
export function formatSenderList(senders: string[]): void {
  if (senders.length === 0) {
    out.dim('  No senders found.');
    return;
  }
  for (const s of senders) {
    console.log(`  ${s}`);
  }
}

// ---------------------------------------------------------------------------
// OTP result
// ---------------------------------------------------------------------------

/**
 * Print an OTP extraction result with message context.
 */
export function formatOtpResult(code: string, msg: SmsMessage): void {
  out.blank();
  console.log(chalk.green.bold(`  OTP Code: ${code}`));
  out.blank();
  out.keyValue('Sender', msg.sender);
  out.keyValue('Timestamp', formatTimestamp(msg.smsTimestamp));
  out.keyValue('Message', msg.body.replace(/\n/g, ' '));
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * Format messages as CSV text.
 */
export function formatMessagesCsv(messages: SmsMessage[]): string {
  const header = 'timestamp,sender,body,device,sim_phone_number';
  const rows = messages.map((m) => {
    const body = `"${m.body.replace(/"/g, '""').replace(/\n/g, ' ')}"`;
    return [
      m.smsTimestamp,
      m.sender,
      body,
      m.device?.name ?? '',
      m.sim?.phoneNumber ?? '',
    ].join(',');
  });
  return [header, ...rows].join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  } catch {
    return iso;
  }
}
