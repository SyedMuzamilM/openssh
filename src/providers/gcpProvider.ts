import { DeploymentPlan, DeploymentStep, InstanceDescriptor, SshKeyMetadata } from '../types/index.js';
import { ProviderAdapter, ProviderDeploymentInput } from './providerRegistry.js';

function normalise(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

export class GcpProviderAdapter implements ProviderAdapter {
  readonly provider = 'gcp';

  createDeploymentPlan(input: ProviderDeploymentInput, key?: SshKeyMetadata): DeploymentPlan {
    const project = normalise(input.configuration.projectId, 'my-gcp-project');
    const zone = normalise(input.configuration.zone, 'us-central1-a');
    const machineType = normalise(input.configuration.machineType, 'e2-medium');
    const imageFamily = normalise(input.configuration.imageFamily, 'debian-12');
    const imageProject = normalise(input.configuration.imageProject, 'debian-cloud');
    const network = normalise(input.configuration.network ?? input.configuration.networkInterface, 'default');
    const subnetwork = typeof input.configuration.subnetwork === 'string'
      ? input.configuration.subnetwork
      : undefined;
    const serviceAccount = typeof input.configuration.serviceAccount === 'string'
      ? input.configuration.serviceAccount
      : 'default';
    const tags = (input.configuration.tags as string[] | undefined) ?? ['ssh'];
    const metadata = buildMetadata(key, input);

    const steps: DeploymentStep[] = [];

    if (key) {
      steps.push({
        title: 'Add SSH key metadata to project',
        description: 'Ensure the instance metadata includes the SSH public key for OS Login or direct login.',
        command: `gcloud compute project-info add-metadata --project=${project} --metadata "ssh-keys=${buildGcpMetadataEntry(key)}"`,
      });
    }

    const createParts = [
      'gcloud compute instances create',
      input.name,
      `--project=${project}`,
      `--zone=${zone}`,
      `--machine-type=${machineType}`,
      `--image-family=${imageFamily}`,
      `--image-project=${imageProject}`,
      `--network=${network}`,
      `--tags=${tags.join(',')}`,
      `--service-account=${serviceAccount}`,
    ];

    if (subnetwork) {
      createParts.push(`--subnet=${subnetwork}`);
    }

    if (metadata) {
      createParts.push(`--metadata=${metadata}`);
    }

    steps.push({
      title: 'Provision Compute Engine VM',
      command: createParts.join(' '),
    });

    return {
      id: `${this.provider}-${Date.now()}`,
      provider: this.provider,
      summary: `Launch ${input.name} in ${zone} (${machineType})`,
      steps,
    };
  }

  buildSshCommand(instance: InstanceDescriptor, key?: SshKeyMetadata): string | undefined {
    if (!instance.name) {
      return undefined;
    }
    const zone = instance.tags?.zone ?? 'us-central1-a';
    const project = instance.tags?.projectId ?? 'my-gcp-project';
    const identityArg = key ? `-i ${key.privateKeyPath}` : '';
    return `gcloud compute ssh ${identityArg} ${instance.name} --project=${project} --zone=${zone}`.trim();
  }
}

function buildMetadata(key: SshKeyMetadata | undefined, input: ProviderDeploymentInput): string | undefined {
  const metadataEntries: string[] = [];
  if (key) {
    metadataEntries.push(`ssh-keys=${buildGcpMetadataEntry(key)}`);
  }
  const userMetadata = input.configuration.metadata as Record<string, string> | undefined;
  if (userMetadata) {
    metadataEntries.push(
      Object.entries(userMetadata)
        .map(([k, v]) => `${k}=${v}`)
        .join(','),
    );
  }
  if (metadataEntries.length === 0) {
    return undefined;
  }
  return metadataEntries.join(',');
}

function buildGcpMetadataEntry(key: SshKeyMetadata): string {
  const username = key.name.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase() || 'clouduser';
  return `${username}:$(cat ${key.publicKeyPath})`;
}
