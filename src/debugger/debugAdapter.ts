import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';
import * as path from 'path';
import { XPScriptRuntimeClient, RuntimeStoppedEvent, RuntimeMessage, RuntimeStackFrame, RuntimeValueChange } from './runtimeClient';

interface XPScriptDebugConfig extends vscode.DebugConfiguration {
  program?: string; target?: 'cli'|'desktop'|'web'|'wasm'; host?: string; port?: number; token?: string;
  stopOnEntry?: boolean; executable?: string; args?: string[]; noDebug?: boolean;
}

interface ConditionalBreakpointResult { matched:boolean; error?:string; }
interface PendingBreakpointSet { source:string; lines:number[]; }

export class XPScriptDebugAdapter implements vscode.DebugAdapter {
  private readonly emitter = new vscode.EventEmitter<any>();
  private sequence=1; private client:XPScriptRuntimeClient|undefined; private process:ChildProcess|undefined;
  private currentSource=''; private currentLine=1; private currentFrames:RuntimeStackFrame[]=[]; private currentException:RuntimeStoppedEvent|undefined;
  private config:XPScriptDebugConfig|undefined; private heldEntryStop=false; private terminated=false; private nextVariableReference=2000;
  private readonly historyReferences=new Map<number,string>(); private readonly currentValues=new Map<string,RuntimeValueChange>(); private readonly debuggerVariableNames=new Set<string>();
  private readonly breakpointConditions=new Map<string,string>();
  private readonly breakpointSets=new Map<string,PendingBreakpointSet>();
  public readonly onDidSendMessage=this.emitter.event;
  public handleMessage(message:any):void { void this.handleRequest(message).catch(error=>this.respond(message,undefined,false,error instanceof Error?error.message:String(error))); }
  public dispose():void { this.client?.dispose(); this.process?.kill(); this.emitter.dispose(); }

  private async handleRequest(request:any):Promise<void> {
    switch(request.command) {
      case 'initialize': this.respond(request,{supportsConfigurationDoneRequest:true,supportsConditionalBreakpoints:true,supportsEvaluateForHovers:true,supportsStepBack:false,supportsTerminateRequest:true,supportsDataBreakpoints:true,supportsExceptionInfoRequest:true,exceptionBreakpointFilters:[{filter:'uncaught',label:'Uncaught XPscript exceptions',default:true},{filter:'all',label:'All XPscript exceptions',default:false}]}); this.event('initialized'); return;
      case 'launch': await this.launch(request.arguments as XPScriptDebugConfig); this.respond(request); return;
      case 'attach': await this.attach(request.arguments as XPScriptDebugConfig); this.respond(request); return;
      case 'setBreakpoints': {
        const source=request.arguments?.source?.path??''; const requested=(request.arguments?.breakpoints??[]) as Array<{line:number;condition?:string}>;
        const executableLines=this.executableLines(source); const resolved=requested.map(item=>this.resolveBreakpointLine(item.line,executableLines));
        this.clearBreakpointConditionsForSource(source);
        requested.forEach((item,index)=>{const condition=String(item.condition??'').trim();if(condition&&resolved[index]>0)this.breakpointConditions.set(this.breakpointKey(source,resolved[index]),condition);});
        this.breakpointSets.set(this.breakpointSourceKey(source),{source,lines:resolved});
        this.client?.setBreakpoints(source,resolved);
        this.respond(request,{breakpoints:requested.map((item,index)=>({verified:resolved[index]>0,line:resolved[index]||item.line,source:request.arguments?.source,message:resolved[index]!==item.line?`Moved to executable XPscript line ${resolved[index]}.`:undefined}))}); return;
      }
      case 'setExceptionBreakpoints': { const filters=((request.arguments?.filters??[]) as string[]).filter(v=>v==='all'||v==='uncaught'); this.client?.setExceptionBreakpoints(filters); this.respond(request); return; }
      case 'exceptionInfo': { const e=this.currentException; this.respond(request,{exceptionId:e?.exceptionId??'XPscript exception',description:e?.description??'XPscript exception',breakMode:e?.breakMode??'unhandled'}); return; }
      case 'dataBreakpointInfo': { const name=String(request.arguments?.name??'').trim(); await this.refreshCurrentValues(); const observed=this.currentValues.get(name.toLowerCase()); if(!name||!observed){this.respond(request,{dataId:null,description:name?`${name} is not an observed XPscript value.`:'No XPscript variable selected.',canPersist:false});return;} this.respond(request,{dataId:observed.Name,description:`Break when ${observed.Name} changes`,accessTypes:['write'],canPersist:true}); return; }
      case 'setDataBreakpoints': { const requested=(request.arguments?.breakpoints??[]) as Array<{dataId?:string;accessType?:string}>; const names=requested.filter(i=>!i.accessType||i.accessType==='write').map(i=>String(i.dataId??'').trim()).filter(Boolean); this.client?.setDataBreakpoints(names); this.respond(request,{breakpoints:requested.map(i=>({verified:Boolean(i.dataId)&&(!i.accessType||i.accessType==='write'),message:i.accessType&&i.accessType!=='write'?'XPscript currently supports data breakpoints on writes only.':undefined}))}); return; }
      case 'configurationDone': this.respond(request); if(this.heldEntryStop){this.heldEntryStop=false;this.client?.continue();} return;
      case 'threads': this.respond(request,{threads:[{id:1,name:'XPscript main'}]}); return;
      case 'stackTrace': { const frames=this.currentFrames.length?this.currentFrames:[{id:1,name:'XPscript',source:this.currentSource,line:this.currentLine,column:1}]; this.respond(request,{stackFrames:frames.map(f=>({id:f.id,name:f.name,line:f.line,column:f.column||1,source:f.source?{name:this.fileName(f.source),path:this.resolveSourcePath(f.source)}:undefined})),totalFrames:frames.length}); return; }
      case 'scopes': this.respond(request,{scopes:[{name:'Locals',variablesReference:1000,expensive:false},{name:'Debugger Variables',variablesReference:1002,expensive:false},{name:'Runtime',variablesReference:1001,expensive:false}]}); return;
      case 'variables': {
        const ref=request.arguments?.variablesReference;
        if(ref===1000){await this.refreshCurrentValues();await this.refreshDebuggerVariableNames();const variables=[...this.currentValues.values()].filter(i=>!this.debuggerVariableNames.has(i.Name.toLowerCase())).sort((a,b)=>a.Name.localeCompare(b.Name,undefined,{sensitivity:'base'})).map(i=>({name:i.Name,value:i.NewValue,type:'observed scalar',variablesReference:this.historyReference(i.Name),evaluateName:i.Name}));this.respond(request,{variables});return;}
        if(ref===1002){const response=await this.client?.debuggerVariables();const variables=(response?.items??[]).slice().sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'})).map(i=>({name:i.name,value:i.value,type:'Debugger.UpdateVar',variablesReference:this.historyReference(i.name),evaluateName:i.name}));this.respond(request,{variables});return;}
        if(ref===1001){this.respond(request,{variables:[{name:'Source',value:this.currentSource||'<unknown>',variablesReference:0},{name:'Line',value:String(this.currentLine),variablesReference:0},{name:'Target',value:this.config?.target??'cli',variablesReference:0},{name:'Call depth',value:String(this.currentFrames.length||1),variablesReference:0}]});return;}
        const historyName=this.historyReferences.get(ref); if(historyName){const response=await this.client?.valueHistory(historyName);const items=(response?.items??[]).slice().reverse();this.respond(request,{variables:items.map((i,index)=>({name:`#${items.length-index} ${this.fileName(i.Source)}:${i.Line}`,value:`${i.OldValue} -> ${i.NewValue}`,type:i.Procedure,variablesReference:0,presentationHint:{kind:'data',attributes:['readOnly']}}))});return;} this.respond(request,{variables:[]}); return;
      }
      case 'evaluate': { const expression=String(request.arguments?.expression??'').trim(); const history=/^@?history(?:\(([^)]+)\)|\s+(.+))$/i.exec(expression); if(history){const name=(history[1]??history[2]??'').trim();const response=await this.client?.valueHistory(name);const items=response?.items??[];const result=items.length===0?`No recorded value changes for ${name}.`:items.slice().reverse().map(i=>`${this.fileName(i.Source)}:${i.Line} ${i.Procedure}: ${i.OldValue} -> ${i.NewValue}`).join('\n');this.respond(request,{result,variablesReference:0});return;} await this.refreshCurrentValues();const observed=this.currentValues.get(expression.toLowerCase());this.respond(request,{result:observed?.NewValue??`No observed value for ${expression}. Use history(variable) for tracked changes.`,variablesReference:observed?this.historyReference(observed.Name):0});return; }
      case 'continue': this.client?.continue();this.respond(request,{allThreadsContinued:true});return; case 'next':this.client?.next();this.respond(request);return; case 'stepIn':this.client?.stepIn();this.respond(request);return; case 'stepOut':this.client?.stepOut();this.respond(request);return; case 'pause':this.client?.pause();this.respond(request);return;
      case 'disconnect': case 'terminate': this.client?.disconnect();this.process?.kill();this.respond(request);this.terminateOnce();return;
      default:this.respond(request);
    }
  }

  private async launch(config:XPScriptDebugConfig):Promise<void> {
    this.config=config; if(!config.program) throw new Error('XPscript launch requires a program.'); if(config.target==='web'||config.target==='wasm') throw new Error(`Use attach debugging for XPscript ${config.target} targets.`);
    const executable=config.executable||vscode.workspace.getConfiguration('xpscript').get<string>('debugExecutable')||'xpscript';
    if(config.noDebug){ this.event('output',{category:'console',output:`Running ${this.fileName(config.program)} without debugger.\n`}); await this.spawnProcess(executable,['run',config.program,...(config.args??[])],process.env); return; }
    const port=config.port??await this.findPort(); const token=config.token??randomBytes(24).toString('hex'); const args=['run',config.program,'--debug',...(config.args??[])];
    const env={...process.env,XPSCRIPT_DEBUG_PORT:String(port),XPSCRIPT_DEBUG_TOKEN:token,XPSCRIPT_DEBUG_STOP_ON_ENTRY:'1'};
    this.event('output',{category:'console',output:`Starting XPscript debugger on 127.0.0.1:${port}. First launch may compile the script before the debugger port opens.\n`});
    const started=this.spawnProcess(executable,args,env);
    try { await Promise.all([started,this.connect(config.host??'127.0.0.1',port,token,60000)]); }
    catch(error){ this.process?.kill(); const message=error instanceof Error?error.message:String(error); throw new Error(`XPscript started but the debugger could not connect. ${message} Check that this xpscript executable supports the debugger, then choose another executable in XPscript settings or retry.`); }
  }

  private async spawnProcess(executable:string,args:string[],env:NodeJS.ProcessEnv):Promise<void>{
    return new Promise((resolve,reject)=>{ let settled=false; const child=spawn(executable,args,{cwd:vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,env,stdio:['ignore','pipe','pipe']}); this.process=child;
      child.stdout?.on('data',d=>this.event('output',{category:'stdout',output:d.toString()})); child.stderr?.on('data',d=>this.event('output',{category:'stderr',output:d.toString()}));
      child.once('spawn',()=>{settled=true;resolve();}); child.once('error',error=>{this.event('output',{category:'stderr',output:`Unable to start XPscript executable: ${error.message}\n`});if(!settled)reject(new Error(`Unable to start XPscript executable: ${error.message}`));});
      child.on('exit',code=>{this.event('output',{category:'console',output:`XPscript process exited with code ${code??0}.\n`});this.terminateOnce();});
    });
  }

  private async attach(config:XPScriptDebugConfig):Promise<void>{this.config=config;if(!config.port)throw new Error('XPscript attach requires a port.');await this.connect(config.host??'127.0.0.1',config.port,config.token??'',10000);}
  private async connect(host:string,port:number,token:string,timeoutMs:number):Promise<void>{const client=new XPScriptRuntimeClient(token);client.onEvent(event=>{if(event.type==='stopped'){void this.handleStopped(event as RuntimeStoppedEvent);return;}if(event.type==='debugOutput'){const output=event as RuntimeMessage;const source=String(output.source??'');const sourcePath=this.resolveSourcePath(source);const line=Number(output.line??0);const prefix=source&&line>0?`${this.fileName(source)}:${line} `:'';this.event('output',{category:'console',output:prefix+String(output.output??'')+'\n',source:source?{name:this.fileName(source),path:sourcePath}:undefined,line:line>0?line:undefined});void vscode.commands.executeCommand('workbench.debug.action.focusRepl');return;}if(event.type==='error'){const e=event as RuntimeMessage;this.event('output',{category:'stderr',output:String(e.message??'Debugger runtime error')+'\n'});return;}if(event.type==='disconnected')this.terminateOnce();});await client.connect(host,port,timeoutMs);this.client=client;for(const item of this.breakpointSets.values())client.setBreakpoints(item.source,item.lines);}
  private async handleStopped(event:RuntimeStoppedEvent):Promise<void>{
    this.currentSource=this.resolveSourcePath(event.source);this.currentLine=event.line;this.currentFrames=(event.frames??[]).map(frame=>({...frame,source:this.resolveSourcePath(frame.source)}));this.currentException=event.reason==='exception'?{...event,source:this.currentSource,frames:this.currentFrames}:undefined;this.currentValues.clear();this.debuggerVariableNames.clear();this.historyReferences.clear();this.nextVariableReference=2000;
    if(event.reason==='entry'&&this.config?.request==='launch'&&this.config.stopOnEntry===false){this.heldEntryStop=true;return;}
    if(event.reason==='breakpoint'){
      const condition=this.breakpointConditions.get(this.breakpointKey(this.currentSource,this.currentLine));
      if(condition){
        const result=await this.evaluateBreakpointCondition(condition);
        if(!result.matched&&!result.error){this.client?.continue();return;}
        if(result.error)this.event('output',{category:'stderr',output:`Conditional breakpoint '${condition}' could not be evaluated: ${result.error}\n`});
      }
    }
    this.event('stopped',{reason:event.reason,threadId:event.threadId||1,allThreadsStopped:true,description:event.description,text:event.description});
  }
  private executableLines(source:string):number[]{try{const fs=require('fs') as typeof import('fs');const lines=fs.readFileSync(source,'utf8').split(/\r?\n/);const result:number[]=[];for(let i=0;i<lines.length;i++){const t=lines[i].trim();if(!t||t.startsWith("'")||/^Rem\b/i.test(t)||/^(Sub|Function|Property|Class|Type)\b/i.test(t)||/^End\s+(Sub|Function|Property|Class|Type)\b/i.test(t)||/^(Else|ElseIf|End If|Next|Loop|Wend)$/i.test(t))continue;result.push(i+1);}return result;}catch{return[];}}
  private resolveBreakpointLine(line:number,lines:number[]):number{if(lines.length===0)return line;if(lines.includes(line))return line;return lines.find(v=>v>line)??lines.filter(v=>v<line).pop()??line;}
  private async refreshCurrentValues():Promise<void>{const response=await this.client?.valueHistory('');const items=response?.items??[];this.currentValues.clear();for(const item of items){const key=item.Name.toLowerCase();const current=this.currentValues.get(key);if(!current||item.Sequence>current.Sequence)this.currentValues.set(key,item);}}
  private async refreshDebuggerVariableNames():Promise<void>{const response=await this.client?.debuggerVariables();this.debuggerVariableNames.clear();for(const item of response?.items??[])this.debuggerVariableNames.add(item.name.toLowerCase());}
  private async evaluateBreakpointCondition(condition:string):Promise<ConditionalBreakpointResult>{
    const values=new Map<string,string>();
    await this.refreshCurrentValues();
    for(const item of this.currentValues.values())values.set(item.Name.toLowerCase(),item.NewValue);
    const debuggerVariables=await this.client?.debuggerVariables();
    for(const item of debuggerVariables?.items??[])values.set(item.name.toLowerCase(),item.value);

    const comparison=/^([A-Za-z_]\w*)\s*(==|!=|<=|>=|<|>)\s*(.+)$/.exec(condition.trim());
    if(!comparison){
      const bare=condition.trim().toLowerCase();
      if(!/^[a-z_]\w*$/i.test(bare))return{matched:true,error:'Supported conditions are a variable name or variable ==, !=, <, <=, >, >= value.'};
      if(!values.has(bare))return{matched:true,error:`Variable '${condition.trim()}' has not been observed yet.`};
      return{matched:this.conditionTruthy(values.get(bare)??'')};
    }

    const name=comparison[1];const op=comparison[2];const rawRight=comparison[3].trim();const left=values.get(name.toLowerCase());
    if(left===undefined)return{matched:true,error:`Variable '${name}' has not been observed yet.`};
    const right=this.parseConditionOperand(rawRight,values);
    if(right.error)return{matched:true,error:right.error};
    const result=this.compareConditionValues(left,right.value??'',op);
    return result.error?{matched:true,error:result.error}:{matched:result.matched};
  }
  private parseConditionOperand(text:string,values:Map<string,string>):{value?:string;error?:string}{
    if((text.startsWith('"')&&text.endsWith('"'))||(text.startsWith("'")&&text.endsWith("'")))return{value:text.slice(1,-1)};
    if(/^(true|false|nothing|null)$/i.test(text)||/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text))return{value:text};
    if(/^[A-Za-z_]\w*$/.test(text)){const value=values.get(text.toLowerCase());return value===undefined?{error:`Variable '${text}' has not been observed yet.`}:{value};}
    return{error:`Unsupported right-hand value '${text}'. Use a number, quoted string, boolean, Nothing, or another observed variable.`};
  }
  private compareConditionValues(left:string,right:string,op:string):ConditionalBreakpointResult{
    const leftNumber=Number(left);const rightNumber=Number(right);const numeric=left.trim()!==''&&right.trim()!==''&&Number.isFinite(leftNumber)&&Number.isFinite(rightNumber);
    if(numeric){switch(op){case'==':return{matched:leftNumber===rightNumber};case'!=':return{matched:leftNumber!==rightNumber};case'<':return{matched:leftNumber<rightNumber};case'<=':return{matched:leftNumber<=rightNumber};case'>':return{matched:leftNumber>rightNumber};case'>=':return{matched:leftNumber>=rightNumber};}}
    const normalize=(value:string)=>/^(nothing|null)$/i.test(value.trim())?'':value;
    const a=normalize(left);const b=normalize(right);const cmp=a.localeCompare(b,undefined,{sensitivity:'base'});
    switch(op){case'==':return{matched:cmp===0};case'!=':return{matched:cmp!==0};case'<':return{matched:cmp<0};case'<=':return{matched:cmp<=0};case'>':return{matched:cmp>0};case'>=':return{matched:cmp>=0};default:return{matched:true,error:`Unsupported operator '${op}'.`};}
  }
  private conditionTruthy(value:string):boolean{const text=value.trim();if(text===''||/^(false|nothing|null|0)$/i.test(text))return false;return true;}
  private breakpointKey(source:string,line:number):string{return `${this.resolveSourcePath(source).toLowerCase()}|${line}`;}
  private breakpointSourceKey(source:string):string{return this.resolveSourcePath(source).toLowerCase();}
  private clearBreakpointConditionsForSource(source:string):void{const prefix=this.resolveSourcePath(source).toLowerCase()+'|';for(const key of [...this.breakpointConditions.keys()])if(key.startsWith(prefix))this.breakpointConditions.delete(key);}
  private historyReference(name:string):number{for(const [ref,existing] of this.historyReferences)if(existing.toLowerCase()===name.toLowerCase())return ref;const ref=this.nextVariableReference++;this.historyReferences.set(ref,name);return ref;}
  private terminateOnce():void{if(this.terminated)return;this.terminated=true;this.event('terminated');}
  private respond(request:any,body?:any,success=true,message?:string):void{this.emitter.fire({seq:this.sequence++,type:'response',request_seq:request.seq,command:request.command,success,message,body});}
  private event(event:string,body?:any):void{this.emitter.fire({seq:this.sequence++,type:'event',event,body});}
  private fileName(sourcePath:string):string{const normalized=sourcePath.replace(/\\/g,'/');return normalized.slice(normalized.lastIndexOf('/')+1);}
  private resolveSourcePath(sourcePath:string):string{
    if(!sourcePath)return sourcePath;
    if(path.isAbsolute(sourcePath))return path.normalize(sourcePath);
    const program=this.config?.program;
    if(program){
      if(this.fileName(program).toLowerCase()===this.fileName(sourcePath).toLowerCase())return path.normalize(program);
      return path.resolve(path.dirname(program),sourcePath);
    }
    const workspace=vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return workspace?path.resolve(workspace,sourcePath):sourcePath;
  }
  private async findPort():Promise<number>{const net=await import('net');return new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const address=server.address();if(!address||typeof address==='string'){server.close();reject(new Error('Unable to allocate debugger port.'));return;}const port=address.port;server.close(error=>error?reject(error):resolve(port));});});}
}
export class XPScriptDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory { public createDebugAdapterDescriptor():vscode.ProviderResult<vscode.DebugAdapterDescriptor>{return new vscode.DebugAdapterInlineImplementation(new XPScriptDebugAdapter());} }
