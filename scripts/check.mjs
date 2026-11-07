import { readdir, readFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
let files = 0;
for (const entry of await readdir(join(root, 'plugins'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const directory = join(root, 'plugins', entry.name);
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  assert.equal(manifest.name, `@local/${entry.name}`);
  for (const path of Object.values(manifest.exports)) await access(join(directory, path));
  for (const file of await readdir(directory)) {
    if (!/\.(js|mjs|worklet)$/.test(file)) continue;
    const source = await readFile(join(directory, file), 'utf8');
    const check = spawnSync(process.execPath, ['--input-type=module', '--check'], {
      input: source, encoding: 'utf8', cwd: directory,
    });
    if (check.error) throw check.error;
    assert.equal(check.status, 0, `${entry.name}/${file}\n${check.stderr}`);
    files += 1;
  }
}
console.log(`已验证四个插件的入口和 ${files} 个 JavaScript 文件。`);
