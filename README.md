# Fox

An NPM registry facade on top of GitLab releases, fully compatible with the **Unity Package Manager**.

Fox maps a set of configured GitLab projects to NPM packages. For each project it reads the releases from the GitLab API, exposes them as versioned NPM packages, and proxies tarball downloads — all without any authentication on the registry side, making it suitable for private networks.

## How it works

1. At startup Fox reads your `fox.config.json` and resolves each project's package name from its root `package.json` (the standard Unity package manifest).
2. When Unity queries the registry, Fox fetches the project's GitLab releases and builds NPM-compatible package manifests on the fly.
3. Responses are cached in memory for a configurable TTL to avoid hammering the GitLab API.
4. Tarball downloads are served from the GitLab source archive for the tagged commit, repackaged on the fly for Unity compatibility (see [Tarball repackaging](#tarball-repackaging)).
5. Projects with no releases yet still appear in the web UI with their metadata and a "No release published yet" warning, but are not visible to Unity Package Manager.

## Web UI

Fox includes a built-in web interface to browse available packages and configure Unity Package Manager. Visit the registry URL in your browser to see all packages with their versions, descriptions, Unity compatibility info, and dependencies.

- **Browse packages**: View all available packages in a clean, responsive interface
- **Package details**: See Unity-specific metadata, dependencies, and version history
- **GitLab links**: Each package card has a direct link to the source project on GitLab
- **Unity configuration generator**: Automatically generates the complete `scopedRegistries` configuration for your Unity project's `Packages/manifest.json`
- **Copy install commands**: One-click copy of dependency entries for Unity's `manifest.json`
- **Copy Unity config**: One-click copy of the entire registry configuration block
- **Dark/light theme**: Toggle between themes; preference is remembered in the browser
- **Real-time updates**: Refresh button to fetch the latest packages from GitLab

Access the UI at:
- `http://your-server:3000/` (root)
- `http://your-server:3000/ui` (alternative path)

## Requirements

- [Bun](https://bun.sh) 1.x
- A GitLab instance (gitlab.com or self-hosted)
- A GitLab personal access token or deploy token with `read_api` scope

## Configuration

Copy the example config and fill in your values:

```bash
cp fox.config.example.json fox.config.json
```

```jsonc
// fox.config.json
{
  "port": 3000,
  "gitlab": {
    "baseUrl": "https://gitlab.com",
    "token": "glpat-xxxxxxxxxxxxxxxxxxxx"   // or use GITLAB_TOKEN env var
  },
  "registry": {
    "baseUrl": "http://your-server:3000",   // public URL Unity will use for tarball links
    "ttlSeconds": 60                        // how long to cache GitLab API responses
  },
  "projects": [
    {
      "id": 12345678                        // GitLab project ID
    },
    {
      "id": "mygroup/my-unity-package",     // or namespace/path
      "nameOverride": "com.mycompany.mypackage"  // optional: override the package name
    }
  ]
}
```

The config file path can be overridden with the `FOX_CONFIG` environment variable. The GitLab token can be provided via the `GITLAB_TOKEN` environment variable instead of the config file.

### Package name resolution

Fox resolves the NPM package name for each project in this order:

1. `nameOverride` in the config, if set
2. The `name` field in the project's root `package.json` (standard for Unity packages)
3. The GitLab project path as a fallback

### Tarball repackaging

Fox always downloads the GitLab source archive for the tagged commit and repackages it on the fly into an NPM-compatible tarball. The repackager:

- Renames the archive root directory to `package/` (required by npm/Unity)
- Patches the `version` field inside `package/package.json` to match the registry version, preventing mismatches when a developer commits a future version number before tagging

## Development

Install dependencies:

```bash
bun install
```

Start the development server with hot reload:

```bash
bun run dev
```

### Code formatting and linting

This project uses [Biome.js](https://biomejs.dev) for fast formatting and linting:

```bash
# Format code
bun run format

# Check formatting without changes
bun run format:check

# Lint code
bun run lint

# Lint and auto-fix issues
bun run lint:fix

# Check both formatting and linting
bun run check

# Check and auto-fix everything
bun run check:fix
```

### Pre-commit hooks

Install the pre-commit hook to automatically check code quality and scan for secrets:

```bash
# Install gitleaks for secret scanning
brew install gitleaks

# Install the git hook
bun run install-hooks
```

The hook runs biome checks and gitleaks on staged files before each commit.

## Docker

```bash
docker build -t fox .

docker run -p 3000:3000 \
  -v ./fox.config.json:/config/fox.config.json:ro \
  -e GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx \
  fox
```

The container expects the config file at `/config/fox.config.json` by default (set via the `FOX_CONFIG` env var).

## Unity Package Manager setup

### Editing `manifest.json`

Open `Packages/manifest.json` at the root of your Unity project and add a `scopedRegistries` entry pointing to your Fox instance. The `scopes` array tells Unity which package name prefixes to route through Fox — any package whose name starts with one of those prefixes will be resolved from Fox instead of the default Unity registry.

```json
{
  "scopedRegistries": [
    {
      "name": "Fox",
      "url": "http://your-server:3000",
      "scopes": [
        "com.mycompany"
      ]
    }
  ],
  "dependencies": {}
}
```

You can list multiple scopes if your packages span more than one prefix:

```json
"scopes": [
  "com.mycompany",
  "com.anotherteam"
]
```

You can also register multiple independent Fox instances (e.g. one per team or environment) as separate entries in the `scopedRegistries` array, each with their own `url` and `scopes`.

### Using the Package Manager window

Once `manifest.json` is saved, Unity will reload the project. Your packages will then appear under **Window → Package Manager → My Registries**. From there you can browse available versions and install or update packages just like any other Unity package.

### Installing a specific version manually

You can also pin a package to a specific version by adding it directly to the `dependencies` object in `manifest.json`:

```json
"dependencies": {
  "com.mycompany.mypackage": "1.2.3"
}
```

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/healthz` | Health check — returns `{"status":"ok"}` |
| `GET` | `/` or `/ui` | Web UI (package browser) |
| `GET` | `/.well-known/config` | Registry base URL and feature flags (used by the web UI) |
| `POST` | `/-/reload` | Reload projects from the external projects file (no-op if not configured) |
| `GET` | `/-/all` | All package manifests — used by Unity for package discovery |
| `GET` | `/:name` | Full packument: all versions and metadata for a package |
| `GET` | `/:name/:version` | Single version manifest |
| `GET` | `/:name/-/:name-:version.tgz` | Tarball download (repackaged from GitLab source archive) |
