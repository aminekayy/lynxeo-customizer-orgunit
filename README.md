# lynxeo-customizer-orgunit

SailPoint Identity Security Cloud (ISC) **SaaS Connectivity customizer** for the **Web Services** connector. This project extends connector behavior by intercepting standard commands (for example account read and test connection) to enrich attributes, call external APIs, and adjust payloads before data flows between ISC and the connector.

> **Maintaining this document:** Update this README whenever you change setup steps, npm scripts, deployment flow, tenant/environment details, or security practices. Agents working in this repo are instructed to keep it in sync (see `.cursor/rules/readme.mdc`).

## Project structure

```
.
├── src/
│   ├── index.ts        # Customizer handlers (export: connectorCustomizer)
│   └── index.spec.ts   # Unit tests
├── package.json
├── tsconfig.json
└── dist/               # Build output (gitignored)
```

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| [Node.js](https://nodejs.org/) | LTS recommended; required for build, test, and packaging |
| PowerShell (Windows) | Default policy may block `npm.ps1`; see [Troubleshooting (Windows)](#troubleshooting-windows) |
| [SailPoint CLI](https://developer.sailpoint.com/docs/tools/cli/) (`sail`) | For tenant auth, listing customizers, upload, and linking |
| ISC tenant access | Sandbox/UAT tenant with rights to manage SaaS connector customizers |
| Personal Access Token (PAT) | [Create a PAT](https://developer.sailpoint.com/docs/api/authentication#generate-a-personal-access-token) for CLI authentication (do not commit secrets) |
| Target connector | Web Services SaaS connector on the native SaaS Connectivity framework |

Official references:

- [CLI — PAT authentication](https://developer.sailpoint.com/docs/tools/cli/#pat-authentication)
- [SaaS Connectivity customizers](https://developer.sailpoint.com/docs/connectivity/saas-connectivity/customizers/)

## Setup

### 1. Clone and branch

```powershell
git clone https://github.com/aminekayy/lynxeo-customizer-orgunit.git
cd lynxeo-customizer-orgunit
git checkout dev/customizer-orgunit
```

### 2. Install dependencies

```powershell
npm install
```

### 3. Configure SailPoint CLI (one-time per machine)

Create an environment (example name: `uat`):

```powershell
sail environment create uat
```

When prompted, use:

| Field | Value |
|-------|--------|
| Tenant URL | `https://lynxeogroup-sb.identitynow.com` |
| API URL | `https://lynxeogroup-sb.api.identitynow.com` |

Configure PAT and switch auth mode:

```powershell
sail set pat
sail set auth pat
sail environment use uat
```

Validate:

```powershell
sail --version
sail conn customizers list
```

PAT credentials are stored in local CLI config under your user profile (for example `%USERPROFILE%\.sailpoint\`). Never commit those files or paste secrets into this repository.

### 4. Initialize project (already done)

This repo was scaffolded with:

```powershell
sail conn customizers init lynxeo-customizer-orgunit
```

New clones only need `npm install` at the repository root.

## Local development

1. Edit handlers in `src/index.ts`. The entry point must export `connectorCustomizer` (see SailPoint customizer docs).
2. Build before running or packaging:

   ```powershell
   npm run build
   ```

3. Run unit tests:

   ```powershell
   npm run test
   ```

4. Optional local run/debug (requires a prior build):

   ```powershell
   npm run dev
   npm run debug
   ```

5. Format code:

   ```powershell
   npm run prettier
   ```

### Planned customizations (TODO in code)

- Create Account provisioning customization
- Call external endpoints
- Calculate / enrich attributes
- Return modified payloads per the SailPoint customizer pattern

## Build and package

| Script | Description |
|--------|-------------|
| `npm run build` | Cleans `dist/` and bundles `src/index.ts` with `ncc` |
| `npm run test` | Jest unit tests with coverage thresholds |
| `npm run pack-zip` | Runs `npm ci`, build, then `spcx package` to produce a deployable zip |

Full release artifact flow:

```powershell
npm run build
npm run test
npm run pack-zip
```

The packaged zip is written under this project directory (name/version from `package.json`). `*.zip` files are gitignored.

## Troubleshooting (Windows)

### `npm.ps1 cannot be loaded because running scripts is disabled`

PowerShell may block Node’s `npm.ps1` shim when the execution policy is `Restricted`.

**Fix (recommended, per user, no admin):**

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

Close and reopen the terminal, then run `npm` again.

**Workarounds (no policy change):**

```powershell
npm.cmd run build
npm.cmd run debug
```

Or use **Command Prompt** (`cmd.exe`) instead of PowerShell — `npm run …` works there via `npm.cmd`.

## Upload and linking (placeholders)

Perform these steps in your ISC tenant **after** `pack-zip` succeeds. Replace placeholders with your connector and customizer names.

### Upload customizer package

```powershell
# TODO: confirm exact flags for your CLI version
sail conn customizers upload <path-to-package.zip>
```

### Link customizer to Web Services source

```powershell
# TODO: link customizer to the target connector source (command/flags vary by CLI version)
sail conn customizers link --help
```

### Verify in tenant

```powershell
sail conn customizers list
```

Document the connector source name, customizer version, and link date here when configured:

| Item | Value |
|------|--------|
| ISC environment | `uat` (example) |
| Connector source | _TBD_ |
| Customizer version | `0.1.0` (from `package.json`) |
| Linked on | _TBD_ |

## Security notes

- **Never commit** PAT secrets, `.env` files, `node_modules/`, `dist/`, packaged `*.zip` files, or local SailPoint CLI credential stores.
- Store PAT **Client ID** and **Client Secret** only via `sail set pat` or CI secrets (for example `SAIL_CLIENT_ID`, `SAIL_CLIENT_SECRET`, `SAIL_BASE_URL`); see [CLI environment variables](https://developer.sailpoint.com/docs/tools/cli/#environment-variable-configuration).
- Do not log sensitive connector configuration or tokens from `readConfig()` in production handlers.
- Review packaged artifacts before upload; ensure test mocks and sample secrets in `src/index.spec.ts` are not shipped as real credentials.
- Limit PAT scopes and rotate tokens according to your organization’s security policy.
- Use the sandbox tenant (`lynxeogroup-sb`) for development; validate in non-production before production deployment.

## License

Private repository — internal use unless otherwise specified.
