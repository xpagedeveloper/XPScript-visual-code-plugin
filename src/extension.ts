import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { getCompletions, getHover, getSignatureHelp } from './languageService';
import { semanticTokensLegend, XPScriptSemanticTokensProvider } from './semanticTokens';
import { checkForUpdates, scheduleAutomaticUpdateCheck } from './updater';
import { XPScriptDebugConfigurationProvider } from './debugger/debugConfiguration';
import { XPScriptDebugAdapterDescriptorFactory } from './debugger/debugAdapter';

function canStartExecutable(executable:string):Promise<boolean>{return new Promise(resolve=>execFile(executable,['--help'],{windowsHide:true,timeout:5000},error=>resolve(!error)));}
async function selectXPScriptExecutable():Promise<string|undefined>{const configuration=vscode.workspace.getConfiguration('xpscript');const configured=configuration.get<string>('debugExecutable')?.trim()??'';const selected=await vscode.window.showOpenDialog({title:'Choose XPscript executable',defaultUri:configured?vscode.Uri.file(configured):undefined,canSelectFiles:true,canSelectFolders:false,canSelectMany:false,openLabel:'Use XPscript executable',filters:process.platform==='win32'?{'XPscript executable':['exe']}:undefined});const executable=selected?.[0]?.fsPath;if(!executable)return undefined;if(!(await canStartExecutable(executable))){await vscode.window.showErrorMessage(`The selected file could not be started as XPscript: ${executable}`);return undefined;}await configuration.update('debugExecutable',executable,vscode.ConfigurationTarget.Global);await vscode.window.showInformationMessage(`XPscript executable set to: ${executable}`);return executable;}
async function resolveXPScriptExecutable():Promise<string|undefined>{const configuration=vscode.workspace.getConfiguration('xpscript');const configured=configuration.get<string>('debugExecutable')?.trim()??'';if(configured){if(await canStartExecutable(configured))return configured;const choice=await vscode.window.showWarningMessage(`The configured XPscript executable could not be started: ${configured}`,'Choose xpscript executable','Cancel');return choice==='Choose xpscript executable'?selectXPScriptExecutable():undefined;}if(await canStartExecutable('xpscript'))return 'xpscript';const choice=await vscode.window.showInformationMessage('XPscript was not found in PATH. Choose the XPscript executable once and the extension will remember it.','Choose xpscript executable','Cancel');return choice==='Choose xpscript executable'?selectXPScriptExecutable():undefined;}
async function startCurrentFile(noDebug:boolean):Promise<void>{const editor=vscode.window.activeTextEditor;if(!editor||editor.document.languageId!=='xpscript'){await vscode.window.showErrorMessage('Open an XPscript source file before starting it.');return;}if(editor.document.isUntitled){await vscode.window.showErrorMessage('Save the XPscript source file before starting it.');return;}if(editor.document.isDirty&&!(await editor.document.save())){await vscode.window.showErrorMessage('The XPscript source file could not be saved.');return;}const executable=await resolveXPScriptExecutable();if(!executable)return;const configuration:vscode.DebugConfiguration={type:'xpscript',request:'launch',name:noDebug?'Run current XPscript file':'Debug current XPscript file',program:editor.document.uri.fsPath,target:'cli',stopOnEntry:false,executable,noDebug};const folder=vscode.workspace.getWorkspaceFolder(editor.document.uri);const started=await vscode.debug.startDebugging(folder,configuration,{noDebug});if(!started)await vscode.window.showErrorMessage(`Unable to ${noDebug?'run':'debug'} the current XPscript file.`);}

export function activate(context:vscode.ExtensionContext):void{
 const selector:vscode.DocumentSelector={language:'xpscript'};
 const status=vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left,90);status.command='xpscript.quickActions';status.tooltip='XPscript run, debug and settings';
 const updateStatus=()=>{const editor=vscode.window.activeTextEditor;const xp=editor?.document.languageId==='xpscript';if(!xp){status.hide();return;}const session=vscode.debug.activeDebugSession;if(session?.type==='xpscript'){status.text=session.configuration.noDebug?'$(play) XPscript: Running':'$(debug-alt) XPscript: Debugging';}else status.text='$(code) XPscript: Ready';status.show();};
 const refresh=vscode.commands.registerCommand('xpscript.refreshApiIndex',async()=>{await vscode.window.showInformationMessage('XPscript IntelliSense catalog is generated from the XPscript documentation during build. Rebuild the extension to refresh it.');});
 const checkUpdates=vscode.commands.registerCommand('xpscript.checkForUpdates',async()=>checkForUpdates(context,true));
 const selectExecutable=vscode.commands.registerCommand('xpscript.selectExecutable',async()=>selectXPScriptExecutable());
 const openSettings=vscode.commands.registerCommand('xpscript.openSettings',async()=>vscode.commands.executeCommand('workbench.action.openSettings','@ext:xpagedeveloper.xpscript'));
 const debugCurrentFile=vscode.commands.registerCommand('xpscript.debugCurrentFile',async()=>startCurrentFile(false));
 const runCurrentFile=vscode.commands.registerCommand('xpscript.runCurrentFile',async()=>startCurrentFile(true));
 const quickActions=vscode.commands.registerCommand('xpscript.quickActions',async()=>{const pick=await vscode.window.showQuickPick([{label:'$(debug-alt) Debug Current File',command:'xpscript.debugCurrentFile'},{label:'$(play) Run Current File',command:'xpscript.runCurrentFile'},{label:'$(file-binary) Select XPscript Executable',command:'xpscript.selectExecutable'},{label:'$(gear) XPscript Settings',command:'xpscript.openSettings'}],{placeHolder:'XPscript'});if(pick)await vscode.commands.executeCommand(pick.command);});
 const completions=vscode.languages.registerCompletionItemProvider(selector,{provideCompletionItems:getCompletions},'.','(',',',' ');
 const hover=vscode.languages.registerHoverProvider(selector,{provideHover:getHover});
 const signatures=vscode.languages.registerSignatureHelpProvider(selector,{provideSignatureHelp:getSignatureHelp},'(',',');
 const semanticTokens=vscode.languages.registerDocumentSemanticTokensProvider(selector,new XPScriptSemanticTokensProvider(),semanticTokensLegend);
 const debugConfiguration=vscode.debug.registerDebugConfigurationProvider('xpscript',new XPScriptDebugConfigurationProvider());
 const debugAdapter=vscode.debug.registerDebugAdapterDescriptorFactory('xpscript',new XPScriptDebugAdapterDescriptorFactory());
 const activeEditor=vscode.window.onDidChangeActiveTextEditor(updateStatus);
 const startSession=vscode.debug.onDidStartDebugSession(session=>{if(session.type==='xpscript')updateStatus();});
 const stopSession=vscode.debug.onDidTerminateDebugSession(session=>{if(session.type==='xpscript')updateStatus();});
 const customEvent=vscode.debug.onDidReceiveDebugSessionCustomEvent(event=>{if(event.session.type==='xpscript'&&event.event==='stopped'){status.text='$(debug-pause) XPscript: Paused';status.show();}});
 context.subscriptions.push(status,refresh,checkUpdates,selectExecutable,openSettings,debugCurrentFile,runCurrentFile,quickActions,completions,hover,signatures,semanticTokens,debugConfiguration,debugAdapter,activeEditor,startSession,stopSession,customEvent);updateStatus();scheduleAutomaticUpdateCheck(context);
}
export function deactivate():void{}
