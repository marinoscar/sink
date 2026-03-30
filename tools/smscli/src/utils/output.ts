import chalk from 'chalk';
import type { OutputMode, CliResult } from './types.js';

// ---------------------------------------------------------------------------
// Basic output helpers (human mode)
// ---------------------------------------------------------------------------

export function info(message: string): void {
  console.log(chalk.cyan(message));
}

export function success(message: string): void {
  console.log(chalk.green(message));
}

export function warn(message: string): void {
  console.error(chalk.yellow(message));
}

export function error(message: string): void {
  console.error(chalk.red(message));
}

export function dim(message: string): void {
  console.log(chalk.dim(message));
}

export function bold(message: string): void {
  console.log(chalk.bold(message));
}

export function header(title: string): void {
  console.log('');
  console.log(chalk.bold.cyan(title));
  console.log(chalk.dim('─'.repeat(title.length)));
}

export function keyValue(key: string, value: string): void {
  console.log(`  ${chalk.dim(key + ':')} ${value}`);
}

export function tableRow(columns: string[], widths: number[]): void {
  const formatted = columns.map((col, i) =>
    String(col ?? '').padEnd(widths[i] || 20),
  );
  console.log('  ' + formatted.join('  '));
}

export function tableHeader(columns: string[], widths: number[]): void {
  tableRow(columns, widths);
  console.log('  ' + chalk.dim('─'.repeat(widths.reduce((a, b) => a + b + 2, 0))));
}

export function blank(): void {
  console.log('');
}

// ---------------------------------------------------------------------------
// OutputManager — centralises the three output modes
// ---------------------------------------------------------------------------

export class OutputManager {
  constructor(public readonly mode: OutputMode) {}

  /** Is this a machine-readable mode (json or quiet)? */
  get isMachine(): boolean {
    return this.mode === 'json' || this.mode === 'quiet';
  }

  /**
   * Emit a successful result.
   *
   * @param data         The payload object.
   * @param humanFormat  Callback that prints a human-friendly representation.
   * @param quietFormat  Optional callback for quiet mode. If omitted, nothing is printed in quiet mode.
   */
  result<T>(
    data: T,
    humanFormat: (data: T) => void,
    quietFormat?: (data: T) => void,
  ): void {
    switch (this.mode) {
      case 'json': {
        const envelope: CliResult<T> = { success: true, data };
        process.stdout.write(JSON.stringify(envelope) + '\n');
        break;
      }
      case 'quiet':
        if (quietFormat) quietFormat(data);
        break;
      case 'human':
      default:
        humanFormat(data);
        break;
    }
  }

  /**
   * Emit a single NDJSON line (used by streaming commands like `watch`).
   */
  ndjson<T>(data: T): void {
    process.stdout.write(JSON.stringify(data) + '\n');
  }

  /**
   * Emit an error.
   */
  fail(msg: string, code?: string): void {
    if (this.mode === 'json') {
      const envelope: CliResult<never> = { success: false, error: msg, ...(code ? { code } : {}) };
      process.stderr.write(JSON.stringify(envelope) + '\n');
    } else {
      error(msg);
    }
  }

  /** Print only in human mode. */
  humanOnly(fn: () => void): void {
    if (this.mode === 'human') fn();
  }

  /** Verbose log — only in human mode when verbose is enabled. */
  verbose(message: string): void {
    if (this.mode === 'human') {
      console.error(chalk.gray(`[verbose] ${message}`));
    }
  }
}
