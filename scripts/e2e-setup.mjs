import fs from 'node:fs';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:4340';
const LAB = JSON.parse(fs.readFileSync('tests/.artifacts/mock-lab.json', 'utf8'));
let cookie = '';

async function req(path, init = {}) {
  const response = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) }
  });
  if (!cookie) cookie = (response.headers.get('set-cookie') ?? '').split(';')[0];
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) throw new Error(`${path}: ${response.status} ${text}`);
  return payload;
}

await req('/bootstrap');
const { group } = await req('/groups', { method: 'POST', body: JSON.stringify({ name: 'Mock Lab', color: '#0f6cbd' }) });

const terminalHostResult = await req('/hosts', {
  method: 'POST',
  body: JSON.stringify({
    name: 'Mock SSH 终端',
    hostname: '127.0.0.1',
    port: LAB.ssh.port,
    username: LAB.ssh.username,
    password: LAB.ssh.password,
    authType: 'password',
    groupId: group.id,
    tags: ['lab', 'terminal'],
    favorite: true,
    color: '#0f6cbd',
    notes: 'Mock SSH server used by automated tests.'
  })
});
const sftpHostResult = await req('/hosts', {
  method: 'POST',
  body: JSON.stringify({
    name: 'Mock SFTP 文件',
    hostname: '127.0.0.1',
    port: LAB.sftp.port,
    username: LAB.sftp.username,
    password: LAB.sftp.password,
    authType: 'password',
    groupId: group.id,
    tags: ['lab', 'sftp'],
    color: '#0e7c6b',
    defaultPath: '/',
    notes: 'Mock SFTP server used by automated tests.'
  })
});

await req('/known-hosts/trust', {
  method: 'POST',
  body: JSON.stringify({
    hostname: '127.0.0.1',
    port: LAB.ssh.port,
    keyType: LAB.ssh.keyType,
    fingerprint: LAB.ssh.fingerprint
  })
});
await req('/known-hosts/trust', {
  method: 'POST',
  body: JSON.stringify({
    hostname: '127.0.0.1',
    port: LAB.sftp.port,
    keyType: LAB.sftp.keyType,
    fingerprint: LAB.sftp.fingerprint
  })
});

const { tunnel } = await req('/tunnels', {
  method: 'POST',
  body: JSON.stringify({
    name: 'E2E HTTP 转发',
    hostId: terminalHostResult.host.id,
    type: 'local',
    bindHost: '127.0.0.1',
    bindPort: 15432,
    targetHost: '127.0.0.1',
    targetPort: LAB.httpTarget.port,
    autoStart: false
  })
});

const { snippet } = await req('/snippets', {
  method: 'POST',
  body: JSON.stringify({
    name: 'Echo 测试',
    command: 'echo fluent-ssh-e2e',
    description: 'E2E mock command',
    tags: ['lab']
  })
});

console.log(
  JSON.stringify(
    {
      cookie,
      hosts: { terminal: terminalHostResult.host.id, sftp: sftpHostResult.host.id },
      tunnelId: tunnel.id,
      snippetId: snippet.id,
      sshPort: LAB.ssh.port,
      sftpPort: LAB.sftp.port,
      targetPort: LAB.httpTarget.port
    },
    null,
    2
  )
);
fs.writeFileSync('tests/.artifacts/e2e-seed.json', JSON.stringify({ terminalHostId: terminalHostResult.host.id, sftpHostId: sftpHostResult.host.id, cookie }, null, 2));
