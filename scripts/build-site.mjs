#!/usr/bin/env node
// Cloudflare Pages build entrypoint: installs deps, captures fresh demo
// fixtures from the real server, builds the client in demo mode, and
// assembles the static landing page + demo app into dist-site/.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, existsSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const distSite = join(repoRoot, 'dist-site');

function run(cmd, args, cwd, extraEnv) {
  console.log(`\n$ ${cmd} ${args.join(' ')} ${cwd ? `(in ${cwd})` : ''}`);
  execFileSync(cmd, args, {
    cwd: cwd || repoRoot,
    stdio: 'inherit',
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
  });
}

run('npm', ['ci'], join(repoRoot, 'server'));
run('npm', ['ci'], join(repoRoot, 'client'));

run('node', ['scripts/build-demo-data.mjs']);

run('npx', ['vite', 'build', '--base=/demo/'], join(repoRoot, 'client'), { VITE_DEMO: '1' });

rmSync(distSite, { recursive: true, force: true });
mkdirSync(distSite, { recursive: true });

cpSync(join(repoRoot, 'site'), distSite, { recursive: true });

const demoOut = join(distSite, 'demo');
mkdirSync(demoOut, { recursive: true });
cpSync(join(repoRoot, 'client', 'dist'), demoOut, { recursive: true });

// The demo is a JS-only app shell with nothing for crawlers; noindex it so
// search engines focus on the landing page. Applied here rather than in
// client/index.html so self-hosted builds are unaffected.
const demoIndex = join(demoOut, 'index.html');
const demoHtml = readFileSync(demoIndex, 'utf8');
if (!demoHtml.includes('</head>')) throw new Error('demo index.html missing </head>');
writeFileSync(demoIndex, demoHtml.replace('</head>', '  <meta name="robots" content="noindex" />\n</head>'));

// site/_redirects enumerates the client's known routes explicitly rather
// than a /demo/* wildcard: Cloudflare Pages redirects always fire ahead of
// static assets, so a blanket wildcard would shadow /demo/assets/*.js|css
// and /demo/demo-data/*.json. New routes added to App.jsx need a matching
// line here. Rules target 200.htm (not .html): Cloudflare's automatic
// clean-URL handling strips a literal ".html" destination, which false
// -flags (and disables) these as "infinite loop" redirects.
copyFileSync(join(demoOut, 'index.html'), join(demoOut, '200.htm'));

if (!existsSync(join(distSite, '_redirects'))) {
  throw new Error('_redirects missing from site/ - SPA routing for /demo will break');
}

console.log(`\nSite assembled at ${distSite}`);
