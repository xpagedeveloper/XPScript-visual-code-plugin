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

## Maintainer documentation

Build, deployment and release instructions are documented in [`scripts/Build.md`](scripts/Build.md).
