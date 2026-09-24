import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sandboxRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(sandboxRoot, '..');
const astraHost = path.join(workspaceRoot, 'host', 'astra');
const threeSubject = path.join(workspaceRoot, 'subjects', 'gpt-racing');

export default {
  root: sandboxRoot,
  publicDir: path.join(astraHost, 'public'),
  server: {
    host: '127.0.0.1',
    port: 4174,
    strictPort: true,
    fs: { allow: [workspaceRoot] }
  },
  preview: {
    host: '127.0.0.1',
    allowedHosts: ['vlonethug00.tailbde88d.ts.net'],
    port: 4174,
    strictPort: true
  },
  resolve: {
    alias: [
      { find: /^three$/, replacement: path.join(threeSubject, 'node_modules', 'three', 'build', 'three.module.js') },
      { find: /^three\/addons\/(.*)$/, replacement: `${path.join(threeSubject, 'node_modules', 'three', 'examples', 'jsm')}/$1` }
    ],
    dedupe: ['three']
  },
  build: {
    outDir: path.join(workspaceRoot, 'dist', 'harbor-ring-sandbox'),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        benchmark: path.join(sandboxRoot, 'index.html'),
        mobile: path.join(sandboxRoot, 'mobile.html'),
        claudeNativeSolo: path.join(sandboxRoot, 'claude-solo.html'),
        nativeEngineRace: path.join(sandboxRoot, 'native-race.html')
      }
    }
  }
};
