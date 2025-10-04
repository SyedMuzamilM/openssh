import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { OrchestratorConfig } from '../types/index.js';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'cloud-orchestrator');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: OrchestratorConfig = {
  version: 1,
  sshKeys: [],
  deployments: [],
  instances: [],
};

async function ensureConfigDir(): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
}

export async function loadConfig(): Promise<OrchestratorConfig> {
  await ensureConfigDir();
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<OrchestratorConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      version: parsed.version ?? DEFAULT_CONFIG.version,
      sshKeys: parsed.sshKeys ?? [],
      deployments: parsed.deployments ?? [],
      instances: parsed.instances ?? [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await saveConfig(DEFAULT_CONFIG);
      return DEFAULT_CONFIG;
    }
    throw error;
  }
}

export async function saveConfig(config: OrchestratorConfig): Promise<void> {
  await ensureConfigDir();
  const serialised = JSON.stringify(config, null, 2);
  await fs.writeFile(CONFIG_FILE, serialised, 'utf-8');
}

export async function updateConfig(
  updater: (config: OrchestratorConfig) => OrchestratorConfig,
): Promise<OrchestratorConfig> {
  const current = await loadConfig();
  const updated = updater(current);
  await saveConfig(updated);
  return updated;
}

export function getConfigFilePath(): string {
  return CONFIG_FILE;
}
