import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Text,
  Viewport,
  useApp,
  useInput,
  Spacer,
} from 'tuir';
type InputKey = {
  ctrl?: boolean;
  return?: boolean;
  esc?: boolean;
  backspace?: boolean;
  tab?: boolean;
  up?: boolean;
  down?: boolean;
  left?: boolean;
  right?: boolean;
};
import { parseCommandLine } from '../utils/commandParser.js';
import { addSshKey, listSshKeys, removeSshKey, setDefaultKeyForProvider } from '../services/sshService.js';
import {
  buildSshCommandForInstance,
  createDeploymentProfile,
  listDeployments,
  listInstances,
  registerInstance,
  updateDeploymentStatus,
} from '../services/deploymentService.js';
import { CloudProvider, DeploymentProfile, InstanceDescriptor, SshKeyMetadata } from '../types/index.js';

interface Message {
  text: string;
  level: 'info' | 'success' | 'error';
}

const PANELS = ['deployments', 'instances', 'sshKeys'] as const;
type Panel = (typeof PANELS)[number];

type IndexState = Record<Panel, number>;

const HELP_TEXT = [
  'Commands:',
  '  help                                 Show this message',
  '  refresh                              Reload data from disk',
  '  add-key --name NAME --public PATH --private PATH --providers aws,gcp,... [--default-for PROVIDER]',
  '  remove-key KEY_ID',
  '  default-key PROVIDER KEY_ID',
  '  create-deployment --provider PROVIDER --name NAME [--key KEY_ID] [--region REGION] [...]',
  '     Use --config.KEY VALUE to provide arbitrary configuration entries.',
  '  status DEPLOYMENT_ID STATUS           Update deployment status',
  '  register-instance --id ID --provider PROVIDER --name NAME --region REGION --ip ADDRESS [--state STATE] [--key KEY_ID]',
  '  ssh-command INSTANCE_ID               Display SSH command for an instance',
  'Enter command mode by pressing : and exit with Esc.',
];

export function App(): React.ReactNode {
  const app = useApp();
  const [deployments, setDeployments] = useState<DeploymentProfile[]>([]);
  const [instances, setInstances] = useState<InstanceDescriptor[]>([]);
  const [sshKeys, setSshKeys] = useState<SshKeyMetadata[]>([]);
  const [selectedPanelIndex, setSelectedPanelIndex] = useState<number>(0);
  const [selectedIndices, setSelectedIndices] = useState<IndexState>({
    deployments: 0,
    instances: 0,
    sshKeys: 0,
  });
  const [messages, setMessages] = useState<Message[]>([{
    text: 'Press : to open the command palette. Use arrow keys to navigate panels.',
    level: 'info',
  }]);
  const [commandMode, setCommandMode] = useState(false);
  const [commandBuffer, setCommandBuffer] = useState('');

  const pushMessage = useCallback((text: string, level: Message['level'] = 'info') => {
    setMessages((prev) => {
      const next = [...prev, { text, level }];
      return next.slice(-12);
    });
  }, []);

  const refreshData = useCallback(async () => {
    try {
      const [nextDeployments, nextInstances, nextKeys] = await Promise.all([
        listDeployments(),
        listInstances(),
        listSshKeys(),
      ]);
      setDeployments(nextDeployments);
      setInstances(nextInstances);
      setSshKeys(nextKeys);
      setSelectedIndices((prev) => ({
        deployments: clampIndex(prev.deployments, nextDeployments.length),
        instances: clampIndex(prev.instances, nextInstances.length),
        sshKeys: clampIndex(prev.sshKeys, nextKeys.length),
      }));
    } catch (error) {
      pushMessage(`Failed to refresh data: ${(error as Error).message}`, 'error');
    }
  }, [pushMessage]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  const handleCommand = useCallback(async (raw: string) => {
    const parsed = parseCommandLine(raw);
    if (!parsed) {
      return;
    }

    const { command, args, options } = parsed;
    try {
      switch (command) {
        case 'help':
          HELP_TEXT.forEach((line) => pushMessage(line));
          break;
        case 'refresh':
          await refreshData();
          pushMessage('Data refreshed.', 'success');
          break;
        case 'add-key': {
          const name = String(options.name ?? options.n ?? '');
          const publicKeyPath = String(options.public ?? options.pub ?? '');
          const privateKeyPath = String(options.private ?? options.pri ?? '');
          const providersValue = String(options.providers ?? options.provider ?? '');
          if (!name || !publicKeyPath || !privateKeyPath || !providersValue) {
            throw new Error('name, public, private, and providers options are required.');
          }
          const providers = providersValue.split(',').map((item) => item.trim()).filter(Boolean) as CloudProvider[];
          const key = await addSshKey({
            name,
            publicKeyPath,
            privateKeyPath,
            providers,
          });
          if (options['default-for']) {
            const provider = options['default-for'];
            await setDefaultKeyForProvider(key.id, provider as CloudProvider);
          }
          await refreshData();
          pushMessage(`SSH key ${key.name} added.`, 'success');
          break;
        }
        case 'remove-key': {
          const keyId = args[0] ?? String(options.id ?? '');
          if (!keyId) {
            throw new Error('Key ID is required.');
          }
          await removeSshKey(keyId);
          await refreshData();
          pushMessage(`Removed SSH key ${keyId}.`, 'success');
          break;
        }
        case 'default-key': {
          const provider = (args[0] ?? options.provider) as CloudProvider | undefined;
          const keyId = args[1] ?? String(options.key ?? '');
          if (!provider || !keyId) {
            throw new Error('Usage: default-key <provider> <keyId>');
          }
          await setDefaultKeyForProvider(keyId, provider);
          await refreshData();
          pushMessage(`Set key ${keyId} as default for ${provider}.`, 'success');
          break;
        }
        case 'create-deployment': {
          const provider = (options.provider ?? options.p ?? '') as CloudProvider;
          const name = String(options.name ?? options.n ?? '');
          if (!provider || !name) {
            throw new Error('provider and name options are required.');
          }
          const configuration = buildConfiguration(options);
          const deploymentInput = {
            provider,
            name,
            configuration,
            ...(options.key ? { sshKeyId: String(options.key) } : {}),
          };
          const result = await createDeploymentProfile(deploymentInput);
          await refreshData();
          pushMessage(`Deployment plan created for ${name}.`, 'success');
          pushMessage(`Plan summary: ${result.plan.summary}`);
          result.plan.steps.forEach((step, index) => {
            const commandText = step.command ? ` → ${step.command}` : step.description ? ` → ${step.description}` : '';
            pushMessage(` ${index + 1}. ${step.title}${commandText}`);
          });
          break;
        }
        case 'status': {
          const deploymentId = args[0];
          const status = args[1];
          if (!deploymentId || !status) {
            throw new Error('Usage: status <deploymentId> <status>');
          }
          await updateDeploymentStatus(deploymentId, status as any);
          await refreshData();
          pushMessage(`Deployment ${deploymentId} updated to ${status}.`, 'success');
          break;
        }
        case 'register-instance': {
          const provider = (options.provider ?? options.p ?? '') as CloudProvider;
          const id = String(options.id ?? args[0] ?? '');
          const name = String(options.name ?? options.n ?? '');
          const region = String(options.region ?? options.r ?? '');
          const ipAddress = options.ip ? String(options.ip) : undefined;
          const state = options.state ? String(options.state) : 'running';
          const sshKeyId = options.key ? String(options.key) : undefined;
          if (!id || !provider || !name || !region) {
            throw new Error('id, provider, name, and region options are required.');
          }
          const instanceRecord: InstanceDescriptor = {
            id,
            provider,
            name,
            region,
            state: state as InstanceDescriptor['state'],
            createdAt: new Date().toISOString(),
            ...(ipAddress ? { ipAddress } : {}),
            ...(sshKeyId ? { sshKeyId } : {}),
          };
          await registerInstance(instanceRecord);
          await refreshData();
          pushMessage(`Instance ${id} registered.`, 'success');
          break;
        }
        case 'ssh-command': {
          const instanceId = args[0] ?? String(options.id ?? '');
          if (!instanceId) {
            throw new Error('Instance ID is required.');
          }
          const commandLine = await buildSshCommandForInstance(instanceId);
          if (!commandLine) {
            pushMessage(`Unable to build SSH command for ${instanceId}.`, 'error');
          } else {
            pushMessage(`SSH command: ${commandLine}`);
          }
          break;
        }
        default:
          pushMessage(`Unknown command: ${command}`, 'error');
          break;
      }
    } catch (error) {
      pushMessage(`Command error: ${(error as Error).message}`, 'error');
    }
  }, [pushMessage, refreshData]);

  useInput((input: string, key: InputKey) => {
    if (key.ctrl && input === 'c') {
      app.exit();
      return;
    }

    if (commandMode) {
      if (key.return) {
        const trimmed = commandBuffer.trim();
        if (trimmed.length > 0) {
          void handleCommand(trimmed);
        }
        setCommandBuffer('');
        setCommandMode(false);
        return;
      }
      if (key.esc) {
        setCommandMode(false);
        setCommandBuffer('');
        return;
      }
      if (key.backspace) {
        setCommandBuffer((prev) => prev.slice(0, -1));
        return;
      }
      if (input && !key.return && !key.tab) {
        setCommandBuffer((prev) => prev + input);
      }
      return;
    }

    if (input === ':') {
      setCommandMode(true);
      setCommandBuffer('');
      return;
    }

    const panelId = PANELS[selectedPanelIndex] ?? PANELS[0];

    if (key.left) {
      setSelectedPanelIndex((prev) => (prev - 1 + PANELS.length) % PANELS.length);
      return;
    }
    if (key.right) {
      setSelectedPanelIndex((prev) => (prev + 1) % PANELS.length);
      return;
    }
    if (key.up || input === 'k') {
      setSelectedIndices((prev) => {
        const next = { ...prev };
        const current = next[panelId];
        next[panelId] = current > 0 ? current - 1 : current;
        return next;
      });
      return;
    }
    if (key.down || input === 'j') {
      const length = getPanelLength(panelId, deployments, instances, sshKeys);
      setSelectedIndices((prev) => {
        const next = { ...prev };
        const current = next[panelId];
        next[panelId] = current + 1 < length ? current + 1 : current;
        return next;
      });
    }
  }, {
    isActive: true,
  });

  const menuHighlight = selectedPanelIndex;
  const panelSummaries = useMemo(() => ({
    deployments: deployments.length === 0
      ? 'No deployment plans yet.'
      : `${deployments.length} plans` ,
    instances: instances.length === 0 ? 'No instances tracked.' : `${instances.length} instances`,
    sshKeys: sshKeys.length === 0 ? 'No SSH keys stored.' : `${sshKeys.length} keys`,
  }), [deployments.length, instances.length, sshKeys.length]);

  return (
    <Viewport>
      <Box flexDirection="column" height="100%" width="100%" padding={1} gap={1}>
        <Box flexDirection="row" gap={1} flexGrow={1}>
          <PanelView
            title="Deployments"
            isActive={menuHighlight === 0}
            summary={panelSummaries.deployments}
            items={deployments.map((deployment) => `${deployment.name} (${deployment.provider}) - ${deployment.status}`)}
            selectedIndex={selectedIndices.deployments}
          />
          <PanelView
            title="Instances"
            isActive={menuHighlight === 1}
            summary={panelSummaries.instances}
            items={instances.map((instance) => formatInstanceRow(instance))}
            selectedIndex={selectedIndices.instances}
          />
          <PanelView
            title="SSH Keys"
            isActive={menuHighlight === 2}
            summary={panelSummaries.sshKeys}
            items={sshKeys.map((key) => formatKeyRow(key))}
            selectedIndex={selectedIndices.sshKeys}
          />
        </Box>
        <DetailsBar
          panel={PANELS[selectedPanelIndex] ?? PANELS[0]}
          deployments={deployments}
          instances={instances}
          sshKeys={sshKeys}
          selectedIndices={selectedIndices}
        />
        <MessageLog messages={messages} />
        <CommandBar commandMode={commandMode} buffer={commandBuffer} />
      </Box>
    </Viewport>
  );
}

interface PanelViewProps {
  title: string;
  summary: string;
  isActive: boolean;
  items: string[];
  selectedIndex: number;
}

function PanelView({ title, summary, isActive, items, selectedIndex }: PanelViewProps): React.ReactNode {
  const titleProps = isActive ? { color: 'cyan' as const } : {};
  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={isActive ? 'cyan' : 'gray'} padding={1}>
      <Text {...titleProps} bold>{title}</Text>
      <Text dimColor>{summary}</Text>
      <Box flexDirection="column" marginTop={1} gap={0}>
        {items.length === 0 ? (
          <Text dimColor>No entries.</Text>
        ) : (
          items.map((item, index) => (
            <Text
              key={item}
              {...(index === selectedIndex && isActive ? { color: 'cyan' as const } : {})}
            >
              {index === selectedIndex && isActive ? '› ' : '  '}
              {item}
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}

interface MessageLogProps {
  messages: Message[];
}

function MessageLog({ messages }: MessageLogProps): React.ReactNode {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" padding={1} height={8}>
      <Text bold>Activity</Text>
      {messages.slice(-6).map((message, index) => (
        <Text
          key={`${message.text}-${index}`}
          {...(message.level === 'error'
            ? { color: 'red' as const }
            : message.level === 'success'
              ? { color: 'green' as const }
              : {})}
        >
          {message.text}
        </Text>
      ))}
    </Box>
  );
}

interface CommandBarProps {
  commandMode: boolean;
  buffer: string;
}

function CommandBar({ commandMode, buffer }: CommandBarProps): React.ReactNode {
  return (
    <Box flexDirection="row" borderStyle="round" borderColor={commandMode ? 'cyan' : 'gray'} paddingX={1} paddingY={0}>
      <Text {...(commandMode ? { color: 'cyan' as const } : {})}>{commandMode ? ':' : 'Command'}</Text>
      <Spacer />
      <Text>{commandMode ? buffer : 'Press : to enter a command'}</Text>
    </Box>
  );
}

interface DetailsBarProps {
  panel: Panel;
  deployments: DeploymentProfile[];
  instances: InstanceDescriptor[];
  sshKeys: SshKeyMetadata[];
  selectedIndices: IndexState;
}

function DetailsBar({ panel, deployments, instances, sshKeys, selectedIndices }: DetailsBarProps): React.ReactNode {
  let title = 'Details';
  let lines: string[] = [];

  if (panel === 'deployments') {
    const deployment = deployments[selectedIndices.deployments];
    if (deployment) {
      title = `Deployment ${deployment.name}`;
      lines = [
        `Provider: ${deployment.provider}`,
        `Status: ${deployment.status}`,
        `Created: ${new Date(deployment.createdAt).toLocaleString()}`,
        `Last update: ${new Date(deployment.updatedAt).toLocaleString()}`,
      ];
    }
  } else if (panel === 'instances') {
    const instance = instances[selectedIndices.instances];
    if (instance) {
      title = `Instance ${instance.name}`;
      lines = [
        `Provider: ${instance.provider}`,
        `Region: ${instance.region}`,
        `State: ${instance.state}`,
        `IP: ${instance.ipAddress ?? 'unknown'}`,
      ];
    }
  } else if (panel === 'sshKeys') {
    const key = sshKeys[selectedIndices.sshKeys];
    if (key) {
      title = `SSH Key ${key.name}`;
      lines = [
        `Providers: ${key.providers.join(', ') || 'none'}`,
        `Fingerprint: ${key.fingerprint ?? 'unknown'}`,
        `Default for: ${key.defaultFor?.join(', ') ?? 'none'}`,
      ];
    }
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" padding={1}>
      <Text bold>{title}</Text>
      {lines.length === 0 ? <Text dimColor>No selection.</Text> : lines.map((line) => <Text key={line}>{line}</Text>)}
    </Box>
  );
}

function formatInstanceRow(instance: InstanceDescriptor): string {
  const name = instance.name ?? instance.id;
  const state = instance.state ?? 'unknown';
  const ip = instance.ipAddress ?? 'pending';
  return `${name} (${instance.provider}) - ${state} @ ${ip}`;
}

function formatKeyRow(key: SshKeyMetadata): string {
  return `${key.name} [${key.providers.join(', ')}]`;
}

function clampIndex(index: number, length: number): number {
  if (length === 0) {
    return 0;
  }
  if (index >= length) {
    return length - 1;
  }
  if (index < 0) {
    return 0;
  }
  return index;
}

function getPanelLength(
  panel: Panel,
  deployments: DeploymentProfile[],
  instances: InstanceDescriptor[],
  sshKeys: SshKeyMetadata[],
): number {
  switch (panel) {
    case 'deployments':
      return deployments.length;
    case 'instances':
      return instances.length;
    case 'sshKeys':
      return sshKeys.length;
    default:
      return 0;
  }
}

function buildConfiguration(options: Record<string, string | boolean>): Record<string, unknown> {
  const configuration: Record<string, unknown> = {};
  const skipKeys = new Set(['provider', 'p', 'name', 'n', 'key', 'providers', 'public', 'private', 'default-for']);
  for (const [rawKey, rawValue] of Object.entries(options)) {
    if (skipKeys.has(rawKey)) {
      continue;
    }
    const value = parseValue(rawValue);
    if (rawKey.startsWith('config.')) {
      configuration[rawKey.slice('config.'.length)] = value;
      continue;
    }
    const camelKey = rawKey.replace(/-([a-z])/g, (_match, char: string) => char.toUpperCase());
    configuration[camelKey] = value;
  }
  return configuration;
}

function parseValue(value: string | boolean): unknown {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  const numeric = Number(value);
  if (!Number.isNaN(numeric) && value.trim() !== '') {
    return numeric;
  }
  if (value.includes(',')) {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return value;
}

export default App;
