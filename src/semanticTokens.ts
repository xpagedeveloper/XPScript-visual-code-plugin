import * as vscode from 'vscode';
import { apiCatalog, ApiItem } from './generated/apiCatalog';

export const semanticTokensLegend = new vscode.SemanticTokensLegend(
  ['class', 'function', 'method', 'property', 'variable', 'parameter', 'keyword', 'number', 'string', 'operator'],
  ['declaration', 'readonly', 'static']
);

const keywords = new Set([
  'class','end','function','sub','property','public','private','dim','as','set','new','if','then','else','elseif',
  'for','each','in','next','while','wend','do','loop','until','select','case','exit','return','call','byval','byref',
  'optional','const','option','declare','explicit','on','error','resume','static','with','goto','gosub','forall'
]);

const constants = new Set(['true','false','nothing','null','empty']);
const apiClassNames = new Set(apiCatalog.filter(x => x.kind === 'class').map(x => x.name.toLowerCase()));
const apiByName = new Map<string, ApiItem[]>();
for (const item of apiCatalog) {
  const key = item.name.toLowerCase();
  apiByName.set(key, [...(apiByName.get(key) ?? []), item]);
}

interface UserSymbols {
  classes: Set<string>;
  functions: Set<string>;
  variables: Set<string>;
  parameters: Set<string>;
}

function collectUserSymbols(text: string): UserSymbols {
  const symbols: UserSymbols = {
    classes: new Set(),
    functions: new Set(),
    variables: new Set(),
    parameters: new Set()
  };

  for (const match of text.matchAll(/^\s*Class\s+([A-Za-z_]\w*)/gim)) symbols.classes.add(match[1].toLowerCase());
  for (const match of text.matchAll(/^\s*(?:Public\s+|Private\s+)?(?:Function|Sub)\s+([A-Za-z_]\w*)/gim)) symbols.functions.add(match[1].toLowerCase());
  for (const match of text.matchAll(/^\s*(?:Dim|Static|Public|Private)\s+([A-Za-z_]\w*)/gim)) symbols.variables.add(match[1].toLowerCase());

  const routines = /^\s*(?:Public\s+|Private\s+)?(?:Function|Sub)\s+[A-Za-z_]\w*\s*\(([^)]*)\)/gim;
  for (const match of text.matchAll(routines)) {
    for (const raw of match[1].split(',')) {
      const parameter = raw.match(/(?:ByVal\s+|ByRef\s+|Optional\s+)*([A-Za-z_]\w*)/i);
      if (parameter) symbols.parameters.add(parameter[1].toLowerCase());
    }
  }
  return symbols;
}

function stringAndCommentRanges(line: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let inString = false;
  let start = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (inString && line[i + 1] === '"') { i++; continue; }
      if (!inString) { inString = true; start = i; }
      else { ranges.push([start, i + 1]); inString = false; start = -1; }
    } else if (!inString && line[i] === "'") {
      ranges.push([i, line.length]);
      return ranges;
    }
  }
  if (inString && start >= 0) ranges.push([start, line.length]);
  return ranges;
}

function covered(index: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function declarationModifier(before: string, word: string): string[] {
  if (new RegExp(`\\bClass\\s+${word}$`, 'i').test(before + word)) return ['declaration'];
  if (new RegExp(`\\b(?:Function|Sub)\\s+${word}$`, 'i').test(before + word)) return ['declaration'];
  if (new RegExp(`\\b(?:Dim|Static|Public|Private)\\s+${word}$`, 'i').test(before + word)) return ['declaration'];
  return [];
}

export class XPScriptSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
  provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.SemanticTokens {
    const builder = new vscode.SemanticTokensBuilder(semanticTokensLegend);
    const symbols = collectUserSymbols(document.getText());

    for (let lineNo = 0; lineNo < document.lineCount; lineNo++) {
      const line = document.lineAt(lineNo).text;
      const excluded = stringAndCommentRanges(line);

      for (const [start, end] of excluded) {
        if (line[start] === '"') builder.push(lineNo, start, end - start, 'string', []);
      }

      for (const match of line.matchAll(/\b\d+(?:\.\d+)?\b/g)) {
        if (!covered(match.index!, excluded)) builder.push(lineNo, match.index!, match[0].length, 'number', []);
      }
      for (const match of line.matchAll(/(?:<=|>=|<>|=|<|>|\+|-|\*|\/|&)/g)) {
        if (!covered(match.index!, excluded)) builder.push(lineNo, match.index!, match[0].length, 'operator', []);
      }

      for (const match of line.matchAll(/\b[A-Za-z_]\w*\b/g)) {
        const index = match.index!;
        if (covered(index, excluded)) continue;
        const word = match[0];
        const lower = word.toLowerCase();
        const before = line.slice(0, index);
        const after = line.slice(index + word.length);

        if (keywords.has(lower) || constants.has(lower)) {
          builder.push(lineNo, index, word.length, 'keyword', []);
          continue;
        }

        const modifiers = declarationModifier(before, word);
        if (symbols.classes.has(lower) || apiClassNames.has(lower)) {
          builder.push(lineNo, index, word.length, 'class', modifiers);
          continue;
        }
        if (symbols.parameters.has(lower)) {
          builder.push(lineNo, index, word.length, 'parameter', modifiers);
          continue;
        }
        if (symbols.variables.has(lower)) {
          builder.push(lineNo, index, word.length, 'variable', modifiers);
          continue;
        }
        if (symbols.functions.has(lower)) {
          builder.push(lineNo, index, word.length, 'function', modifiers);
          continue;
        }

        const candidates = apiByName.get(lower) ?? [];
        if (candidates.length > 0) {
          const precededByDot = /\.\s*$/.test(before);
          const followedByCall = /^\s*\(/.test(after);
          const item = candidates.find(x => precededByDot ? !!x.owner : !x.owner) ?? candidates[0];
          if (item.kind === 'class') builder.push(lineNo, index, word.length, 'class', []);
          else if (item.kind === 'property') builder.push(lineNo, index, word.length, 'property', item.writable ? [] : ['readonly']);
          else if (item.kind === 'function') builder.push(lineNo, index, word.length, precededByDot || !!item.owner ? 'method' : 'function', []);
          else if (followedByCall) builder.push(lineNo, index, word.length, 'function', []);
        }
      }
    }

    return builder.build();
  }
}
