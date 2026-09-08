/**
 * Save, load, auto-save and backup.
 *
 * REQ-TEC-004: auto-save + manual save + backup, versioned, migration-ready.
 *
 * Storage is abstracted so the same code serves the browser (localStorage) and tests
 * (in-memory) — and so that a future platform (§7 keeps mobile open) needs a new adapter
 * rather than a new save system.
 */

import {
  CURRENT_SAVE_VERSION,
  SaveMigrationError,
  type CurrentSavePayload,
  type SaveEnvelope,
} from './envelope.js';
import { migratePayload } from './migrations/index.js';
import { err, ok, type Result } from '../core/result.js';

export interface SaveStorage {
  read(key: string): string | undefined;
  write(key: string, value: string): void;
  remove(key: string): void;
  keys(): readonly string[];
}

export class MemoryStorage implements SaveStorage {
  private readonly map = new Map<string, string>();
  read(key: string): string | undefined {
    return this.map.get(key);
  }
  write(key: string, value: string): void {
    this.map.set(key, value);
  }
  remove(key: string): void {
    this.map.delete(key);
  }
  keys(): readonly string[] {
    return [...this.map.keys()];
  }
}

export class BrowserStorage implements SaveStorage {
  constructor(private readonly prefix = 'hgf:') {}

  read(key: string): string | undefined {
    try {
      return globalThis.localStorage?.getItem(this.prefix + key) ?? undefined;
    } catch {
      // Private browsing, blocked site data, or a sandboxed frame. A save that cannot be
      // read is not a crash — the caller gets "no save" and starts fresh.
      return undefined;
    }
  }

  write(key: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(this.prefix + key, value);
    } catch {
      // Quota exceeded or storage blocked. Swallowed deliberately: losing an autosave
      // must never interrupt play. Manual saves surface failure through save()'s Result.
    }
  }

  remove(key: string): void {
    try {
      globalThis.localStorage?.removeItem(this.prefix + key);
    } catch {
      /* see write() */
    }
  }

  keys(): readonly string[] {
    try {
      const store = globalThis.localStorage;
      if (!store) return [];
      const out: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (key?.startsWith(this.prefix)) out.push(key.slice(this.prefix.length));
      }
      return out;
    } catch {
      return [];
    }
  }
}

export const AUTOSAVE_SLOT = 'autosave';
export const BACKUP_SLOT_PREFIX = 'backup.';
export const DEFAULT_BACKUP_COUNT = 3;

export interface SaveGameDeps {
  readonly storage: SaveStorage;
  /** Injected so nothing in the save path reads the wall clock directly (DL-003). */
  readonly now: () => number;
  readonly worldSeed: string;
  readonly backupCount?: number;
}

export class SaveGame {
  private readonly storage: SaveStorage;
  private readonly now: () => number;
  private readonly worldSeed: string;
  private readonly backupCount: number;

  constructor(deps: SaveGameDeps) {
    this.storage = deps.storage;
    this.now = deps.now;
    this.worldSeed = deps.worldSeed;
    this.backupCount = deps.backupCount ?? DEFAULT_BACKUP_COUNT;
  }

  /** Serialise the current payload into an envelope. */
  envelopeFor(payload: CurrentSavePayload, label: string): SaveEnvelope {
    return {
      version: CURRENT_SAVE_VERSION,
      savedAt: this.now(),
      label,
      worldSeed: this.worldSeed,
      payload,
    };
  }

  save(slot: string, payload: CurrentSavePayload, label = slot): Result<SaveEnvelope, string> {
    const envelope = this.envelopeFor(payload, label);
    try {
      this.storage.write(slot, JSON.stringify(envelope));
    } catch (cause) {
      return err(`could not write save "${slot}": ${String(cause)}`);
    }
    // Verify the write actually landed — BrowserStorage swallows quota errors, so a
    // silent failure would otherwise look like success.
    if (this.storage.read(slot) === undefined) {
      return err(`save "${slot}" did not persist (storage may be full or blocked)`);
    }
    return ok(envelope);
  }

  /**
   * Auto-save, rotating the previous autosave into the backup ring first.
   * REQ-TEC-004 — backups exist so a corrupted or regretted autosave is not fatal.
   */
  autoSave(payload: CurrentSavePayload): Result<SaveEnvelope, string> {
    const previous = this.storage.read(AUTOSAVE_SLOT);
    if (previous !== undefined) this.rotateBackups(previous);
    return this.save(AUTOSAVE_SLOT, payload, 'Autosave');
  }

  load(slot: string): Result<CurrentSavePayload, string> {
    const raw = this.storage.read(slot);
    if (raw === undefined) return err(`no save in slot "${slot}"`);

    let envelope: SaveEnvelope;
    try {
      envelope = JSON.parse(raw) as SaveEnvelope;
    } catch (cause) {
      return err(`save "${slot}" is not valid JSON: ${String(cause)}`);
    }

    if (typeof envelope.version !== 'number') {
      return err(`save "${slot}" has no version and cannot be migrated`);
    }

    try {
      const migrated = migratePayload(envelope.payload, envelope.version, CURRENT_SAVE_VERSION);
      return ok(migrated as CurrentSavePayload);
    } catch (cause) {
      if (cause instanceof SaveMigrationError) return err(cause.message);
      throw cause;
    }
  }

  listSlots(): readonly { slot: string; version: number; savedAt: number; label: string }[] {
    const out: { slot: string; version: number; savedAt: number; label: string }[] = [];
    for (const slot of this.storage.keys()) {
      const raw = this.storage.read(slot);
      if (raw === undefined) continue;
      try {
        const envelope = JSON.parse(raw) as SaveEnvelope;
        out.push({
          slot,
          version: envelope.version,
          savedAt: envelope.savedAt,
          label: envelope.label,
        });
      } catch {
        // A corrupted slot is listed as unreadable rather than hidden, so the player can
        // see that something is there and delete it.
        out.push({ slot, version: -1, savedAt: 0, label: '(unreadable)' });
      }
    }
    return out.sort((a, b) => b.savedAt - a.savedAt);
  }

  delete(slot: string): void {
    this.storage.remove(slot);
  }

  private rotateBackups(previousAutosave: string): void {
    for (let i = this.backupCount - 1; i >= 1; i--) {
      const older = this.storage.read(`${BACKUP_SLOT_PREFIX}${i}`);
      if (older !== undefined) this.storage.write(`${BACKUP_SLOT_PREFIX}${i + 1}`, older);
    }
    this.storage.write(`${BACKUP_SLOT_PREFIX}1`, previousAutosave);
    this.storage.remove(`${BACKUP_SLOT_PREFIX}${this.backupCount + 1}`);
  }
}
