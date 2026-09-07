import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

const latestReleaseApi = 'https://api.github.com/repos/xpagedeveloper/XPScript-visual-code-plugin/releases/latest';
const releasesPage = 'https://github.com/xpagedeveloper/XPScript-visual-code-plugin/releases/latest';

interface ReleaseAsset { name: string; browser_download_url: string; }
interface GitHubRelease {
  tag_name: string;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
  assets: ReleaseAsset[];
}

function versionParts(value: string): number[] {
  return value.replace(/^v/i, '').split('-')[0].split('.').map(part => Number.parseInt(part, 10) || 0);
}

function isNewerVersion(candidate: string, installed: string): boolean {
  const a = versionParts(candidate);
  const b = versionParts(installed);
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

async function latestRelease(): Promise<GitHubRelease> {
  const response = await fetch(latestReleaseApi, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'XPscript-VSCode-Extension' }
  });
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);
  return await response.json() as GitHubRelease;
}

function releaseAsset(release: GitHubRelease): ReleaseAsset | undefined {
  return release.assets.find(asset => /^xpscript-.*\.vsix$/i.test(asset.name))
    ?? release.assets.find(asset => /\.vsix$/i.test(asset.name));
}

async function installRelease(release: GitHubRelease): Promise<void> {
  const asset = releaseAsset(release);
  if (!asset) {
    const choice = await vscode.window.showErrorMessage(`XPscript ${release.tag_name} has no VSIX asset.`, 'Open release');
    if (choice === 'Open release') await vscode.env.openExternal(vscode.Uri.parse(release.html_url || releasesPage));
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Downloading XPscript ${release.tag_name}`, cancellable: false },
    async () => {
      const response = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'XPscript-VSCode-Extension' } });
      if (!response.ok) throw new Error(`VSIX download failed with HTTP ${response.status}.`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xpscript-update-'));
      const vsixPath = path.join(directory, asset.name);
      await fs.writeFile(vsixPath, bytes);
      await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(vsixPath));
    }
  );

  const reload = await vscode.window.showInformationMessage(
    `XPscript ${release.tag_name.replace(/^v/i, '')} is installed. Reload VS Code to activate the update.`,
    'Reload'
  );
  if (reload === 'Reload') await vscode.commands.executeCommand('workbench.action.reloadWindow');
}

export async function checkForUpdates(context: vscode.ExtensionContext, manual = false): Promise<void> {
  try {
    const release = await latestRelease();
    const installedVersion = context.extension.packageJSON.version as string;
    if (release.draft || release.prerelease || !isNewerVersion(release.tag_name, installedVersion)) {
      if (manual) await vscode.window.showInformationMessage(`XPscript ${installedVersion} is up to date.`);
      return;
    }

    const action = await vscode.window.showInformationMessage(
      `XPscript ${release.tag_name.replace(/^v/i, '')} is available. You have ${installedVersion}.`,
      'Update',
      'Release notes',
      'Later'
    );

    if (action === 'Update') {
      await installRelease(release);
    } else if (action === 'Release notes') {
      await vscode.env.openExternal(vscode.Uri.parse(release.html_url || releasesPage));
    }
  } catch (error) {
    if (manual) {
      const message = error instanceof Error ? error.message : String(error);
      await vscode.window.showErrorMessage(`XPscript update check failed: ${message}`);
    }
  }
}

export function scheduleAutomaticUpdateCheck(context: vscode.ExtensionContext): void {
  const enabled = vscode.workspace.getConfiguration('xpscript').get<boolean>('autoUpdate', true);
  if (!enabled) return;
  setTimeout(() => void checkForUpdates(context, false), 3000);
}
