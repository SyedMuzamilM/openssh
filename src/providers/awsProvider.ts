import { DeploymentPlan, DeploymentStep, InstanceDescriptor, SshKeyMetadata } from '../types/index.js';
import { ProviderAdapter, ProviderDeploymentInput } from './providerRegistry.js';

function normalise(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

export class AwsProviderAdapter implements ProviderAdapter {
  readonly provider = 'aws';

  createDeploymentPlan(input: ProviderDeploymentInput, key?: SshKeyMetadata): DeploymentPlan {
    const region = normalise(input.configuration.region, 'us-east-1');
    const instanceType = normalise(input.configuration.instanceType, 't3.micro');
    const ami = normalise(input.configuration.ami, 'ami-latest');
    const securityGroup = normalise(
      input.configuration.securityGroup ?? input.configuration.securityGroupId,
      `${input.name}-sg`,
    );
    const subnetId = typeof input.configuration.subnetId === 'string' ? input.configuration.subnetId : undefined;
    const volumeSize = typeof input.configuration.volumeSize === 'number'
      ? input.configuration.volumeSize
      : Number.parseInt(String(input.configuration.volumeSize ?? ''), 10) || 20;
    const sshKeyName = normalise(
      input.configuration.sshKeyName,
      key?.name ? key.name.replace(/\s+/g, '-') : `${input.name}-key`,
    );
    const tags = (input.configuration.tags as Record<string, string> | undefined) ?? {};
    const userDataPath = typeof input.configuration.userDataPath === 'string'
      ? input.configuration.userDataPath
      : undefined;

    const steps: DeploymentStep[] = [];

    if (key) {
      steps.push({
        title: 'Ensure EC2 key pair exists',
        description: 'Import the SSH public key into AWS EC2 so that the instance trusts it.',
        command: `aws ec2 import-key-pair --key-name ${sshKeyName} --public-key-material "$(cat ${key.publicKeyPath})" --region ${region}`,
      });
    }

    steps.push({
      title: 'Create or validate security group',
      description: 'Ensure the security group allows SSH (port 22) from trusted CIDRs.',
      command: `aws ec2 create-security-group --group-name ${securityGroup} --description "SSH access for ${input.name}" --region ${region}`,
    });

    steps.push({
      title: 'Authorize SSH ingress',
      command: `aws ec2 authorize-security-group-ingress --group-name ${securityGroup} --protocol tcp --port 22 --cidr 0.0.0.0/0 --region ${region}`,
    });

    const runArgs = [
      'aws ec2 run-instances',
      `--image-id ${ami}`,
      `--instance-type ${instanceType}`,
      `--region ${region}`,
      `--key-name ${sshKeyName}`,
      `--security-groups ${securityGroup}`,
      `--block-device-mappings DeviceName=/dev/sda1,Ebs={VolumeSize=${volumeSize}}`,
      `--tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${input.name}}${formatTagSpec(tags)}]"`,
    ];

    if (subnetId) {
      runArgs.push(`--subnet-id ${subnetId}`);
    }

    if (userDataPath) {
      runArgs.push(`--user-data file://${userDataPath}`);
    }

    steps.push({
      title: 'Launch EC2 instance',
      command: runArgs.join(' '),
    });

    return {
      id: `${this.provider}-${Date.now()}`,
      provider: this.provider,
      summary: `Launch ${input.name} in ${region} using ${instanceType}`,
      steps,
    };
  }

  buildSshCommand(instance: InstanceDescriptor, key?: SshKeyMetadata): string | undefined {
    if (!instance.ipAddress) {
      return undefined;
    }
    const sshUser = typeof instance.tags?.sshUser === 'string'
      ? instance.tags?.sshUser
      : 'ec2-user';
    const identityArg = key ? `-i ${key.privateKeyPath}` : '';
    return `ssh ${identityArg} ${sshUser}@${instance.ipAddress}`.trim();
  }
}

function formatTagSpec(tags: Record<string, string>): string {
  const formatted = Object.entries(tags)
    .map(([Key, Value]) => `{Key=${Key},Value=${Value}}`)
    .join(',');
  if (!formatted) {
    return '';
  }
  return `,{Key=Project,Value=CloudOrchestrator},${formatted}`;
}
