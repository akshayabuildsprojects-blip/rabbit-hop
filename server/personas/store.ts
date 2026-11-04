import fs from "node:fs";
import path from "node:path";
import { formatZodError, LockedPersonaSchema, PersonaIdSchema, type PersonaProfile } from "./schema.js";
import { contentHash, deepFreeze } from "./hash.js";
import { validateProfile } from "./generator.js";

export class LockedPersonaError extends Error {}
export class PersonaNotFoundError extends Error {}
export class IntegrityError extends Error {}

export type LockedPersona = Readonly<PersonaProfile>;

export class PersonaStore {
  constructor(public dataDir: string) {}

  private id(id: string) {
    return PersonaIdSchema.parse(id);
  }
  draftPath(id: string) {
    return path.join(this.dataDir, "persona-drafts", `${this.id(id)}.json`);
  }
  lockedPath(id: string) {
    return path.join(this.dataDir, "personas-locked", `${this.id(id)}.json`);
  }
  lockedVersionPath(id: string, version: number) {
    return path.join(this.dataDir, "personas-locked", "versions", `${this.id(id)}.v${version}.json`);
  }

  hasDraft(id: string) {
    return fs.existsSync(this.draftPath(id));
  }
  hasLocked(id: string) {
    return fs.existsSync(this.lockedPath(id));
  }

  // Next version number for a fresh draft. A locked persona is only superseded by an
  // explicit new version; it is never regenerated in place.
  nextVersion(id: string, allowNewVersion: boolean): number {
    if (!this.hasLocked(id)) return 1;
    if (!allowNewVersion) {
      throw new LockedPersonaError(
        `'${id}' is locked, so it will not be regenerated. Start a new version instead (the locked v${this.loadLocked(id).metadata.version} stays untouched).`,
      );
    }
    return this.loadLocked(id).metadata.version + 1;
  }

  saveDraft(profile: PersonaProfile) {
    const p = validateProfile(profile);
    if (p.metadata.status !== "draft") throw new LockedPersonaError("Only draft profiles can be saved as drafts.");
    if (this.hasLocked(p.persona_id) && p.metadata.version <= this.loadLocked(p.persona_id).metadata.version) {
      throw new LockedPersonaError(`'${p.persona_id}' v${this.loadLocked(p.persona_id).metadata.version} is locked. A new draft must use a higher version.`);
    }
    fs.mkdirSync(path.dirname(this.draftPath(p.persona_id)), { recursive: true });
    fs.writeFileSync(this.draftPath(p.persona_id), JSON.stringify(p, null, 2) + "\n");
    return this.draftPath(p.persona_id);
  }

  loadDraft(id: string): PersonaProfile {
    const file = this.draftPath(id);
    if (!fs.existsSync(file)) throw new PersonaNotFoundError(`No draft for '${id}'. Research it in the Personas tab first.`);
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e: any) {
      throw new Error(`Draft ${file} is not valid JSON: ${e.message}`);
    }
    return validateProfile(raw);
  }

  // Validates the draft as it is on disk now (including any manual edits) and locks it.
  lock(id: string, now = new Date()): { profile: LockedPersona; path: string; versionPath: string } {
    const draft = this.loadDraft(id);
    if (this.hasLocked(id) && draft.metadata.version <= this.loadLocked(id).metadata.version) {
      throw new LockedPersonaError(`'${id}' v${this.loadLocked(id).metadata.version} is already locked and cannot be modified.`);
    }
    const locked: PersonaProfile = {
      ...draft,
      metadata: { ...draft.metadata, status: "locked", approved_at: now.toISOString(), content_hash: null },
    };
    locked.metadata.content_hash = contentHash(locked);
    const check = LockedPersonaSchema.safeParse(locked);
    if (!check.success) throw new Error(`Locked profile failed validation:\n${formatZodError(check.error)}`);

    const versionPath = this.lockedVersionPath(id, locked.metadata.version);
    fs.mkdirSync(path.dirname(versionPath), { recursive: true });
    // 'wx' refuses to overwrite: a locked version file is written exactly once.
    fs.writeFileSync(versionPath, JSON.stringify(locked, null, 2) + "\n", { flag: "wx" });
    fs.writeFileSync(this.lockedPath(id), JSON.stringify(locked, null, 2) + "\n");
    fs.renameSync(this.draftPath(id), path.join(path.dirname(versionPath), `${id}.v${locked.metadata.version}.approved-draft.json`));
    return { profile: deepFreeze(locked), path: this.lockedPath(id), versionPath };
  }

  // Loads a locked persona without any API call. Verifies the content hash so edits made
  // to the file after approval are detected, and returns a frozen object.
  loadLocked(id: string): LockedPersona {
    const file = this.lockedPath(id);
    if (!fs.existsSync(file)) throw new PersonaNotFoundError(`'${id}' has no locked profile yet.`);
    const parsed = LockedPersonaSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
    if (!parsed.success) throw new IntegrityError(`Locked profile ${file} is invalid:\n${formatZodError(parsed.error)}`);
    const expected = contentHash(parsed.data as PersonaProfile);
    if (expected !== parsed.data.metadata.content_hash) {
      throw new IntegrityError(`Locked profile '${id}' was modified after approval (content hash mismatch). Restore it from ${this.lockedVersionPath(id, parsed.data.metadata.version)}.`);
    }
    return deepFreeze(parsed.data as PersonaProfile);
  }

  status(id: string): "locked" | "draft" | "locked + new draft" | "not researched" {
    const l = this.hasLocked(id);
    const d = this.hasDraft(id);
    return l && d ? "locked + new draft" : l ? "locked" : d ? "draft" : "not researched";
  }
}
