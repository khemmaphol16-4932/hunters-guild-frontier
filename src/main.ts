/**
 * Browser entry point.
 *
 * The only place that touches the DOM root, wall-clock time and localStorage — everything
 * below it receives those as injected dependencies, which is what lets the same systems run
 * headless in tests and, later, in offline simulation (REQ-OFF-002).
 */

import './ui/style.css';
import { Session } from './app/Session.js';
import { GuildCommands } from './app/GuildCommands.js';
import { DebugConsole } from './debug/commands.js';
import { AppShell } from './ui/appShell.js';
import { BrowserStorage } from './save/SaveGame.js';

const root = document.getElementById('root');
if (!root) throw new Error('main: #root is missing from index.html');

// A fixed seed for the prototype so the same guild appears on every reload — invaluable
// while systems are still being tuned. Recruitment will take the seed from the world in
// Phase 3.
const worldSeed = new URLSearchParams(location.search).get('seed') ?? 'frontier-001';

const session = new Session({
  worldSeed,
  storage: new BrowserStorage(),
  now: () => Date.now(),
});

const commands = new GuildCommands(session);
const debug = new DebugConsole(session);

// Seed a starting roster: two Vanguards who will be built differently, plus one of each
// other archetype. Two same-class hunters are here specifically so REQ-BLD-003 can be
// inspected on first load without any setup.
const restored = session.save.load('autosave');
if (restored.ok && restored.value.hunters.length > 0) {
  session.restore(restored.value);
} else {
  commands.recruit({ archetype: 'vanguard', personality: 'stoic' });
  commands.recruit({ archetype: 'vanguard', personality: 'reckless' });
  commands.recruit({ archetype: 'adept', personality: 'protective' });
  commands.recruit({ archetype: 'ranger', personality: 'opportunist' });
}

const shell = new AppShell(root, session, commands);
shell.mount();

// Debug console is dev-only (REQ-TEC-006 — never exposed to normal players).
if (import.meta.env.DEV) {
  (globalThis as Record<string, unknown>)['hgf'] = { session, commands, debug, shell };
  console.info('[hgf] debug console available as window.hgf');
}
