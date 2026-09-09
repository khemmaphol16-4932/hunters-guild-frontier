/**
 * Skill books — the item that teaches a skill.
 *
 * REQ-SKL-005. A book is a thin wrapper over SkillKnowledge.learn: it exists as its own
 * system because in Phase 2 a book becomes a real inventory item with acquisition, cost and
 * trade value, and the consumption rules (one book, one skill, consumed on success only)
 * should not be re-derived then.
 *
 * The compatibility gate is deliberately *not* duplicated here — it lives in SkillRegistry,
 * so a book cannot teach something class rules forbid.
 */

import type { SkillId } from '../../core/ids.js';
import type { Hunter } from '../../core/hunter/Hunter.js';
import { err, ok, type Result } from '../../core/result.js';
import type { EventBus } from '../../core/events.js';
import type { SkillKnowledge } from './SkillKnowledge.js';
import type { SkillRegistry } from './SkillRegistry.js';
import type { Constellation } from '../constellation/Constellation.js';

export interface SkillBook {
  readonly id: string;
  readonly skillId: SkillId;
  readonly name: string;
}

export interface ReadResult {
  readonly hunter: Hunter;
  /** Whether the book was consumed. A failed reading never consumes it. */
  readonly consumed: boolean;
}

export interface SkillBooksDeps {
  readonly registry: SkillRegistry;
  readonly knowledge: SkillKnowledge;
  readonly constellation: Constellation;
  readonly events: EventBus;
}

export class SkillBooks {
  private readonly registry: SkillRegistry;
  private readonly knowledge: SkillKnowledge;
  private readonly constellation: Constellation;

  constructor(deps: SkillBooksDeps) {
    this.registry = deps.registry;
    this.knowledge = deps.knowledge;
    this.constellation = deps.constellation;
  }

  /** Construct the book that teaches a given skill. Phase 2 replaces this with loot. */
  bookFor(skillId: SkillId): Result<SkillBook, string> {
    const def = this.registry.get(skillId);
    if (!def) return err(`unknown skill "${skillId}"`);
    return ok({ id: `book_${def.id}`, skillId, name: `Treatise on ${def.name}` });
  }

  /**
   * Teach a hunter from a book.
   * Returns the reason on failure so the UI can say *why* — "not available to Invoker"
   * is actionable, "cannot learn" is not.
   */
  read(hunter: Hunter, book: SkillBook): Result<ReadResult, string> {
    const learned = this.knowledge.learn(hunter, book.skillId, 'book');
    if (!learned.ok) return err(learned.error);
    return ok({ hunter: learned.value, consumed: true });
  }

  /** Would reading succeed? Lets the market and the UI grey out useless books. */
  canRead(hunter: Hunter, book: SkillBook): Result<true, string> {
    if (hunter.knownSkills.includes(book.skillId)) {
      return err(`${hunter.name} already knows this skill`);
    }

    // Eligibility is the constellation's to decide (v1.0 §5) — a book cannot teach past a
    // node's prerequisites, level or archetype reach.
    const node = this.constellation.nodeForSkill(String(book.skillId));
    if (!node) return err(`no constellation node teaches this skill`);

    const verdict = this.constellation.eligibility(hunter, node.id);
    return verdict.eligible ? ok(true) : err(verdict.unmet.join('; '));
  }
}
