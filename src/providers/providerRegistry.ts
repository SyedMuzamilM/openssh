import { DeploymentPlan, InstanceDescriptor, SshKeyMetadata } from '../types/index.js';
import { AwsProviderAdapter } from './awsProvider.js';
import { GcpProviderAdapter } from './gcpProvider.js';
import { AzureProviderAdapter } from './azureProvider.js';
import { DigitalOceanProviderAdapter } from './digitalOceanProvider.js';

export interface ProviderDeploymentInput {
  name: string;
  configuration: Record<string, unknown>;
}

export interface ProviderAdapter {
  readonly provider: string;
  createDeploymentPlan(
    input: ProviderDeploymentInput,
    key?: SshKeyMetadata,
  ): DeploymentPlan;
  buildSshCommand(instance: InstanceDescriptor, key?: SshKeyMetadata): string | undefined;
}

const adapters: ProviderAdapter[] = [
  new AwsProviderAdapter(),
  new GcpProviderAdapter(),
  new AzureProviderAdapter(),
  new DigitalOceanProviderAdapter(),
];

export function getProviderAdapter(provider: string): ProviderAdapter {
  const adapter = adapters.find((item) => item.provider === provider);
  if (!adapter) {
    throw new Error(`Unsupported provider: ${provider}`);
  }
  return adapter;
}

export function listProviderAdapters(): ProviderAdapter[] {
  return adapters;
}
