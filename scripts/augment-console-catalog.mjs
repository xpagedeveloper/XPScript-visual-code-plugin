import fs from 'node:fs';

const outFile = 'src/generated/apiCatalog.ts';
const source = fs.readFileSync(outFile, 'utf8');
const marker = 'export const apiCatalog: ApiItem[] = ';
const start = source.indexOf(marker);
if (start < 0) throw new Error('apiCatalog marker not found');
const jsonStart = start + marker.length;
const jsonEnd = source.lastIndexOf(';');
if (jsonEnd <= jsonStart) throw new Error('apiCatalog terminator not found');

const items = JSON.parse(source.slice(jsonStart, jsonEnd));
const byKey = new Map(items.map(item => [item.qualifiedName.toLowerCase(), item]));
const add = item => byKey.set(item.qualifiedName.toLowerCase(), item);
const sourceDoc = 'docs/console-api.md';

add({
  name: 'Console',
  qualifiedName: 'Console',
  kind: 'class',
  syntax: 'Console',
  parameters: '',
  description: 'Interactive terminal output, colors, cursor control, keyboard input, redirection detection, and console metadata.',
  source: sourceDoc,
  section: 'Console API'
});

const functions = [
  ['Write', 'Console.Write(value)', 'value', 'Writes a value without appending a newline.'],
  ['WriteLine', 'Console.WriteLine([value])', 'value', 'Writes an optional value followed by a newline.'],
  ['WriteError', 'Console.WriteError(value)', 'value', 'Writes a value followed by a newline to stderr.'],
  ['Read', 'Console.Read()', '', 'Reads the next character from standard input.'],
  ['ReadLine', 'Console.ReadLine()', '', 'Reads the next line from standard input.'],
  ['Clear', 'Console.Clear()', '', 'Clears the terminal screen when supported by the current platform.'],
  ['ClearLine', 'Console.ClearLine()', '', 'Clears the current terminal line when output is not redirected.'],
  ['SetCursorPosition', 'Console.SetCursorPosition(left, top)', 'left; top', 'Sets the console cursor position.'],
  ['ResetColor', 'Console.ResetColor()', '', 'Restores the terminal foreground and background colors.'],
  ['ReadKey', 'Console.ReadKey([intercept])', 'intercept', 'Reads a key press. When intercept is True, the key is not echoed.', 'ConsoleKeyInfoValue'],
  ['Beep', 'Console.Beep([frequency, duration])', 'frequency; duration', 'Plays a console beep when supported by the current platform.']
];
for (const [name, syntax, parameters, description, returnType] of functions) {
  add({
    name,
    qualifiedName: `Console.${name}`,
    owner: 'Console',
    kind: 'function',
    syntax,
    parameters,
    description,
    ...(returnType ? { returnType } : {}),
    source: sourceDoc,
    section: 'Console API'
  });
}

const properties = [
  ['ForegroundColor', true, 'Gets or sets the console foreground color name.'],
  ['BackgroundColor', true, 'Gets or sets the console background color name.'],
  ['CursorLeft', true, 'Gets or sets the zero-based cursor column.'],
  ['CursorTop', true, 'Gets or sets the zero-based cursor row.'],
  ['CursorVisible', true, 'Gets or sets whether the console cursor is visible.'],
  ['WindowWidth', false, 'Gets the current console window width.'],
  ['WindowHeight', false, 'Gets the current console window height.'],
  ['Title', true, 'Gets or sets the console window title.'],
  ['KeyAvailable', false, 'Reports whether a key press is waiting to be read.'],
  ['IsInputRedirected', false, 'Reports whether standard input is redirected.'],
  ['IsOutputRedirected', false, 'Reports whether standard output is redirected.'],
  ['IsErrorRedirected', false, 'Reports whether standard error is redirected.'],
  ['In', false, 'Gets the standard input reader.'],
  ['Out', false, 'Gets the standard output writer.'],
  ['Error', false, 'Gets the standard error writer.']
];
for (const [name, writable, description] of properties) {
  add({
    name,
    qualifiedName: `Console.${name}`,
    owner: 'Console',
    kind: 'property',
    syntax: `Console.${name}`,
    parameters: '',
    description,
    ...(writable ? { writable: true } : {}),
    source: sourceDoc,
    section: 'Console API'
  });
}

add({
  name: 'ConsoleKeyInfoValue',
  qualifiedName: 'ConsoleKeyInfoValue',
  kind: 'class',
  syntax: 'Dim key As ConsoleKeyInfoValue',
  parameters: '',
  description: 'Value returned by Console.ReadKey with key name, character and modifier state.',
  source: sourceDoc,
  section: 'Keyboard'
});
for (const [name, description] of [
  ['Key', 'Gets the key name.'],
  ['Char', 'Gets the typed character.'],
  ['Control', 'True when the Control modifier was pressed.'],
  ['Alt', 'True when the Alt modifier was pressed.'],
  ['Shift', 'True when the Shift modifier was pressed.']
]) {
  add({
    name,
    qualifiedName: `ConsoleKeyInfoValue.${name}`,
    owner: 'ConsoleKeyInfoValue',
    kind: 'property',
    syntax: `key.${name}`,
    parameters: '',
    description,
    source: sourceDoc,
    section: 'Keyboard'
  });
}

const catalog = [...byKey.values()].sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));
const header = source.slice(0, jsonStart);
fs.writeFileSync(outFile, `${header}${JSON.stringify(catalog, null, 2)};\n`);
console.log(`Added Console IntelliSense surface; catalog now has ${catalog.length} items.`);
