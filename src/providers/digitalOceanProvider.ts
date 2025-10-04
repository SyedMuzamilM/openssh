import { DeploymentPlan, DeploymentStep, InstanceDescriptor, SshKeyMetadata } from '../types/index.js';
import { ProviderAdapter, ProviderDeploymentInput } from './providerRegistry.js';

function normalise(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

export class DigitalOceanProviderAdapter implements ProviderAdapter {
  readonly provider = 'digitalocean';

  createDeploymentPlan(input: ProviderDeploymentInput, key?: SshKeyMetadata): DeploymentPlan {
    const region = normalise(input.configuration.region, 'nyc1');
    const size = normalise(input.configuration.size ?? input.configuration.machineType, 's-1vcpu-1gb');
    const image = normalise(input.configuration.image, 'ubuntu-22-04-x64');
    const sshKeyName = normalise(input.configuration.sshKeyName, key?.name ?? `${input.name}-key`);
    const tags = (input.configuration.tags as string[] | undefined) ?? ['managed'];
    const backups = Boolean(input.configuration.backups);
    const monitoring = input.configuration.monitoring === undefined ? true : Boolean(input.configuration.monitoring);

    const steps: DeploymentStep[] = [];

    if (key) {
      steps.push({
        title: 'Import SSH key into DigitalOcean account',
        command: `doctl compute ssh-key import ${sshKeyName} --public-key-file ${key.publicKeyPath}`,
      });
    }

    const dropletCommand = [
      'doctl compute droplet create',
      input.name,
      `--region ${region}`,
      `--size ${size}`,
      `--image ${image}`,
      `--tag-name ${tags.join(' --tag-name ')}`,
    ];

    if (key) {
      const keyReference = key.fingerprint ?? key.name;
      dropletCommand.push(`--ssh-keys ${keyReference}`);
    } else if (input.configuration.sshKeyId) {
      dropletCommand.push(`--ssh-keys ${input.configuration.sshKeyId}`);
    }

    if (backups) {
      dropletCommand.push('--enable-backups');
    }
    if (monitoring) {
      dropletCommand.push('--enable-monitoring');
    }

    const userData = typeof input.configuration.userDataPath === 'string'
      ? input.configuration.userDataPath
      : undefined;
    if (userData) {
      dropletCommand.push(`--user-data-file ${userData}`);
    }

    steps.push({
      title: 'Create DigitalOcean droplet',
      command: dropletCommand.join(' '),
    });

    return {
      id: `${this.provider}-${Date.now()}`,
      provider: this.provider,
      summary: `Launch droplet ${input.name} (${size}) in ${region}`,
      steps,
    };
  }

  buildSshCommand(instance: InstanceDescriptor, key?: SshKeyMetadata): string | undefined {
    if (!instance.ipAddress) {
      return undefined;
    }
    const user = instance.tags?.sshUser ?? 'root';
    const identityArg = key ? `-i ${key.privateKeyPath}` : '';
    return `ssh ${identityArg} ${user}@${instance.ipAddress}`.trim();
  }
}
