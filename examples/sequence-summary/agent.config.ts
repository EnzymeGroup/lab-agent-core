import { defineAgent } from 'lab-agent-core';

export default defineAgent({
  root: import.meta.dirname,
  validation: { command: ['python3', 'checks/validate.py'] },
});
