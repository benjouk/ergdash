// Reset the throwaway database and stage the built client where the server
// serves it from (server/dist), mirroring what the Dockerfile does at build
// time. A fresh client build always wins over a stale server/dist copy.
import { cpSync, existsSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

export default function globalSetup() {
  rmSync(join(__dirname, '.data'), { recursive: true, force: true });

  const clientDist = join(root, 'client', 'dist');
  const serverDist = join(root, 'server', 'dist');
  if (existsSync(join(clientDist, 'index.html'))) {
    rmSync(serverDist, { recursive: true, force: true });
    cpSync(clientDist, serverDist, { recursive: true });
  } else if (!existsSync(join(serverDist, 'index.html'))) {
    throw new Error('No client build found - run `npm run build` in client/ first');
  }
}
