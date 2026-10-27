import crypto from 'node:crypto';
import sshpk from 'sshpk';
import type {
  KeyAlgorithm,
  KeyGenerateInput,
  KeyImportInput,
  SshKeyMeta
} from '../../../shared/types.js';
import type { StoredKey } from '../core/store-types.js';
import { audit } from '../core/audit.js';
import { ApiError } from '../core/errors.js';
import { getStore } from '../core/store.js';
import { getVault } from '../core/vault.js';

/**
 * SSH key management (`/api/keys`).
 *
 * Private material and passphrases are always encrypted with the vault before
 * they touch the store, and are never returned by the API. Only metadata,
 * the OpenSSH public key line and the SHA256 fingerprint are exposed.
 */

type SshpkPrivateKey = ReturnType<typeof sshpk.parsePrivateKey>;

const RSA_MIN_BITS = 1024;
const RSA_MAX_BITS = 8192;
const RSA_DEFAULT_BITS = 3072;
const KEY_NAME_MAX = 120;

function toKeyMeta(stored: StoredKey): SshKeyMeta {
  const { secrets: _secrets, ...meta } = stored;
  return structuredClone(meta);
}

function findKey(keyId: string): StoredKey | undefined {
  return getStore().data.keys.find((key) => key.id === keyId);
}

function getKeyOrThrow(keyId: string): StoredKey {
  const key = findKey(keyId);
  if (!key) throw new ApiError(404, 'NOT_FOUND', '密钥不存在或已被删除。');
  return key;
}

function normalizeName(name: string): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) throw new ApiError(400, 'VALIDATION', '密钥名称不能为空。');
  if (trimmed.length > KEY_NAME_MAX) throw new ApiError(400, 'VALIDATION', '密钥名称过长。');
  return trimmed;
}

function algorithmFromType(type: string): KeyAlgorithm {
  if (type === 'ed25519' || type === 'rsa' || type === 'ecdsa') return type;
  throw new ApiError(400, 'VALIDATION', `不支持该密钥类型（${type}），仅支持 Ed25519、RSA、ECDSA。`);
}

function algorithmBits(key: SshpkPrivateKey): number {
  if (key.type === 'ed25519') return 256;
  return typeof key.size === 'number' && key.size > 0 ? key.size : 256;
}

function commentOf(key: SshpkPrivateKey, fallback?: string): string {
  const explicit = (fallback ?? '').trim();
  if (explicit) return explicit;
  const embedded = (key.comment ?? '').trim();
  if (embedded && embedded !== '(unnamed)') return embedded;
  return '';
}

function buildPublicAndFingerprint(key: SshpkPrivateKey, comment: string) {
  key.comment = comment || undefined;
  const publicKey = key.toPublic().toString('ssh').trim();
  const fingerprint = key.fingerprint('sha256').toString();
  return { publicKey, fingerprint };
}

function serializePrivateKey(key: SshpkPrivateKey, passphrase: string | null): string {
  if (passphrase) {
    return key.toString('openssh', { passphrase, cipher: 'aes256-ctr' });
  }
  return key.toString('openssh');
}

function generateMaterial(input: KeyGenerateInput): {
  key: SshpkPrivateKey;
  algorithm: KeyAlgorithm;
  bits: number;
  privateText: string;
  passphrase: string | null;
} {
  const algorithm = input.algorithm ?? 'ed25519';
  const passphrase = input.passphrase && input.passphrase.length > 0 ? input.passphrase : null;
  let key: SshpkPrivateKey;
  let bits: number;

  if (algorithm === 'ed25519') {
    key = sshpk.generatePrivateKey('ed25519');
    bits = 256;
  } else if (algorithm === 'ecdsa') {
    const requested = Number(input.bits ?? 256);
    const curve = requested === 384 ? 'nistp384' : requested === 521 ? 'nistp521' : 'nistp256';
    key = sshpk.generatePrivateKey('ecdsa', { curve });
    bits = requested === 384 || requested === 521 ? requested : 256;
  } else if (algorithm === 'rsa') {
    const requested = Number(input.bits ?? RSA_DEFAULT_BITS);
    bits = Math.min(RSA_MAX_BITS, Math.max(RSA_MIN_BITS, Math.round(requested) || RSA_DEFAULT_BITS));
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: bits });
    const pkcs8 = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    key = sshpk.parsePrivateKey(pkcs8, 'pem');
  } else {
    throw new ApiError(400, 'VALIDATION', `不支持的密钥算法：${String(algorithm)}`);
  }

  const privateText = serializePrivateKey(key, passphrase);
  return { key, algorithm, bits, privateText, passphrase };
}

export function listKeys(): SshKeyMeta[] {
  return getStore().data.keys.map(toKeyMeta);
}

export function generateKey(input: KeyGenerateInput): SshKeyMeta {
  const name = normalizeName(input.name ?? '');
  const { key, algorithm, bits, privateText, passphrase } = generateMaterial(input);
  const comment = commentOf(key, input.comment);
  const { publicKey, fingerprint } = buildPublicAndFingerprint(key, comment);
  const vault = getVault();
  const now = Date.now();
  const meta: SshKeyMeta = {
    id: crypto.randomUUID(),
    name,
    algorithm,
    bits,
    publicKey,
    fingerprint,
    comment,
    hasPassphrase: Boolean(passphrase),
    isGenerated: true,
    createdAt: now
  };
  const stored: StoredKey = {
    ...meta,
    secrets: {
      privateKey: vault.encrypt(privateText),
      ...(passphrase ? { passphrase: vault.encrypt(passphrase) } : {})
    }
  };
  getStore().mutate((data) => {
    data.keys.push(stored);
  });
  audit('security', 'info', `生成 SSH 密钥 ${name}（${algorithm}）`, {
    details: { keyId: stored.id, algorithm, bits, fingerprint }
  });
  return toKeyMeta(stored);
}

export function importKey(input: KeyImportInput): SshKeyMeta {
  const name = normalizeName(input.name ?? '');
  const trimmed = (input.privateKey ?? '').trim();
  if (!trimmed) throw new ApiError(400, 'VALIDATION', '私钥内容不能为空。');

  let parsed: SshpkPrivateKey | null = null;
  let usedPassphrase: string | null = null;
  try {
    parsed = sshpk.parsePrivateKey(trimmed, 'auto');
  } catch (error) {
    const errorName = error instanceof Error ? error.name : '';
    const message = error instanceof Error ? error.message : String(error);
    const encrypted = errorName === 'KeyEncryptedError' || /encrypted|passphrase/i.test(message);
    if (!encrypted) {
      throw new ApiError(400, 'VALIDATION', `无法解析私钥：${message}`);
    }
    if (!input.passphrase) {
      throw new ApiError(400, 'VALIDATION', '该私钥已加密，请提供密码短语。');
    }
    try {
      parsed = sshpk.parsePrivateKey(trimmed, 'auto', { passphrase: input.passphrase });
      usedPassphrase = input.passphrase;
    } catch (decryptError) {
      const decryptMessage = decryptError instanceof Error ? decryptError.message : String(decryptError);
      throw new ApiError(400, 'VALIDATION', `密码短语不正确，无法解密私钥：${decryptMessage}`);
    }
  }

  if (!parsed) throw new ApiError(400, 'VALIDATION', '无法解析私钥。');

  let algorithm: KeyAlgorithm;
  try {
    algorithm = algorithmFromType(parsed.type);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'VALIDATION', '不支持的私钥类型。');
  }
  const bits = algorithmBits(parsed);
  const comment = commentOf(parsed, input.comment);
  const { publicKey, fingerprint } = buildPublicAndFingerprint(parsed, comment);
  const vault = getVault();
  const now = Date.now();
  const meta: SshKeyMeta = {
    id: crypto.randomUUID(),
    name,
    algorithm,
    bits,
    publicKey,
    fingerprint,
    comment,
    hasPassphrase: Boolean(usedPassphrase),
    isGenerated: false,
    createdAt: now
  };
  const stored: StoredKey = {
    ...meta,
    secrets: {
      privateKey: vault.encrypt(trimmed),
      ...(usedPassphrase ? { passphrase: vault.encrypt(usedPassphrase) } : {})
    }
  };
  getStore().mutate((data) => {
    data.keys.push(stored);
  });
  audit('security', 'info', `导入 SSH 密钥 ${name}（${algorithm}）`, {
    details: { keyId: stored.id, algorithm, bits, fingerprint }
  });
  return toKeyMeta(stored);
}

export function updateKey(keyId: string, input: { name?: string; comment?: string }): SshKeyMeta {
  const key = getKeyOrThrow(keyId);
  if (input.name !== undefined) key.name = normalizeName(input.name);
  if (input.comment !== undefined) key.comment = input.comment.trim().slice(0, 1024);
  getStore().flush();
  audit('security', 'info', `更新密钥信息 ${key.name}`, { details: { keyId } });
  return toKeyMeta(key);
}

export function deleteKey(keyId: string): void {
  const key = getKeyOrThrow(keyId);
  const referencingHosts = getStore().data.hosts.filter((host) => host.keyId === keyId);
  if (referencingHosts.length > 0) {
    throw new ApiError(409, 'CONFLICT', `该密钥正被 ${referencingHosts.length} 台主机使用，请先解除引用。`, {
      hosts: referencingHosts.map((host) => ({ id: host.id, name: host.name }))
    });
  }
  getStore().mutate((data) => {
    data.keys = data.keys.filter((item) => item.id !== keyId);
  });
  audit('security', 'warn', `删除 SSH 密钥 ${key.name}`, { details: { keyId, fingerprint: key.fingerprint } });
}
