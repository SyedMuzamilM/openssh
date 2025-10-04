import { v4 as uuid } from 'uuid';
import { updateConfig, loadConfig } from '../storage/configStore.js';
import { CloudProvider, SshKeyMetadata } from '../types/index.js';
import { calculateFingerprint } from '../utils/ssh.js';

export async function listSshKeys(): Promise<SshKeyMetadata[]> {
  const config = await loadConfig();
  return config.sshKeys;
}

export interface AddSshKeyInput {
  name: string;
  publicKeyPath: string;
  privateKeyPath: string;
  providers: CloudProvider[];
}

export async function addSshKey(input: AddSshKeyInput): Promise<SshKeyMetadata> {
  const fingerprint = await calculateFingerprint(input.publicKeyPath);
  const key: SshKeyMetadata = {
    id: uuid(),
    name: input.name,
    publicKeyPath: input.publicKeyPath,
    privateKeyPath: input.privateKeyPath,
    providers: input.providers,
    createdAt: new Date().toISOString(),
    ...(fingerprint ? { fingerprint } : {}),
  };

  await updateConfig((config) => ({
    ...config,
    sshKeys: [...config.sshKeys, key],
  }));

  return key;
}

export async function removeSshKey(id: string): Promise<void> {
  await updateConfig((config) => ({
    ...config,
    sshKeys: config.sshKeys.filter((key) => key.id !== id),
    deployments: config.deployments.map((deployment) => {
      if (deployment.sshKeyId !== id) {
        return deployment;
      }
      const next = { ...deployment };
      delete next.sshKeyId;
      return next;
    }),
    instances: config.instances.map((instance) => {
      if (instance.sshKeyId !== id) {
        return instance;
      }
      const next = { ...instance };
      delete next.sshKeyId;
      return next;
    }),
  }));
}

export async function setDefaultKeyForProvider(
  keyId: string,
  provider: CloudProvider,
): Promise<void> {
  await updateConfig((config) => ({
    ...config,
    sshKeys: config.sshKeys.map((key) => {
      const defaults = new Set(key.defaultFor ?? []);
      if (key.id === keyId) {
        defaults.add(provider);
      } else {
        defaults.delete(provider);
      }
      return {
        ...key,
        defaultFor: Array.from(defaults),
      };
    }),
  }));
}

export async function findDefaultKey(provider: CloudProvider): Promise<SshKeyMetadata | undefined> {
  const config = await loadConfig();
  const exact = config.sshKeys.find((key) => key.defaultFor?.includes(provider));
  if (exact) {
    return exact;
  }
  return config.sshKeys.find((key) => key.providers.includes(provider));
}
