#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const cwd = process.cwd();

function emit(obj) {
  process.stderr.write(JSON.stringify(obj) + '\n');
}

function runTool(callId, tool, args) {
  emit({ type: 'tool_use', call_id: callId, tool, input: args });
  const output = execFileSync('./calendarctl', args, { cwd, encoding: 'utf8' });
  emit({ type: 'tool_result', call_id: callId, tool, output: JSON.parse(output) });
}

emit({ type: 'step_start' });
runTool('call_pref', 'calendarctl.get-preferences', ['get-preferences', '--user', 'u_me', '--output', 'json']);
runTool('call_avail', 'calendarctl.get-availability', ['get-availability', '--attendees', 'u_me,u_alice', '--from', '2026-04-21T13:00:00-07:00', '--to', '2026-04-21T18:00:00-07:00', '--duration-minutes', '30', '--output', 'json']);
runTool('call_events', 'calendarctl.list-events', ['list-events', '--user', 'u_me', '--from', '2026-04-21T13:00:00-07:00', '--to', '2026-04-21T18:00:00-07:00', '--output', 'json']);
emit({ type: 'text', text: JSON.stringify({ preferredSlotId: 'slot_2', alternativeSlotIds: ['slot_3'], rationale: 'Avoids focus time and satisfies notice requirement' }) });
emit({ type: 'step_finish' });
process.exit(0);
