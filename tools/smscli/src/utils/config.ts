import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

// ---------------------------------------------------------------------------
// Config store (persisted settings)
// ---------------------------------------------------------------------------

interface SmscliConfig {
  appUrl?: string;
}

const DEFAULT_APP_URL = 'https://sink.marin.cr';

function getConfigDir(): string {
  return process.env.SMSCLI_CONFIG_DIR || join(homedir(), '.config', 'smscli');
}

function getConfigFile(): string {
  return join(getConfigDir(), 'config.json');
}

export function loadConfig(): SmscliConfig {
  try {
    const configFile = getConfigFile();
    if (!existsSync(configFile)) {
      return {};
    }
    const content = readFileSync(configFile, 'utf-8');
    return JSON.parse(content) as SmscliConfig;
  } catch {
    return {};
  }
}

export function saveConfig(cfg: SmscliConfig): void {
  const configFile = getConfigFile();
  const dir = dirname(configFile);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configFile, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// URL getters
// ---------------------------------------------------------------------------

/**
 * Get the application base URL.
 * Priority: SMSCLI_APP_URL env → persisted config → default.
 */
export function getAppUrl(): string {
  if (process.env.SMSCLI_APP_URL) return process.env.SMSCLI_APP_URL;
  const cfg = loadConfig();
  if (cfg.appUrl) return cfg.appUrl;
  return DEFAULT_APP_URL;
}

/**
 * Get the API base URL (appUrl + /api).
 * Priority: SMSCLI_API_URL env → derived from appUrl.
 */
export function getApiUrl(): string {
  if (process.env.SMSCLI_API_URL) return process.env.SMSCLI_API_URL;
  return `${getAppUrl()}/api`;
}

export function setAppUrl(url: string): void {
  const cfg = loadConfig();
  cfg.appUrl = url;
  saveConfig(cfg);
}

export function clearConfig(): void {
  try {
    const configFile = getConfigFile();
    if (existsSync(configFile)) unlinkSync(configFile);
  } catch { /* ignore */ }
}

export function getAppUrlSource(): 'environment' | 'config' | 'default' {
  if (process.env.SMSCLI_APP_URL) return 'environment';
  const cfg = loadConfig();
  if (cfg.appUrl) return 'config';
  return 'default';
}

// ---------------------------------------------------------------------------
// Convenience config object
// ---------------------------------------------------------------------------

/** Runtime-resolved configuration used throughout the CLI. */
export const config = {
  get apiUrl(): string {
    return getApiUrl();
  },
  get appUrl(): string {
    return getAppUrl();
  },
  get configDir(): string {
    return getConfigDir();
  },
  get authFile(): string {
    return join(this.configDir, 'auth.json');
  },
  get configFile(): string {
    return getConfigFile();
  },
  deviceAuthPollInterval: 5,
};
