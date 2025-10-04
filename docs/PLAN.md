# Cloud Deployment TUI Plan

## Vision and Goals
- Provide a unified terminal user interface (TUI) for provisioning, listing, and connecting to servers across AWS EC2, Google Cloud Compute Engine, Azure Virtual Machines, and DigitalOcean Droplets.
- Allow operators to manage reusable SSH keys for future sessions and automatically associate keys with instances.
- Present provider-agnostic workflows alongside provider specific configuration steps.
- Use **TypeScript** for implementation and build the TUI on top of the `open-tui` stack (React + tuir renderer) to satisfy the requested technology constraints.

## Functional Scope
1. **Workspace Overview**
   - Landing view summarising configured SSH keys and saved deployments per provider.
   - Quick actions to start new deployments or connect to existing hosts.
2. **Deployment Wizards**
   - Provider specific wizards gather minimal parameters (region, machine shape, image, auth key).
   - Each wizard produces an execution plan containing SDK calls/CLI commands (actual execution pluggable).
3. **Instance Access**
   - View active instances retrieved from remote provider (mocked initially, pluggable real implementations).
   - Trigger SSH connection command (opens `ssh` using stored keys).
4. **SSH Key Vault**
   - Secure storage of key metadata and paths (no private key contents stored) under `~/.config/cloud-orchestrator/config.json`.
   - Import new keys, mark default, associate keys with providers.
5. **Execution Backends**
   - Abstraction that can either produce CLI command sequences for manual execution or use cloud SDK APIs.
   - Provide placeholders for AWS SDK v3, Google Cloud API, Azure SDK, and DigitalOcean API integration.

## Architecture Overview
```
src/
 ├─ index.ts            # Application entrypoint, initializes stores and mounts the TUI
 ├─ ui/                 # React components rendered via open-tui/tuir
 │   ├─ App.tsx         # Layout shell and router between screens
 │   ├─ panes/          # Provider dashboards and forms
 │   └─ components/     # Reusable UI widgets (lists, forms, modals)
 ├─ services/
 │   ├─ deploymentService.ts   # Provider-agnostic orchestration
 │   ├─ providerClients.ts     # SDK/CLI adaptors per provider
 │   └─ sshService.ts          # Manage SSH key import, selection, and association
 ├─ providers/
 │   ├─ awsProvider.ts
 │   ├─ gcpProvider.ts
 │   ├─ azureProvider.ts
 │   └─ digitalOceanProvider.ts
 ├─ storage/
 │   └─ configStore.ts  # File-backed JSON store with schema validation
 ├─ types/
 │   └─ index.ts        # Shared types for deployments, keys, instances
 └─ utils/
     ├─ logger.ts       # Uniform logging utilities
     └─ ssh.ts          # Helper utilities for working with SSH keys
```

## Data Model
- `SshKeyMetadata`: { id, name, publicKeyPath, privateKeyPath, fingerprint, providers[] }
- `DeploymentProfile`: { id, provider, name, configuration, status, createdAt, lastUpdated }
- `InstanceDescriptor`: { id, provider, name, region, ipAddress, state, keyId }
- Configuration file persists arrays of keys and deployments plus preferences.

## Provider Strategy
- Each provider module exposes:
  - `createDeployment(config, sshKey)` → returns `DeploymentPlan` detailing API calls.
  - `listInstances()` → fetches current compute resources (mocked initial data from config file to avoid credentials).
  - `connect(instance, key)` → returns the shell command to run `ssh`.
- The plan executor (future work) may interpret `DeploymentPlan` to perform real operations using official SDKs; scaffolding includes typed placeholders and TODO comments.

## UI Flow
1. `App` displays summary and menu using open-tui Box/Flex components.
2. Selecting menu item pushes route in Zustand store.
3. Forms leverage React state; upon submission they call service layer to persist config and produce plan preview.
4. Instance list view polls provider service (using React Query) to show states.
5. SSH key manager view allows import (via path) and calculates fingerprint using `ssh-keygen -lf` (if available) or Node crypto fallback.

## CLI Commands
- `npm run build` → `tsc`
- `npm start` → `node dist/index.js`
- `npm run dev` → `ts-node src/index.ts`

## Testing Strategy
- Provide targeted unit tests for storage/service layers (future work; not in current scope).
- Manual QA via dev server to verify navigation and config persistence.

## Future Enhancements
- Real API integration with credential handling per provider.
- Support for multi-factor authentication and session caching.
- Bulk actions for scaling groups and deletion workflows.
- Integration with infrastructure-as-code templates (Terraform/CloudFormation).
- Role-based access and audit logging.
