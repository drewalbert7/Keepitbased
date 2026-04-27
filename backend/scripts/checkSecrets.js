#!/usr/bin/env node
/* eslint-disable no-console */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const ignoredPaths = [
  'backend/config/encrypted.json',
  'package-lock.json',
  'backend/package-lock.json',
  'frontend/package-lock.json'
];

const textExtensions = new Set([
  '.js', '.ts', '.tsx', '.json', '.md', '.yml', '.yaml', '.env', '.sh', '.py'
]);

const patterns = [
  {
    name: 'API key assignment',
    regex: /\b(?:MASSIVE|POLYGON|KRAKEN|COINAPI|ALPHA_VANTAGE|NEWS)_API_KEY\s*=\s*(?!\s*$|your_|your-|demo|changeme|example)[^\s#'"]+/i
  },
  {
    name: 'Private key block',
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/
  },
  {
    name: 'High-entropy secret assignment',
    regex: /\b(?:SECRET|TOKEN|PASSWORD|ACCESS_KEY)\b\s*[:=]\s*['"]?[A-Za-z0-9_\-\/+=]{20,}/i
  }
];

const isProbablyText = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  return textExtensions.has(ext) || filePath.endsWith('.env.example') || filePath.endsWith('.env.template');
};

const getTrackedFiles = () => {
  const output = execSync('git ls-files', { cwd: repoRoot, encoding: 'utf8' });
  return output.split('\n').map((line) => line.trim()).filter(Boolean);
};

const findings = [];
for (const relativePath of getTrackedFiles()) {
  if (ignoredPaths.includes(relativePath)) continue;
  if (!isProbablyText(relativePath)) continue;

  const absolutePath = path.join(repoRoot, relativePath);
  let content;
  try {
    content = fs.readFileSync(absolutePath, 'utf8');
  } catch (_error) {
    continue;
  }

  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    const trimmed = line.trim().toLowerCase();
    if (
      trimmed.includes('your-') ||
      trimmed.includes('your_') ||
      trimmed.includes('example') ||
      trimmed.includes('changeme')
    ) {
      return;
    }
    for (const pattern of patterns) {
      if (pattern.regex.test(line)) {
        findings.push({
          file: relativePath,
          line: idx + 1,
          type: pattern.name
        });
      }
    }
  });
}

if (findings.length > 0) {
  console.error('Potential secrets detected in tracked files:');
  findings.forEach((f) => {
    console.error(`- ${f.file}:${f.line} (${f.type})`);
  });
  process.exit(1);
}

console.log('Secret scan passed: no suspicious secrets found in tracked files.');
