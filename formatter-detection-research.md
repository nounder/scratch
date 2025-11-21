# Formatter Detection and Path Resolution in VS Code Extensions

## Research Summary: Prettier and dprint Extensions

This document explains how the VS Code extensions for Prettier and dprint detect and execute formatter-specific code, including their path resolution strategies.

---

## Prettier VS Code Extension

### Path Resolution Strategy (3-Tier System)

The Prettier extension (`prettier/prettier-vscode`) implements a cascading resolution approach:

#### 1. Local Project Dependencies (Highest Priority)
- **Location**: Searches in `node_modules` directory
- **Method**: Two complementary approaches:
  - **Approach A (Explicit)**: Searches for `package.json` files containing prettier in `dependencies` or `devDependencies`, then resolves via `resolve.sync()`
  - **Approach B (Implicit)**: Looks for prettier in `node_modules` directories without requiring explicit package.json declarations
- **Search Strategy**: Traverses upward through directory hierarchy from the file being formatted
- **Stops At**: Internal test roots to prevent escaping workspace context

**Key Code Pattern:**
```typescript
modulePath = prettierPath
  ? getWorkspaceRelativePath(fileName, prettierPath)
  : this.findPkg(fileName, "prettier");
```

#### 2. Global Module Resolution (Optional)
- **Enabled by**: `prettier.resolveGlobalModules` setting (disabled by default)
- **Process**:
  1. Detects active package manager (npm, yarn, pnpm) via VS Code command
  2. Queries global installation directory using `globalPathGet()`
  3. Checks if prettier exists in global modules path
- **Performance**: Disabled by default due to performance concerns

**Key Code Pattern:**
```typescript
const packageManager = await commands.executeCommand("npm.packageManager", workspaceFolder);
const resolvedGlobalPackageManagerPath = globalPathGet(packageManager);
const globalModulePath = path.join(resolvedGlobalPackageManagerPath, "prettier");
```

#### 3. Bundled Fallback
- **When Used**:
  - No local or global installation found
  - Workspace is untrusted
  - Module loading fails
- **Security**: Always used in untrusted workspaces for safety
- **Version**: Extension ships with a specific prettier version

### Configuration Settings

| Setting | Purpose | Security |
|---------|---------|----------|
| `prettier.prettierPath` | Custom path to prettier module | Disabled in untrusted workspaces |
| `prettier.resolveGlobalModules` | Enable global module resolution | Performance impact when enabled |
| `prettier.configPath` | Custom config file location | Overrides all other configs |
| `prettier.useEditorConfig` | Integrate with EditorConfig | Default: true |

### Version Detection & Execution Model

After finding prettier, the extension:
1. **Extracts version** from package.json via `loadPrettierVersionFromPackageJson()`
2. **Validates minimum version** (≥1.13.0)
3. **Selects execution model**:
   - **Version ≥3.1.1**: `PrettierWorkerInstance` (offthread execution)
   - **Earlier versions**: `PrettierMainThreadInstance` (main thread)

### Configuration Discovery

The extension uses Prettier's built-in `resolveConfigFile()` API:
```typescript
configPath = await prettierInstance.resolveConfigFile(fileName) ?? undefined;
```

Supports standard Prettier config formats:
- `.prettierrc`
- `.prettierrc.json`
- `.prettierrc.yml`
- `prettier.config.js`
- `package.json` (prettier field)

### Caching Strategy

- **Module caching**: Instances cached by path (`path2Module` Map)
- **Config caching**: Configurations cached to avoid repeated filesystem operations
- **Ignore paths**: `.prettierignore` paths cached per workspace

---

## dprint VS Code Extension

### Path Resolution Strategy (Priority Chain)

The dprint extension (`dprint/dprint-vscode`) uses a simpler priority-based chain:

#### Resolution Order

**Key Code Pattern:**
```typescript
static async resolveCmdPath(options: {
  cmdPath: string | undefined;
  cwd: vscode.Uri | undefined;
  logger: Logger;
  environment: Environment;
}) {
  return options.cmdPath != null
    ? getCommandNameOrAbsolutePath(options.cmdPath, options.cwd)
    : options.cwd != null
    ? await tryResolveNpmExecutable(options.cwd, options.environment, options.logger)
    : undefined;
}
```

#### 1. Explicit Custom Path (Highest Priority)
- **Setting**: `dprint.path`
- **Features**:
  - Supports home directory expansion (`~/`)
  - Includes executable name (e.g., on Windows: `C:\some-dir\dprint.exe`)
  - Supports folders with spaces
  - Relative paths (`./` or `../`) resolved relative to workspace

**Implementation:**
```typescript
function getCommandNameOrAbsolutePath(cmd: string, cwd: vscode.Uri | undefined) {
  if (cwd != null && (cmd.startsWith("./") || cmd.startsWith("../"))) {
    return vscode.Uri.joinPath(cwd, cmd).fsPath;
  }
  return cmd;
}
```

#### 2. NPM node_modules Resolution (Secondary)
- **When**: No explicit path but workspace directory available
- **Process**:
  1. Determines platform-specific package name via `getDprintPackageName()`
     - Linux: Includes distribution family
     - Others: Combines platform and architecture
  2. Searches node_modules recursively using `tryResolveInNodeModules()`
     - Starts in current directory's node_modules
     - Traverses up directory tree
  3. Reads package.json to extract version information

- **Windows-Specific**: Copies executable to temp directory to prevent file-locking issues

#### 3. System PATH (Fallback)
- **Default behavior**: Uses `dprint` command found on system PATH
- **When**: No custom path and node_modules resolution fails

#### 4. Undefined (No Options)
- Returns undefined if no working directory or custom path provided

### Executable Verification

After resolution, dprint is verified via version check:
```typescript
await this.#execShell([this.#cmdPath, "-v"], undefined, undefined)
```

### Configuration File Discovery

Unlike prettier, dprint automatically discovers configuration:
- **Files searched**: `dprint.json`, `dprint.jsonc`
- **Search strategy**:
  - Workspace folders
  - Ancestor directories (walks up)
  - Excludes `node_modules` directories
- **Plugin resolution**: Based on config file location in current workspace folder

### Operating Modes

The extension supports two backend modes:
- **LSP mode** (experimental): Uses Language Server Protocol
- **Legacy mode**: Direct executable invocation

Mode selected via `experimentalLsp` configuration setting.

---

## Key Differences

| Aspect | Prettier | dprint |
|--------|----------|--------|
| **Primary Strategy** | Local node_modules with two search approaches | Custom path → node_modules → PATH |
| **Global Resolution** | Optional, requires explicit setting | Not supported |
| **Bundled Version** | Yes, as fallback | No |
| **Platform-Specific** | Package manager detection | Platform-specific executable packages |
| **Execution Models** | Worker/Main thread based on version | Shell execution / LSP server |
| **Config Discovery** | Prettier's API (`resolveConfigFile`) | Custom search for .json/.jsonc |
| **Caching** | Extensive (modules, configs, ignores) | Basic (version info) |
| **Security** | Workspace trust integration | File locking handling (Windows) |
| **Source Files** | `src/ModuleResolver.ts` | `src/executable/DprintExecutable.ts`, `src/executable/npm.ts` |

---

## Best Practices for Extensions

Based on these implementations:

### 1. **Prioritize Local Installations**
Both extensions prefer project-local installations to ensure version consistency across team members.

### 2. **Support Multiple Resolution Paths**
Provide fallback strategies: custom paths → local → global → bundled

### 3. **Handle Security Concerns**
- Workspace trust integration
- User confirmation for loading external modules
- Restrict features in untrusted workspaces

### 4. **Platform-Specific Handling**
- Account for Windows executable extensions (.exe)
- Handle file locking (Windows-specific for dprint)
- Support different package managers (npm, yarn, pnpm)

### 5. **Performance Optimization**
- Cache resolved paths and configurations
- Make global resolution optional (performance impact)
- Use appropriate execution models (worker threads vs main thread)

### 6. **Clear Configuration Options**
Allow users to override auto-detection with explicit paths while maintaining sensible defaults.

---

## References

- **Prettier Extension**: https://github.com/prettier/prettier-vscode
  - Main file: `src/ModuleResolver.ts`
- **dprint Extension**: https://github.com/dprint/dprint-vscode
  - Main files: `src/executable/DprintExecutable.ts`, `src/executable/npm.ts`
