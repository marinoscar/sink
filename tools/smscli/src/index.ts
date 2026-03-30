#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { registerAuthCommands } from './commands/auth.js';
import { registerMessagesCommands } from './commands/messages.js';
import { registerOtpCommands } from './commands/otp.js';
import { registerDevicesCommands } from './commands/devices.js';
import { registerSendersCommands } from './commands/senders.js';
import { registerConfigCommands } from './commands/config.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { VERSION } from './version.js';

const program = new Command();

program
  .name('smscli')
  .description(
    'Sink SMS CLI — Read SMS messages and extract OTP codes from your Android device.\n\n' +
    'An AI-agent-friendly command-line tool for querying SMS messages relayed from an Android ' +
    'companion app through the Sink API. Designed for automation: supports --json and --quiet ' +
    'output modes so AI agents and scripts can reliably parse the output.\n\n' +
    'The primary use case is OTP automation: an AI agent invokes "smscli otp wait --sender <name> -q" ' +
    'to receive a bare OTP code it can use in a workflow.',
  )
  .version(VERSION, '-V, --version', 'Display the current smscli version (format: YYYY.M.patch).')
  .option(
    '--json',
    'Output all results as machine-readable JSON. ' +
    'Format: {"success": true, "data": ...} or {"success": false, "error": "...", "code": "..."}. ' +
    'Errors go to stderr, data to stdout. Ideal for AI agents and scripts — parse with: jq .data',
  )
  .option(
    '-q, --quiet',
    'Minimal output mode. Print only essential values with no formatting, headers, or decoration. ' +
    'For OTP commands, prints just the bare code. For message lists, prints one message per line. ' +
    'Ideal for shell piping: smscli otp wait -q | xargs',
  )
  .option(
    '--api-url <url>',
    'Override the Sink API base URL for this invocation only. ' +
    'Takes precedence over the config file and SMSCLI_API_URL environment variable. ' +
    'Example: --api-url https://vitalmesh.dev.marin.cr/api',
  )
  .option(
    '--no-color',
    'Disable all ANSI color codes in output. ' +
    'Useful for logging, CI environments, or terminals that don\'t support colors.',
  )
  .option(
    '-v, --verbose',
    'Enable verbose logging. Shows HTTP request/response details, token refresh events, ' +
    'and SIM resolution steps. Useful for debugging connectivity or auth issues.',
  );

// Apply global options before any command action runs
program.hook('preAction', (thisCommand) => {
  const opts = thisCommand.opts();

  // --api-url override
  if (opts.apiUrl) {
    process.env.SMSCLI_API_URL = opts.apiUrl;
  }

  // --no-color
  if (opts.color === false) {
    chalk.level = 0;
  }
});

// Register all command groups
registerAuthCommands(program);
registerMessagesCommands(program);
registerOtpCommands(program);
registerDevicesCommands(program);
registerSendersCommands(program);
registerConfigCommands(program);
registerDoctorCommand(program);

// Detailed help examples
program.addHelpText(
  'after',
  `
${chalk.bold('Examples:')}

  ${chalk.dim('# Authentication')}
  $ smscli auth login                              ${chalk.dim('# Authenticate via device flow')}
  $ smscli auth status                             ${chalk.dim('# Check login state')}
  $ smscli auth logout                             ${chalk.dim('# Clear stored tokens')}

  ${chalk.dim('# Devices & SIMs')}
  $ smscli devices list                            ${chalk.dim('# Show all devices with SIM info')}
  $ smscli devices inspect <device-id>             ${chalk.dim('# Detailed device view')}

  ${chalk.dim('# Messages')}
  $ smscli messages latest                         ${chalk.dim('# Show 10 most recent messages')}
  $ smscli messages latest --number "+12488057580" ${chalk.dim('# Filter by receiving number')}
  $ smscli messages list --sender "ACME"           ${chalk.dim('# Filter by sender')}
  $ smscli messages search "MyBank"                ${chalk.dim('# Search by sender')}
  $ smscli messages watch --sender "MyBank"        ${chalk.dim('# Live-watch for new messages')}
  $ smscli messages export --format csv            ${chalk.dim('# Export all messages as CSV')}

  ${chalk.dim('# OTP extraction (the killer feature for AI agents)')}
  $ smscli otp wait --sender "MyBank" --quiet      ${chalk.dim('# Wait for OTP, print bare code')}
  $ smscli otp wait --sender "MyBank" --number "7580" --timeout 60
  $ smscli otp latest --sender "Google"            ${chalk.dim('# Get most recent OTP')}
  $ echo "Your code is 123456" | smscli otp extract ${chalk.dim('# Extract OTP from text')}

  ${chalk.dim('# AI agent integration')}
  $ OTP=$(smscli otp wait --sender "MyService" -q) ${chalk.dim('# Capture OTP in a variable')}
  $ smscli messages latest --json | jq '.data.items[0].body'

  ${chalk.dim('# Diagnostics')}
  $ smscli doctor                                  ${chalk.dim('# Check connectivity & auth')}
  $ smscli config show                             ${chalk.dim('# Show current configuration')}
  $ smscli config set-url https://example.com      ${chalk.dim('# Set API URL')}

${chalk.dim('Documentation:')}
  See README.md for full documentation.
  API docs: docs/SMS-RELAY-API.md
  Android app: docs/ANDROID-APP.md
`,
);

// Global error handler
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const args = process.argv.slice(2);
  const isJson = args.includes('--json');

  if (isJson) {
    process.stderr.write(JSON.stringify({ success: false, error: message }) + '\n');
  } else {
    console.error(chalk.red(`Error: ${message}`));
  }
  process.exit(1);
});

// Parse and execute
program.parse();
