/**
 * Starts the mock SSH/SFTP servers and an HTTP target for local E2E/QA runs.
 * Writes connection details to tests/.artifacts/mock-lab.json and stays alive.
 *
 * Uses the teammate-owned test fixtures (test-only code).
 */
import fs from 'node:fs';
import path from 'node:path';
import { startMockSshServer } from '../tests/fixtures/mock-ssh-server.js';
import { startMockSftpServer } from '../tests/fixtures/mock-sftp.js';
import { startTunnelTarget } from '../tests/fixtures/tunnel-target.js';

const outDir = path.resolve('tests/.artifacts');
fs.mkdirSync(outDir, { recursive: true });
const sftpRoot = path.join(outDir, 'mock-sftp-root');
fs.rmSync(sftpRoot, { recursive: true, force: true });
fs.mkdirSync(sftpRoot, { recursive: true });
fs.mkdirSync(path.join(sftpRoot, 'projects', 'fluent-ssh'), { recursive: true });
fs.mkdirSync(path.join(sftpRoot, 'logs'), { recursive: true });
fs.writeFileSync(path.join(sftpRoot, 'README.md'), '# Mock SFTP\n\nThis directory is served by the FluentSSH mock SFTP lab.\n');
fs.writeFileSync(path.join(sftpRoot, 'deploy.sh'), '#!/usr/bin/env bash\necho "deploying..."\necho "done"\n');
fs.writeFileSync(path.join(sftpRoot, 'projects', 'fluent-ssh', 'package.json'), '{\n  "name": "demo-app",\n  "version": "1.0.0"\n}\n');
fs.writeFileSync(path.join(sftpRoot, 'logs', 'nginx-access.log'), '127.0.0.1 - - "GET / HTTP/1.1" 200 512\n127.0.0.1 - - "GET /assets/app.js HTTP/1.1" 200 18342\n');
fs.writeFileSync(path.join(sftpRoot, 'large-binary.bin'), Buffer.from(Array.from({ length: 8192 }, (_, i) => i % 251)));

const ssh = await startMockSshServer();
const sftp = await startMockSftpServer({ rootDir: sftpRoot, cleanup: false });
const target = await startTunnelTarget();

const details = {
  ssh: {
    host: '127.0.0.1',
    port: ssh.port,
    username: ssh.username,
    password: ssh.password,
    fingerprint: ssh.fingerprint,
    keyType: ssh.keyType
  },
  sftp: {
    host: '127.0.0.1',
    port: sftp.port,
    username: sftp.username,
    password: sftp.password,
    fingerprint: sftp.hostKeyFingerprint,
    keyType: sftp.hostKeyType,
    rootDir: sftp.rootDir
  },
  httpTarget: { url: target.url, port: target.port }
};

fs.writeFileSync(path.join(outDir, 'mock-lab.json'), JSON.stringify(details, null, 2));
console.log(JSON.stringify(details, null, 2));
console.log('\nMock lab ready. Ctrl+C to stop.');

const shutdown = async () => {
  await Promise.allSettled([ssh.stop(), sftp.stop(), target.close()]);
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
