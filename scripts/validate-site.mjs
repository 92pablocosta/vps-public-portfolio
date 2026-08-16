#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = path.join(repositoryRoot, 'site');
const htmlPath = path.join(siteRoot, 'index.html');
const scriptPath = path.join(siteRoot, 'script.js');
const translationsPath = path.join(siteRoot, 'translations.js');

const html = fs.readFileSync(htmlPath, 'utf8');
const script = fs.readFileSync(scriptPath, 'utf8');
const translationsSource = fs.readFileSync(translationsPath, 'utf8');
const failures = [];
const trackedOrCandidateFiles = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { cwd: repositoryRoot, encoding: 'utf8' }
).trim().split('\n').filter(Boolean);

const sandbox = { window: {} };
vm.createContext(sandbox);
new vm.Script(translationsSource, { filename: translationsPath }).runInContext(sandbox);

const translations = sandbox.window.TRANSLATIONS;
if (!translations || typeof translations !== 'object') {
  failures.push('translations.js did not define window.TRANSLATIONS');
}

const english = new Set(Object.keys(translations?.en || {}));
const portuguese = new Set(Object.keys(translations?.['pt-BR'] || {}));

for (const key of english) {
  if (!portuguese.has(key)) failures.push(`missing pt-BR translation: ${key}`);
}
for (const key of portuguese) {
  if (!english.has(key)) failures.push(`missing English translation: ${key}`);
}

const requiredKeys = new Set();
for (const match of html.matchAll(/data-i18n(?:-html|-aria-label)?="([^"]+)"/g)) {
  requiredKeys.add(match[1]);
}
for (const match of script.matchAll(/\bt\(['"]([^'"]+)['"]\)/g)) {
  requiredKeys.add(match[1]);
}

for (const key of requiredKeys) {
  if (!english.has(key)) failures.push(`site references undefined translation key: ${key}`);
}

const ids = new Set(Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]));
for (const match of html.matchAll(/href="#([^"]+)"/g)) {
  if (!ids.has(match[1])) failures.push(`fragment target does not exist: #${match[1]}`);
}

for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
  const reference = match[1];
  if (/^(?:https?:|mailto:|#|data:)/.test(reference)) continue;
  const cleanReference = reference.split(/[?#]/, 1)[0];
  if (cleanReference && !fs.existsSync(path.resolve(siteRoot, cleanReference))) {
    failures.push(`local asset does not exist: ${reference}`);
  }
}

const obsoleteClaims = [
  'No restore test has been performed',
  'Nenhum teste de restore foi realizado',
  'not yet implemented or restore-tested',
  'Current protection: provider-side snapshots only'
];

for (const claim of obsoleteClaims) {
  if (html.includes(claim) || translationsSource.includes(claim)) {
    failures.push(`obsolete current-facing claim remains: ${claim}`);
  }
}

const forbiddenFilename = /(^|\/)(\.env([^/]*)?|auth\.json|acme\.json)$|\.(db|sqlite3?|pem|key|p12|pfx)$|-(wal|shm)$/;
for (const relativeFile of trackedOrCandidateFiles) {
  if (forbiddenFilename.test(relativeFile)) {
    failures.push(`prohibited secret-bearing or mutable filename: ${relativeFile}`);
  }
}

const credentialShape = /BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{20,}/i;
const scannerDefinitions = new Set([
  'examples/scripts/secret-scan.example.sh',
  'scripts/validate-site.mjs'
]);

for (const relativeFile of trackedOrCandidateFiles) {
  if (scannerDefinitions.has(relativeFile)) continue;
  const absoluteFile = path.join(repositoryRoot, relativeFile);
  if (!fs.statSync(absoluteFile).isFile()) continue;
  const content = fs.readFileSync(absoluteFile);
  if (content.includes(0)) continue;
  const lines = content.toString('utf8').split('\n');
  lines.forEach((line, index) => {
    if (credentialShape.test(line)) {
      failures.push(`high-confidence credential shape: ${relativeFile}:${index + 1}`);
    }
  });
}

let markdownLinksChecked = 0;
for (const relativeFile of trackedOrCandidateFiles.filter((file) => file.endsWith('.md'))) {
  const absoluteFile = path.join(repositoryRoot, relativeFile);
  const markdown = fs.readFileSync(absoluteFile, 'utf8');
  for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const reference = match[1].replace(/^<|>$/g, '');
    if (/^(?:https?:|mailto:|#)/.test(reference)) continue;
    const cleanReference = reference.split('#', 1)[0];
    if (!cleanReference) continue;
    markdownLinksChecked += 1;
    const target = path.resolve(path.dirname(absoluteFile), decodeURIComponent(cleanReference));
    if (!fs.existsSync(target)) failures.push(`broken Markdown link: ${relativeFile} -> ${reference}`);
  }
}

if (failures.length) {
  for (const failure of failures) process.stderr.write(`FAIL: ${failure}\n`);
  process.exit(1);
}

process.stdout.write(
  `Validated site: ${requiredKeys.size} referenced translation keys, ` +
  `${english.size} bilingual entries, local assets, fragments, status claims, ` +
  `${markdownLinksChecked} local Markdown links, filenames, and credential shapes.\n`
);
