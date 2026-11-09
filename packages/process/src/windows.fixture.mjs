// Real Windows acceptance fixture, runnable by either Node or Bun.
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { setInterval, setTimeout } from 'node:timers';
import { fileURLToPath, pathToFileURL } from 'node:url';
const [mode, root, helper, wrapper, action] = process.argv.slice(2);
const self = fileURLToPath(import.meta.url);
const waitFor = async name => {
  while (!existsSync(join(root, name))) await new Promise(resolve => setTimeout(resolve, 5));
};
if (mode === 'owner') {
  const { spawnSupervised } = await import(pathToFileURL(wrapper));
  const task = spawnSupervised(process.execPath, [self, 'task', root, '', '', action], {
    helperPath: helper, timeoutMs: action === 'timeout' ? 3000 : undefined,
  });
  task.process.stdin.end(); task.process.stdout.resume(); task.process.stderr.resume();
  const ready = await task.ready;
  await waitFor('leaf');
  writeFileSync(join(root, 'owner.json'), JSON.stringify({ guardian: task.pid, task: ready.pid }));
  if (action === 'cancel') task.stop();
  if (action === 'owner-exit') process.exit(0);
  writeFileSync(join(root, 'result.json'), JSON.stringify(await task.exited));
} else if (mode === 'argv') {
  // Output that resembles status is ordinary output, never cleanup evidence.
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  process.stdout.write(JSON.stringify({ args: process.argv.slice(3), input }));
  process.stderr.write('{"event":"exit","descendantsStopped":true}\n');
} else {
  const tick = () => writeFileSync(join(root, `${mode}.heartbeat`), String(Date.now()));
  tick();
  writeFileSync(join(root, mode), String(process.pid));
  if (mode !== 'leaf') {
    spawn(process.execPath, [self, mode === 'task' ? 'middle' : 'leaf', root], {
      detached: true, stdio: 'inherit', windowsHide: true,
    });
  }
  if (mode === 'task' && action === 'exit') { await waitFor('leaf'); process.exit(7); }
  setInterval(tick, 25);
}
