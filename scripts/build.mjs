// Compatibility entry point; the supported build now includes the server.
import { spawnSync } from 'node:child_process';
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
