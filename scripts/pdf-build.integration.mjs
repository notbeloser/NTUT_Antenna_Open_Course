import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const sha = 'a'.repeat(40);

test('PDF conversion rejects broken resources and renders a complete collection', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'antenna-pdf-build-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'scripts'));
  for (const filename of ['build-pdfs.mjs', 'pdf-common.mjs', 'pdf.css']) {
    await copyFile(path.join(root, 'scripts', filename), path.join(directory, 'scripts', filename));
  }
  await symlink(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'junction');
  await execFile('git', ['init', '-q'], { cwd: directory });
  await execFile('git', ['remote', 'add', 'origin', 'https://github.com/notbeloser/NTUT_Antenna_Open_Course.git'], { cwd: directory });
  await writeFile(path.join(directory, 'README.md'), '# Test');
  await execFile('git', ['add', 'README.md'], { cwd: directory });
  const build = () => execFile(process.execPath, ['scripts/build-pdfs.mjs'], {
    cwd: directory, timeout: 90_000,
    env: { ...process.env, GITHUB_REPOSITORY: 'notbeloser/NTUT_Antenna_Open_Course', GITHUB_SHA: sha },
  });
  for (const [name, markdown, expected] of [
    ['missing image', '# Test\n\n![Missing](images/missing.png)', /Cannot decode image: images\/missing\.png/],
    ['undefined math command', '# Test\n\n```math\n\\notARealCommand{x}\n```', /MathJax error:/],
    ['unclosed math group', '# Test\n\n```math\n\\frac{\n```', /MathJax error:|Not all math expressions were typeset/],
  ]) {
    await t.test(name, async () => {
      await writeFile(path.join(directory, 'README.md'), markdown);
      await assert.rejects(build(), error => error.code === 1 && expected.test(error.stderr));
      await assert.rejects(readFile(path.join(directory, 'dist', 'manifest.json')), { code: 'ENOENT' });
    });
  }
  await t.test('GitHub math, Chinese emphasis, local images and automatic document discovery', async () => {
    await mkdir(path.join(directory, 'notes', 'images'), { recursive: true });
    await copyFile(path.join(root, 'notes', 'images', '001-diagram-01.png'), path.join(directory, 'notes', 'images', 'diagram.png'));
    await writeFile(path.join(directory, 'README.md'), '# 中文測試\n\n**補充說明：**內容。\n\nXOR。**同值相加得 0，異值相加得 1。**\n\n令 $`x=1`$。\n\n```math\nE=mc^2\n```\n\n[講義](notes/中文.md)');
    await writeFile(path.join(directory, 'notes', '中文.md'), '# 中文講義\n\n| 圖片 | 說明 |\n| --- | --- |\n| <img src="images/diagram.png" width="120"> | 中文 |\n\n```math\n\\frac{1}{2}\n```');
    await execFile('git', ['add', 'notes/中文.md'], { cwd: directory });
    await build();
    const manifest = JSON.parse(await readFile(path.join(directory, 'dist', 'manifest.json'), 'utf8'));
    assert.equal(manifest.documents.length, 2);
    assert.equal(manifest.assets.length, 3);
    assert.equal(manifest.documents.reduce((sum, document) => sum + document.mathCount, 0), 3);
    for (const document of manifest.documents) {
      const pdf = await readFile(path.join(directory, 'dist', 'pdf', document.pdf));
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    }
    const html = await readFile(path.join(directory, 'dist', 'html', 'README.html'), 'utf8');
    assert.ok(html.includes('<strong>補充說明：</strong> 內容'));
    assert.ok(html.includes('<strong>同值相加得 0，異值相加得 1。</strong>'));
    assert.ok(html.includes(`/blob/${sha}/notes/${encodeURIComponent('中文.md')}`));
  });
});
