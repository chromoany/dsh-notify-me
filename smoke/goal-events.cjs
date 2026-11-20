'use strict';

function goalJournal() {
  const events = [];
  let goal;
  let round = 0;
  let created = 0;
  const append = (type, data) => {
    const seq = events.length;
    const event = { type, data, seq, time: seq };
    events.push(event);
    return event;
  };
  const change = (operation, phase, code) => {
    if (operation === 'create') {
      goal = undefined;
      round = 0;
      created += 1;
    }
    const event = append('goal/change', {
      kind: 'goal/change', version: 1, operation,
      goal: {
        id: `goal-atlas-${created}`, revision: (goal?.revision ?? 0) + 1, phase,
        objective: operation === 'edit' ? 'Updated objective' : (goal?.objective ?? 'Explore the repository'),
        maxGoalRounds: 16, ...(code ? { blockedReason: { code, message: 'Fixture blocker' } } : {}),
      },
      createdAt: 0, updatedAt: events.length, roundsStarted: round,
    });
    goal = event.data.goal;
    return event;
  };
  return {
    events,
    projection: () => goal ? { goal, roundsStarted: round } : null,
    change,
    start(turn, automatic = true) {
      const start = append('turn/start', { turn });
      const source = automatic ? { kind: 'goal', goalId: goal.id, revision: goal.revision, round: ++round } : { kind: 'user' };
      return [start, append('user/message', { role: 'user', source, content: [{ type: 'text', text: 'Continue' }] })];
    },
    end(turn, reason = { kind: 'completed' }) { return append('turn/end', { turn, reason }); },
    stop(turn, operation, phase, ptc = false) {
      const callId = `update-goal-${turn}`;
      const args = { goal_id: goal.id, revision: goal.revision, action: operation === 'block' ? 'blocked' : operation };
      const identity = { rootCallId: `run-${turn}`, parentCallId: `run-${turn}`, subCallId: callId, name: 'update_goal', arguments: args };
      const call = ptc ? append('tool/ptc-dispatch-start', identity)
        : append('tool/call', { turn, step: 1, callId, name: 'update_goal', arguments: JSON.stringify(args) });
      const mutation = change(operation, phase, operation === 'block' ? 'model-reported' : undefined);
      const content = [{ type: 'text', text: JSON.stringify({ goal, activation: 'disarmed' }) }];
      const result = ptc ? append('tool/ptc-dispatch', { ...identity, isError: false, content })
        : append('tool/result', { turn, step: 1, message: { toolCallId: callId, isError: false, content } });
      return [call, mutation, result];
    },
  };
}

module.exports = { goalJournal };
