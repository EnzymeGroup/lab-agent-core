import { cp, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

/** Copy the shipped template; never overwrite an existing project. */
export async function scaffold(directory = '.'): Promise<string> {
  const target = resolve(directory);
  await mkdir(target, { recursive: true });
  if ((await readdir(target)).length) {
    throw new Error(`Destination must be empty: ${target}`);
  }
  const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  await cp(new URL('../templates/minimal/', import.meta.url), target, { recursive: true });
  const packagePath = resolve(target, 'package.json');
  const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
  manifest.name = basename(target).toLowerCase().replace(/[^a-z0-9-._]/g, '-').replace(/^[._]+/, '') || 'my-agent';
  manifest.dependencies = { [metadata.name]: metadata.version };
  await writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(resolve(target, 'gitignore'), resolve(target, '.gitignore'));
  return target;
}
