# Build and release XPscript VS Code plugin

This document is for maintainers of the XPscript Visual Studio Code extension.

## Local deployment build

Install dependencies:

```bash
npm install
```

Build and package the extension:

```bash
npm run package
```

The build process:

1. generates the IntelliSense catalog from the XPscript repository and documentation
2. applies the current public API synchronization and help metadata
3. compiles the TypeScript extension
4. packages the extension as a VSIX

The resulting deployment package is written to:

```text
publish/xpscript.vsix
```

If the XPscript source repository is not available in the default relative location, set `XPSCRIPT_REPO_PATH` to the XPscript checkout before running the package command.

Example:

```bash
XPSCRIPT_REPO_PATH=/path/to/XPscript npm run package
```

## Continuous integration build

`.github/workflows/publish.yml` runs for pushes and pull requests against `main`.

The workflow:

1. checks out this plugin repository
2. checks out the current `xpagedeveloper/XPscript` `main` branch
3. installs Node.js dependencies
4. generates the IntelliSense catalog
5. compiles the extension
6. packages `publish/xpscript.vsix`
7. uploads the `publish` directory as a GitHub Actions artifact

The CI artifact is intended for build validation and testing. Public deployment packages are published through GitHub Releases.

## Release versioning

The release version is controlled by the `version` field in `package.json`.

Example:

```json
"version": "0.2.0"
```

Before publishing a new version, update `package.json`, commit the change, and merge it to `main`.

Use semantic versioning for releases:

```text
0.1.0
0.2.0
1.0.0
```

## Automatic GitHub Release

`.github/workflows/release.yml` runs on pushes to `main` and can also be started manually from GitHub Actions.

For the current version in `package.json`, the workflow checks whether release `v<version>` already exists.

If the release already exists, the workflow exits without publishing another copy.

If it does not exist, the workflow:

1. resolves the version from `package.json`
2. checks out the current XPscript source repository
3. installs dependencies
4. regenerates the current IntelliSense catalog
5. compiles and packages the extension
6. renames the VSIX to `xpscript-<version>.vsix`
7. creates tag `v<version>` if it does not already exist
8. creates the GitHub Release
9. generates release notes
10. attaches `xpscript-<version>.vsix` to the release

Example:

```text
package.json version: 0.2.0
Git tag:              v0.2.0
Release asset:        xpscript-0.2.0.vsix
```

A manual local `git tag` is therefore not required for the normal release flow.

## Publishing a new release

1. Change the version in `package.json`.
2. Commit the version change on a feature branch.
3. Open and validate the pull request.
4. Merge the pull request to `main`.
5. GitHub Actions detects that `v<version>` has no release yet.
6. The release workflow builds and publishes the new VSIX automatically.
7. Verify the release under the repository's **Releases** page.

Do not reuse an existing version number for a different build. Increase the version before publishing another release.

## Manual release workflow run

The release workflow supports `workflow_dispatch`.

Use this when a release failed after the code was already merged to `main`.

In GitHub:

1. Open **Actions**.
2. Select **Release XPscript VS Code plugin**.
3. Select **Run workflow**.
4. Run it against `main`.

The workflow remains idempotent. If the release for the current package version already exists, it does not publish another release.

## Install the deployment build for testing

After producing a local or CI VSIX, install it with:

```bash
code --install-extension publish/xpscript.vsix --force
```

For a downloaded release package:

```bash
code --install-extension xpscript-<version>.vsix --force
```

Opening an `.xps` file should then activate the XPscript extension automatically.
