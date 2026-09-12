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
import type { GuildReport } from './app/GuildReport.js';
import { LiveClock } from './app/LiveClock.js';

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

// A new guild gets its starting roster and town (REQ-TWN-001). Only a *new* guild: placing
// buildings for a restored save would put them somewhere the player did not choose.
const restored = session.save.load('autosave');
let offlineReport: GuildReport | undefined;
if (restored.ok && restored.value.hunters.length > 0) {
  session.restore(restored.value);
  // REQ-OFF-001: the guild kept working while the player was away. The wall clock is read
  // here, at the composition root, and nowhere below it (tests/architecture.test.ts).
  const savedAt = session.save.listSlots().find((slot) => slot.slot === 'autosave')?.savedAt;
  if (savedAt !== undefined && Date.now() > savedAt) {
    const report = commands.catchUpOffline(Date.now() - savedAt);
    if (report.steps > 0) offlineReport = report;
  }
} else {
  commands.foundGuild();
}

// Whatever the town looks like, the rota reflects it and the stage is up to date. Cheap,
// and it means a save written before either existed opens consistent rather than empty.
session.town.refreshStage();
session.townJobs.refresh();

const shell = new AppShell(root, session, commands);
shell.mount();
if (offlineReport) shell.showReport(offlineReport);

// The town's live calendar: one step per `realSecondsPerStep` of real time at the chosen
// speed, autosaved each step so closing the tab loses at most one step (REQ-TEC-004).
// LiveClock measures real elapsed time, so a throttled background tab keeps pace; a gap long
// enough to be an absence is caught up with a Guild Report, as a reload would be.
const autosave = (): void => { session.save.autoSave(session.snapshot()); };
autosave();
const clock = new LiveClock(Date.now(), session.content.time);
setInterval(() => {
  const tick = clock.tick(Date.now(), shell.speed);
  if (tick.kind === 'wait') return;
  if (tick.kind === 'absence') {
    const report = commands.catchUpOffline(tick.elapsedMs);
    autosave();
    if (report.steps > 0) shell.showReport(report);
    return;
  }
  commands.passTime(tick.steps);
  autosave();
  shell.refresh();
}, 250);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') autosave();
});
window.addEventListener('beforeunload', autosave);

// Debug console is dev-only (REQ-TEC-006 — never exposed to normal players).
if (import.meta.env.DEV) {
  (globalThis as Record<string, unknown>)['hgf'] = { session, commands, debug, shell };
  console.info('[hgf] debug console available as window.hgf');
}
