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

- Continue hardening Create Account and Account Update behavior after tenant validation
- Add focused tests for OrgUnitLink lookup behavior on create and update
- Confirm whether Account Update runtime payloads include current account `attributes` for fallback values
- Replace temporary diagnostic logging with production-safe messages where needed

### Current Create Account behavior

`beforeStdAccountCreate` enriches Create Account payloads before the Web Services connector submits them:

- Reads the Web Services base URL and Create Account `Authorization` header from the SailPoint customizer runtime config.
- Sets `input.attributes.OrgUnitLink` to an empty value by default.
- Uses `contractSiteCode` and `actualLocationCode` when both are present.
- Skips the OrgUnit lookup and leaves `OrgUnitLink` empty when either value is missing or blank.
- Computes the organizational unit name as `<contractSiteCode>-<actualLocationCode>` when both values are present.
- Calls `/api/odata/businessobject/organizationalunits` and selects `RecId` for the matching organizational unit.
- Writes the resolved OrgUnit `RecId` to `input.attributes.OrgUnitLink` only when the lookup returns HTTP 200 with a non-empty `RecId`.
- Leaves `OrgUnitLink` empty if the lookup fails, returns a non-200 response, or does not include a usable `RecId`.

If the account create payload itself has no `attributes` object, the customizer throws a `ConnectorError` because there is no payload to enrich.

### Current Account Update behavior

`beforeStdAccountUpdate` resolves the Ivanti employee `RecId` and enriches OrgUnit changes when location data changes:

- Resolves the employee `RecId` from the account `identity`/LoginID via `/api/odata/businessobject/employees`.
- Adds or updates a `RecId` change with `op: Set` before the connector sends the update payload.
- Runs the OrgUnitLink lookup only when `actualLocationCode` or `contractSiteCode` appears in `input.changes`.
- Uses the newest value from `input.changes` for changed attributes.
- Falls back to current account `attributes` when one of the two source values is not part of the current change payload, if SailPoint includes those attributes in the update runtime payload.
- Computes the organizational unit name as `<contractSiteCode>-<actualLocationCode>` when both source values are available.
- Calls `/api/odata/businessobject/organizationalunits` and selects `RecId` for the matching organizational unit.
- Adds or updates an `OrgUnitLink` change with `op: Set` using the SailPoint SDK `AttributeChangeOp.Set` enum only when a non-empty OrgUnit `RecId` is resolved.
- Leaves the original update payload unchanged if either source value is missing, the lookup fails, returns non-200, or does not include a usable `RecId`.

### Current Enable Account behavior

Enable Account is handled in two steps:

- `beforeStdAccountEnable` captures the LoginID from `input.key.simple.id` or `input.identity`.
- `Enable Account:before` resolves the employee `RecId` from that LoginID.
- The outbound Web Services request URL is rewritten to `/api/odata/businessobject/employees('<RecId>')`.
- The request body is replaced with `{"Status":"Active","Disabled":false}`.
- A `ConnectorError` is thrown if the LoginID cannot be captured or the employee `RecId` cannot be resolved.

### Current Disable Account behavior

Disable Account follows the same RecId-based URL rewrite as Enable Account:

- `beforeStdAccountDisable` captures the LoginID from `input.key.simple.id` or `input.identity`.
- `Disable Account:before` resolves the employee `RecId` from that LoginID.
- The outbound Web Services request URL is rewritten to `/api/odata/businessobject/employees('<RecId>')`.
- The request body is replaced with `{"Status":"Terminated","Disabled":true}`.
- A `ConnectorError` is thrown if the LoginID cannot be captured or the employee `RecId` cannot be resolved.

### Current Single Account Aggregation behavior

Single Account Aggregation rewrites the read request so Ivanti is queried by LoginID:

- `beforeStdAccountRead` captures the LoginID from `input.identity` or `input.key.simple.id`.
- `Single Account Aggregation:before` builds the final request URL as `/api/odata/businessobject/employees?$filter=loginID eq '<LoginID>'`.
- If no LoginID was captured directly for the read, it can reuse the LoginID captured during the preceding Enable or Disable Account flow.
- The captured LoginID variables are cleared after the URL is rewritten.
- A `ConnectorError` is thrown if no LoginID is available or `genericWebServiceBaseUrl` is missing.

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
| Customizer version | `1.2.2` (from `package.json`) |
| Linked on | _TBD_ |

## Security notes

- **Never commit** PAT secrets, `.env` files, `node_modules/`, `dist/`, packaged `*.zip` files, or local SailPoint CLI credential stores.
- Store PAT **Client ID** and **Client Secret** only via `sail set pat` or CI secrets (for example `SAIL_CLIENT_ID`, `SAIL_CLIENT_SECRET`, `SAIL_BASE_URL`); see [CLI environment variables](https://developer.sailpoint.com/docs/tools/cli/#environment-variable-configuration).
- Do not log sensitive connector configuration or tokens from `readConfig()` in production handlers.
- Review Create Account and Account Update diagnostic logs before production use; account attributes can contain sensitive identity data.
- Review packaged artifacts before upload; ensure test mocks and sample secrets in `src/index.spec.ts` are not shipped as real credentials.
- Limit PAT scopes and rotate tokens according to your organization’s security policy.
- Use the sandbox tenant (`lynxeogroup-sb`) for development; validate in non-production before production deployment.

## License

Private repository — internal use unless otherwise specified.
