import { Session } from '../src/app/Session.js';
import { GuildCommands } from '../src/app/GuildCommands.js';
import { MemoryStorage } from '../src/save/SaveGame.js';
import { DebugConsole } from '../src/debug/commands.js';

/**
 * A session with in-memory storage and a deterministic clock stand-in.
 * `now` returns a counter rather than the wall clock so save timestamps are reproducible.
 */
export function testSession(seed = 'test-seed'): {
  session: Session;
  commands: GuildCommands;
  debug: DebugConsole;
} {
  let tick = 0;
  const session = new Session({
    worldSeed: seed,
    storage: new MemoryStorage(),
    now: () => ++tick,
  });
  return {
    session,
    commands: new GuildCommands(session),
    debug: new DebugConsole(session),
  };
}

/**
 * A test session whose town already has a smithy and a tannery, so crafting tests exercise
 * crafting rather than the workshop requirement (which tests/crafting.test.ts pins on its own).
 */
export function workshopSession(seed = 'test-seed'): ReturnType<typeof testSession> {
  const harness = testSession(seed);
  harness.session.town.grid.place('smithy', 0, 0, 0);
  harness.session.town.grid.place('tannery', 4, 0, 0);
  return harness;
}
