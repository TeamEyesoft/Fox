# Fox

An NPM registry facade on top of GitLab releases, fully compatible with the **Unity Package Manager**.

Fox maps a set of configured GitLab projects to NPM packages. For each project it reads the releases from the GitLab API, exposes them as versioned NPM packages, and proxies tarball downloads — all without any authentication on the registry side, making it suitable for private networks.

## How it works

1. At startup Fox reads your `fox.config.json` and resolves each project's package name from its root `package.json` (the standard Unity package manifest).
2. When Unity queries the registry, Fox fetches the project's releases from GitLab and builds NPM-compatible package manifests on the fly.
3. Responses are cached in memory for a configurable TTL to avoid hammering the GitLab API.
4. Tarball downloads are proxied directly from GitLab release assets.

## Web UI

Fox includes a built-in web interface to browse available packages and configure Unity Package Manager. Visit the registry URL in your browser to see all packages with their versions, descriptions, Unity compatibility info, and dependencies.

- **Browse packages**: View all available packages in a clean, responsive interface
- **Package details**: See Unity-specific metadata, dependencies, and version history
- **Unity configuration generator**: Automatically generates the complete `scopedRegistries` configuration for your Unity project's `Packages/manifest.json`
- **Copy install commands**: One-click copy of dependency entries for Unity's `manifest.json`
- **Copy Unity config**: One-click copy of the entire registry configuration block
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

### Tarball assets

Fox looks for a `.tgz` release asset link in each GitLab release. For Unity Package Manager compatibility the tarball must be structured with a `package/` root directory — this is the standard output of `npm pack` run inside a Unity package folder.

If no `.tgz` asset is found Fox falls back to the GitLab source archive, but **Unity will likely reject it** because the archive root is the project folder, not `package/`. Upload a correctly structured `.tgz` as a release asset to avoid this.

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
| `GET` | `/-/all` | List all packages (used by Unity for package discovery) |
| `GET` | `/:name` | Package manifest with all available versions |
| `GET` | `/:name/:version` | Single version manifest |
| `GET` | `/:name/-/:name-:version.tgz` | Tarball download (proxied from GitLab) |
