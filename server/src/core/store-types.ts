import type {
  AuthType,
  HostProfile,
  HostGroup,
  SshKeyMeta,
  TunnelConfig
} from '../../../shared/types.js';

// Local wrapper types that include encrypted material. Never serialized directly.

export interface SecretBox {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

export interface StoredHost extends Omit<HostProfile, 'hasPassword' | 'hasPassphrase'> {
  secrets: {
    password?: SecretBox;
    passphrase?: SecretBox;
  };
}

export interface StoredKey extends SshKeyMeta {
  secrets: {
    privateKey: SecretBox;
    passphrase?: SecretBox;
  };
}

export interface ResolvedSecrets {
  password: string | null;
  passphrase: string | null;
  privateKey: string | null;
}

export interface HostSecretWrite {
  authType?: AuthType;
  password?: string;
  passphrase?: string;
}

/** Cached metadata for building public host objects. */
export interface StoredHostInput extends Partial<StoredHost> {
  id?: string;
}

export type { HostGroup, TunnelConfig };
