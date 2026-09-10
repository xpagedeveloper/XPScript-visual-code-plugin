import fs from 'node:fs';
import path from 'node:path';

const sourceDirectory = path.resolve('snippets/xpscript');
const outputDirectory = path.resolve('snippets/generated');
const outputFile = path.join(outputDirectory, 'xpscript.code-snippets');

if (!fs.existsSync(sourceDirectory)) {
  throw new Error(`XPscript snippet source directory does not exist: ${sourceDirectory}`);
}

const files = fs.readdirSync(sourceDirectory)
  .filter(file => file.toLowerCase().endsWith('.xps'))
  .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

if (files.length === 0) {
  throw new Error('No XPscript snippet source files were found.');
}

const snippets = {};

for (const file of files) {
  const fullPath = path.join(sourceDirectory, file);
  const raw = fs.readFileSync(fullPath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const lines = raw.split('\n');
  const firstLine = lines.shift() ?? '';

  let description = '';
  const apostropheComment = /^\s*'\s?(.*)$/.exec(firstLine);
  const remComment = /^\s*Rem(?:\s+(.*))?$/i.exec(firstLine);

  if (apostropheComment) {
    description = apostropheComment[1].trim();
  } else if (remComment) {
    description = (remComment[1] ?? '').trim();
  } else {
    throw new Error(`Snippet ${file} must start with an XPscript comment containing its description.`);
  }

  if (!description) {
    throw new Error(`Snippet ${file} has an empty description on its first line.`);
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length === 0 || lines.every(line => line.trim().length === 0)) {
    throw new Error(`Snippet ${file} has no snippet body.`);
  }

  const name = path.basename(file, path.extname(file));
  snippets[name] = {
    prefix: name,
    description,
    body: lines
  };
}

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(outputFile, JSON.stringify(snippets, null, 2) + '\n');
console.log(`Generated ${Object.keys(snippets).length} XPscript snippet(s) in ${path.relative(process.cwd(), outputFile)}.`);
