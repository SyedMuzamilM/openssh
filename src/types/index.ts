export type CloudProvider = 'aws' | 'gcp' | 'azure' | 'digitalocean';

export interface SshKeyMetadata {
  id: string;
  name: string;
  publicKeyPath: string;
  privateKeyPath: string;
  fingerprint?: string;
  providers: CloudProvider[];
  defaultFor?: CloudProvider[];
  createdAt: string;
}

export type DeploymentStatus = 'draft' | 'planned' | 'provisioning' | 'provisioned' | 'failed';

export interface DeploymentProfile {
  id: string;
  provider: CloudProvider;
  name: string;
  configuration: Record<string, unknown>;
  status: DeploymentStatus;
  sshKeyId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentStep {
  title: string;
  description?: string;
  command?: string;
  apiCall?: {
    service: string;
    action: string;
    payload: Record<string, unknown>;
  };
}

export interface DeploymentPlan {
  id: string;
  provider: CloudProvider;
  steps: DeploymentStep[];
  summary: string;
}

export interface InstanceDescriptor {
  id: string;
  provider: CloudProvider;
  name: string;
  region: string;
  ipAddress?: string;
  state: 'pending' | 'running' | 'stopped' | 'terminated' | 'unknown';
  sshKeyId?: string;
  profileId?: string;
  tags?: Record<string, string>;
  createdAt?: string;
}

export interface OrchestratorConfig {
  version: number;
  sshKeys: SshKeyMetadata[];
  deployments: DeploymentProfile[];
  instances: InstanceDescriptor[];
}

export interface ProviderContext {
  provider: CloudProvider;
  profiles: DeploymentProfile[];
  instances: InstanceDescriptor[];
}
