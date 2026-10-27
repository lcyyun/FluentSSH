import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { VaultStatus } from '../../../shared/types.js';
import type { SecretBox } from './store-types.js';
import { eventHub } from './events.js';
import { ApiError } from './errors.js';

interface VaultFile {
  protected: boolean;
  createdAt: number;
  salt?: string;
  /** Data key encrypted with the password-derived key. */
  wrappedKey?: SecretBox;
}

const AAD = Buffer.from('fluentssh:secret:v1');
const KEYRING_FILE = 'keyring.json';
const VAULT_FILE = 'vault.json';

function encryptWith(key: Buffer, plaintext: Buffer): SecretBox {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { v: 1, iv: iv.toString('base64'), tag: tag.toString('base64'), data: data.toString('base64') };
}

function decryptWith(key: Buffer, box: SecretBox): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]);
}

/**
 * Credential vault. Secrets are always AES-256-GCM encrypted at rest.
 *
 * - Default: a random 256-bit data key lives in data/keyring.json (mode 0600).
 * - Protected: the data key is wrapped with a scrypt-derived password key; the
 *   plaintext keyring is deleted and only exists in memory while unlocked.
 *
 * The vault can be used for encrypt/decrypt without a master password by
 * default, so the app is immediately usable; Settings → Security can add one.
 */
class Vault {
  private dataDir = '';
  private dataKey: Buffer | null = null;
  private vault: VaultFile | null = null;
  private lockTimer: NodeJS.Timeout | null = null;
  private autoLockMinutes = 0;
  private lastActivity = Date.now();

  init(dataDir: string, autoLockMinutes: number) {
    this.dataDir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    this.autoLockMinutes = autoLockMinutes;
    const vaultFile = path.join(dataDir, VAULT_FILE);
    const keyringFile = path.join(dataDir, KEYRING_FILE);

    if (fs.existsSync(vaultFile)) {
      try {
        this.vault = JSON.parse(fs.readFileSync(vaultFile, 'utf8')) as VaultFile;
      } catch {
        this.vault = { protected: false, createdAt: Date.now() };
      }
    } else {
      this.vault = { protected: false, createdAt: Date.now() };
      this.writeVault();
    }

    if (this.vault.protected) {
      this.dataKey = null;
    } else if (fs.existsSync(keyringFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(keyringFile, 'utf8')) as { key: string };
        this.dataKey = Buffer.from(parsed.key, 'base64');
      } catch {
        this.rotateDataKey();
      }
    } else {
      this.rotateDataKey();
    }
    this.scheduleLock();
  }

  status(): VaultStatus {
    const protectedVault = Boolean(this.vault?.protected);
    const unlocked = this.dataKey !== null;
    return {
      protected: protectedVault,
      unlocked,
      autoLockMinutes: this.autoLockMinutes,
      locksAt:
        unlocked && this.autoLockMinutes > 0 ? this.lastActivity + this.autoLockMinutes * 60_000 : null
    };
  }

  isUnlocked() {
    return this.dataKey !== null;
  }

  requireKey(): Buffer {
    if (!this.dataKey) {
      throw new ApiError(423, 'VAULT_LOCKED', 'The vault is locked. Unlock it to access saved secrets.');
    }
    return this.dataKey;
  }

  encrypt(plaintext: string | Buffer): SecretBox {
    return encryptWith(this.requireKey(), typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext);
  }

  decrypt(box: SecretBox | undefined): string | null {
    if (!box) return null;
    try {
      return decryptWith(this.requireKey(), box).toString('utf8');
    } catch {
      return null;
    }
  }

  lock(reason = 'manual') {
    if (!this.vault?.protected) return this.status();
    if (this.dataKey) {
      this.dataKey = null;
      eventHub.publish({ type: 'vault.locked' });
      eventHub.publish({
        type: 'notify',
        level: 'warning',
        title: '保险库已锁定',
        message: reason === 'timeout' ? '由于长时间未操作，保险库已自动锁定。' : undefined
      });
    }
    this.clearTimer();
    return this.status();
  }

  touch() {
    this.lastActivity = Date.now();
    this.scheduleLock();
  }

  configureAutoLock(minutes: number) {
    this.autoLockMinutes = Math.max(0, Math.min(24 * 60, minutes));
    this.lastActivity = Date.now();
    this.scheduleLock();
  }

  async protect(password: string): Promise<VaultStatus> {
    if (this.vault?.protected) throw new ApiError(409, 'CONFLICT', '主密码已经设置。');
    if (password.length < 6) throw new ApiError(400, 'VALIDATION', '主密码至少需要 6 个字符。');
    this.requireKey();
    const salt = randomBytes(16);
    const kek = scryptSync(password, salt, 32);
    const wrappedKey = encryptWith(kek, this.requireKey());
    this.vault = { protected: true, createdAt: Date.now(), salt: salt.toString('base64'), wrappedKey };
    this.writeVault();
    const keyringFile = path.join(this.dataDir, KEYRING_FILE);
    try {
      fs.rmSync(keyringFile, { force: true });
    } catch {
      // ignore
    }
    this.lastActivity = Date.now();
    this.scheduleLock();
    return this.status();
  }

  unlock(password: string): VaultStatus {
    if (!this.vault?.protected) return this.status();
    if (!this.vault.salt || !this.vault.wrappedKey) throw new ApiError(500, 'INTERNAL', '保险库元数据损坏。');
    const kek = scryptSync(password, Buffer.from(this.vault.salt, 'base64'), 32);
    try {
      const key = decryptWith(kek, this.vault.wrappedKey);
      if (key.length !== 32) throw new Error('bad key');
      this.dataKey = key;
      this.lastActivity = Date.now();
      this.scheduleLock();
      eventHub.publish({ type: 'vault.unlocked', protected: true });
      return this.status();
    } catch {
      throw new ApiError(401, 'VAULT_PASSWORD_REQUIRED', '主密码不正确。');
    }
  }

  unprotect(password: string): VaultStatus {
    if (!this.vault?.protected) return this.status();
    this.unlock(password);
    const key = this.requireKey();
    fs.writeFileSync(path.join(this.dataDir, KEYRING_FILE), JSON.stringify({ key: key.toString('base64') }), {
      mode: 0o600
    });
    this.vault = { protected: false, createdAt: this.vault.createdAt };
    this.writeVault();
    this.configureAutoLock(0);
    return this.status();
  }

  reset(dataDir: string) {
    this.dataKey = null;
    this.vault = null;
    this.clearTimer();
    fs.rmSync(path.join(dataDir, KEYRING_FILE), { force: true });
    fs.rmSync(path.join(dataDir, VAULT_FILE), { force: true });
  }

  private rotateDataKey() {
    this.dataKey = randomBytes(32);
    fs.writeFileSync(path.join(this.dataDir, KEYRING_FILE), JSON.stringify({ key: this.dataKey.toString('base64') }), {
      mode: 0o600
    });
  }

  private writeVault() {
    fs.writeFileSync(path.join(this.dataDir, VAULT_FILE), JSON.stringify(this.vault, null, 2), { mode: 0o600 });
  }

  private scheduleLock() {
    this.clearTimer();
    if (!this.dataKey || !this.vault?.protected || this.autoLockMinutes <= 0) return;
    const delay = Math.max(1000, this.lastActivity + this.autoLockMinutes * 60_000 - Date.now());
    this.lockTimer = setTimeout(() => {
      // Activity before a throttled check extends the window.
      if (Date.now() - this.lastActivity < this.autoLockMinutes * 60_000) {
        this.scheduleLock();
        return;
      }
      this.lock('timeout');
    }, delay);
    this.lockTimer.unref?.();
  }

  private clearTimer() {
    if (this.lockTimer) clearTimeout(this.lockTimer);
    this.lockTimer = null;
  }
}

let vaultInstance: Vault | null = null;

export function initVault(dataDir: string, autoLockMinutes: number): Vault {
  vaultInstance = new Vault();
  vaultInstance.init(dataDir, autoLockMinutes);
  return vaultInstance;
}

export function getVault(): Vault {
  if (!vaultInstance) throw new Error('Vault has not been initialized');
  return vaultInstance;
}

export type { Vault };
