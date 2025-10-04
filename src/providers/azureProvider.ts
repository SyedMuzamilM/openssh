import { DeploymentPlan, DeploymentStep, InstanceDescriptor, SshKeyMetadata } from '../types/index.js';
import { ProviderAdapter, ProviderDeploymentInput } from './providerRegistry.js';

function normalise(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

export class AzureProviderAdapter implements ProviderAdapter {
  readonly provider = 'azure';

  createDeploymentPlan(input: ProviderDeploymentInput, key?: SshKeyMetadata): DeploymentPlan {
    const resourceGroup = normalise(input.configuration.resourceGroup, `${input.name}-rg`);
    const location = normalise(input.configuration.location, 'eastus');
    const vmSize = normalise(input.configuration.vmSize ?? input.configuration.instanceSize, 'Standard_B2s');
    const image = normalise(input.configuration.image, 'Ubuntu2204');
    const adminUser = normalise(input.configuration.adminUser ?? input.configuration.sshUser, 'azureuser');
    const virtualNetwork = normalise(input.configuration.virtualNetwork ?? input.configuration.vnet, `${input.name}-vnet`);
    const subnet = normalise(input.configuration.subnet ?? input.configuration.subnetName, `${input.name}-subnet`);
    const nsg = normalise(input.configuration.networkSecurityGroup ?? input.configuration.nsg, `${input.name}-nsg`);
    const tags = buildTagString(input.configuration.tags as Record<string, string> | undefined);

    const steps: DeploymentStep[] = [];

    steps.push({
      title: 'Create or update resource group',
      command: `az group create --name ${resourceGroup} --location ${location}`,
    });

    steps.push({
      title: 'Ensure virtual network exists',
      command: `az network vnet create --resource-group ${resourceGroup} --name ${virtualNetwork} --address-prefix 10.0.0.0/16 --subnet-name ${subnet} --subnet-prefix 10.0.0.0/24`,
    });

    steps.push({
      title: 'Configure network security group for SSH',
      command: `az network nsg create --resource-group ${resourceGroup} --name ${nsg}`,
    });

    steps.push({
      title: 'Allow SSH inbound traffic',
      command: `az network nsg rule create --resource-group ${resourceGroup} --nsg-name ${nsg} --name AllowSSH --priority 1000 --access Allow --protocol Tcp --direction Inbound --source-address-prefixes '*' --source-port-ranges '*' --destination-port-ranges 22`,
    });

    const vmCommand = [
      'az vm create',
      `--resource-group ${resourceGroup}`,
      `--name ${input.name}`,
      `--image ${image}`,
      `--size ${vmSize}`,
      `--admin-username ${adminUser}`,
      `--nsg ${nsg}`,
      `--vnet-name ${virtualNetwork}`,
      `--subnet ${subnet}`,
      '--public-ip-sku Standard',
    ];

    if (key) {
      vmCommand.push(`--ssh-key-values "$(cat ${key.publicKeyPath})"`);
    }

    if (tags) {
      vmCommand.push(`--tags ${tags}`);
    }

    const customData = typeof input.configuration.cloudInitPath === 'string'
      ? input.configuration.cloudInitPath
      : undefined;

    if (customData) {
      vmCommand.push(`--custom-data ${customData}`);
    }

    steps.push({
      title: 'Provision Azure VM',
      command: vmCommand.join(' '),
    });

    return {
      id: `${this.provider}-${Date.now()}`,
      provider: this.provider,
      summary: `Provision ${input.name} (${vmSize}) in ${location}`,
      steps,
    };
  }

  buildSshCommand(instance: InstanceDescriptor, key?: SshKeyMetadata): string | undefined {
    if (!instance.ipAddress) {
      return undefined;
    }
    const user = instance.tags?.adminUser ?? 'azureuser';
    const identityArg = key ? `-i ${key.privateKeyPath}` : '';
    return `ssh ${identityArg} ${user}@${instance.ipAddress}`.trim();
  }
}

function buildTagString(tags: Record<string, string> | undefined): string | undefined {
  if (!tags) {
    return undefined;
  }
  return Object.entries(tags)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
}
