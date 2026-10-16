#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { scaffold } from './scaffold.js';

try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { help: { type: 'boolean', short: 'h' } },
  });
  if (values.help) {
    console.log('Usage: create-lab-agent [directory]');
  } else {
    if (positionals.length > 1) throw new Error('Expected at most one destination directory.');
    const directory = await scaffold(positionals[0]);
    console.log(`Created ${directory}\nInstall dependencies there, then run npm run ui or npm run run -- "Your task".`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
