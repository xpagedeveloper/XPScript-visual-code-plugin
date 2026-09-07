# XPscript for Visual Studio Code

Visual Studio Code language support for XPscript.

The extension provides:

- IntelliSense/autocomplete for the documented XPscript API
- parameter and help text from the XPscript documentation
- hover help and signature help
- semantic syntax highlighting for XPscript classes, functions, methods, properties, variables and parameters
- highlighting for verified `Notes*` classes and members
- automatic XPscript language activation for `.xps` and `.xpscript` files

## Install

### 1. Download the VSIX

Open the repository's **Releases** page on GitHub and download the `.vsix` file from the latest release.

The release asset is named similar to:

```text
xpscript-0.1.0.vsix
```

### 2. Install in Visual Studio Code

In Visual Studio Code:

1. Open **Extensions**.
2. Select the `...` menu in the Extensions view.
3. Select **Install from VSIX...**.
4. Select the downloaded `xpscript-<version>.vsix` file.
5. Reload Visual Studio Code if prompted.

You can also use the Command Palette and run:

```text
Extensions: Install from VSIX...
```

### Install from the command line

If the `code` command is available in your shell:

```bash
code --install-extension xpscript-0.1.0.vsix
```

To install or replace an existing version without a confirmation prompt:

```bash
code --install-extension xpscript-0.1.0.vsix --force
```

## `.xps` files

The extension registers `.xps` as an XPscript file extension.

Opening a file such as:

```text
application.xps
```

causes Visual Studio Code to select the `xpscript` language automatically. The extension activates through `onLanguage:xpscript`, so autocomplete, hover help, signature help and semantic highlighting become available without running a command manually.

The extension also supports `.xpscript` files.

You can verify the selected language in the Visual Studio Code status bar. It should show **XPscript** while an `.xps` file is active.

## Update

VS Code does not automatically update extensions that were manually installed from a VSIX by default.

To update XPscript support:

1. Open the repository's **Releases** page.
2. Download the `.vsix` file from the newest release.
3. Install it again using **Extensions: Install from VSIX...**.
4. Reload Visual Studio Code if prompted.

Or update from the command line:

```bash
code --install-extension xpscript-<version>.vsix --force
```

The new VSIX replaces the installed version.

## Check the installed version

From a terminal:

```bash
code --list-extensions --show-versions
```

Look for:

```text
xpagedeveloper.xpscript@<version>
```

You can also open the Extensions view in Visual Studio Code and inspect the installed XPscript extension.

## Uninstall

From Visual Studio Code, open **Extensions**, find **XPscript**, and select **Uninstall**.

From the command line:

```bash
code --uninstall-extension xpagedeveloper.xpscript
```

## Creating a release

Releases are built by GitHub Actions from version tags.

Before creating a release, update the `version` field in `package.json`. For example:

```json
"version": "0.2.0"
```

Commit and merge that change to `main`, then create and push a matching tag:

```bash
git checkout main
git pull
git tag v0.2.0
git push origin v0.2.0
```

The tag must match the package version exactly, with a leading `v` on the Git tag.

Examples:

```text
package.json: 0.2.0  -> tag: v0.2.0
package.json: 1.0.0  -> tag: v1.0.0
```

When a matching `v*` tag is pushed, `.github/workflows/release.yml`:

1. checks out the plugin at that tag
2. checks out the current XPscript source repository
3. verifies that the tag matches `package.json`
4. generates the current IntelliSense catalog
5. compiles the TypeScript extension
6. packages the extension as a VSIX
7. creates a GitHub Release with generated release notes
8. attaches `xpscript-<version>.vsix` to the release

If the tag and package version differ, the release workflow fails instead of publishing an incorrectly versioned VSIX.

## Development builds

The normal build workflow runs for pushes and pull requests against `main` and uploads the packaged VSIX as a GitHub Actions artifact.

For a local build:

```bash
npm install
npm run package
```

The VSIX is written to:

```text
publish/xpscript.vsix
```

The build-time IntelliSense catalog is generated from the XPscript repository and its documentation.
