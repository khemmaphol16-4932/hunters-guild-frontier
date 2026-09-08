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
