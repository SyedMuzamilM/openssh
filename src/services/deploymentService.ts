import { v4 as uuid } from 'uuid';
import { loadConfig, updateConfig } from '../storage/configStore.js';
import {
  CloudProvider,
  DeploymentPlan,
  DeploymentProfile,
  DeploymentStatus,
  InstanceDescriptor,
  SshKeyMetadata,
} from '../types/index.js';
import { getProviderAdapter, ProviderDeploymentInput } from '../providers/providerRegistry.js';
import { findDefaultKey, listSshKeys } from './sshService.js';

export interface CreateDeploymentInput {
  provider: CloudProvider;
  name: string;
  configuration: Record<string, unknown>;
  sshKeyId?: string;
}

export interface CreateDeploymentResult {
  profile: DeploymentProfile;
  plan: DeploymentPlan;
  sshKey?: SshKeyMetadata;
}

export async function listDeployments(): Promise<DeploymentProfile[]> {
  const config = await loadConfig();
  return config.deployments;
}

export async function listInstances(): Promise<InstanceDescriptor[]> {
  const config = await loadConfig();
  return config.instances;
}

export async function createDeploymentProfile(input: CreateDeploymentInput): Promise<CreateDeploymentResult> {
  const allKeys = await listSshKeys();
  const sshKey = allKeys.find((key) => key.id === input.sshKeyId);
  const resolvedKey = sshKey ?? (await findDefaultKey(input.provider));

  const baseProfile: DeploymentProfile = {
    id: uuid(),
    provider: input.provider,
    name: input.name,
    configuration: input.configuration,
    status: 'planned',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const profile: DeploymentProfile = resolvedKey
    ? { ...baseProfile, sshKeyId: resolvedKey.id }
    : baseProfile;

  const adapter = getProviderAdapter(input.provider);
  const planInput: ProviderDeploymentInput = {
    name: input.name,
    configuration: input.configuration,
  };
  const plan = adapter.createDeploymentPlan(planInput, resolvedKey);

  await updateConfig((config) => ({
    ...config,
    deployments: [...config.deployments, profile],
  }));

  if (resolvedKey) {
    return { profile, plan, sshKey: resolvedKey };
  }

  return { profile, plan };
}

export async function updateDeploymentStatus(
  deploymentId: string,
  status: DeploymentStatus,
): Promise<DeploymentProfile | undefined> {
  let updatedProfile: DeploymentProfile | undefined;
  await updateConfig((config) => {
    const deployments = config.deployments.map((deployment) => {
      if (deployment.id === deploymentId) {
        updatedProfile = {
          ...deployment,
          status,
          updatedAt: new Date().toISOString(),
        };
        return updatedProfile;
      }
      return deployment;
    });

    return {
      ...config,
      deployments,
    };
  });

  return updatedProfile;
}

export async function registerInstance(instance: InstanceDescriptor): Promise<void> {
  await updateConfig((config) => {
    const others = config.instances.filter((item) => item.id !== instance.id);
    return {
      ...config,
      instances: [...others, instance],
    };
  });
}

export async function buildSshCommandForInstance(instanceId: string): Promise<string | undefined> {
  const config = await loadConfig();
  const instance = config.instances.find((item) => item.id === instanceId);
  if (!instance) {
    return undefined;
  }
  const key = config.sshKeys.find((item) => item.id === instance.sshKeyId) ?? (await findDefaultKey(instance.provider));
  const adapter = getProviderAdapter(instance.provider);
  return adapter.buildSshCommand(instance, key);
}
