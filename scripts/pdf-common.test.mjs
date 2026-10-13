import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkAssetNames, githubMarkdownLink, normalizeCjkEmphasis, pdfNames, validateManifest, verifyRemoteAssets } from './pdf-common.mjs';

const sha = 'a'.repeat(40);
const repository = 'notbeloser/NTUT_Antenna_Open_Course';
const digest = 'b'.repeat(64);
const manifest = () => ({ sha, repository, documents: [pdfNames('notes/中文 講義.md')], assets: [
  { name: pdfNames('notes/中文 講義.md').asset, size: 1234, sha256: digest },
  { name: 'antenna-course-pdfs.zip', size: 2345, sha256: digest },
] });
const remoteAssets = () => manifest().assets.map(({ name, size, sha256 }) => ({ name, size, state: 'uploaded', digest: `sha256:${sha256}` }));

test('Chinese filenames and subdirectories keep their PDF paths', () => {
  const names = pdfNames('notes/中文 講義.md');
  assert.equal(names.source, 'notes/中文 講義.md');
  assert.equal(names.pdf, 'notes/中文 講義.pdf');
  assert.match(names.asset, /^notes-[a-f\d]{12}\.pdf$/);
  assert.notEqual(names.asset, pdfNames('notes/中文講義.md').asset);
  assert.equal(names.asset, pdfNames('notes/中文 講義.md').asset);
  checkAssetNames([pdfNames('one/README.md'), pdfNames('two/README.md')]);
});

test('flattened attachment collisions fail instead of overwriting files', () => {
  assert.throws(() => checkAssetNames([pdfNames('a/b.md'), pdfNames('a__b.md')]), /collision/);
});

test('relative Markdown links resolve against the source and pinned commit', () => {
  assert.equal(githubMarkdownLink('../README.md#閱讀方式', 'notes/001.md', repository, sha), `https://github.com/${repository}/blob/${sha}/README.md#閱讀方式`);
  assert.equal(githubMarkdownLink('中文%20講義.md', 'notes/000.md', repository, sha), `https://github.com/${repository}/blob/${sha}/notes/${encodeURIComponent('中文 講義.md')}`);
  assert.equal(githubMarkdownLink('../README.md?raw=1#section', 'notes/000.md', repository, sha), `https://github.com/${repository}/blob/${sha}/README.md?raw=1#section`);
  for (const href of ['#section', 'https://example.com/file.md', 'images/diagram.png']) {
    assert.equal(githubMarkdownLink(href, 'README.md', repository, sha), href);
  }
});

test('CJK emphasis with adjacent punctuation is printable without changing code or math', () => {
  assert.equal(normalizeCjkEmphasis('**補充解說：**原本'), '**補充解說：** 原本');
  assert.equal(normalizeCjkEmphasis('**核心觀念**：文字'), '**核心觀念**：文字');
  assert.equal(normalizeCjkEmphasis('XOR。**同值相加得 0，異值相加得 1。**'), 'XOR。**同值相加得 0，異值相加得 1。**');
  const literal = '`**範例：**文字`\n```sh\n**範例：**文字\n```\n```math\n\\text{：**文字}\n```\n$`\\text{：**文字}`$';
  assert.equal(normalizeCjkEmphasis(literal), literal);
});

test('release artifacts must match the repository, commit and full asset list', () => {
  validateManifest(manifest(), sha, repository);
  assert.throws(() => validateManifest(manifest(), 'c'.repeat(40), repository), /does not match/);
  assert.throws(() => validateManifest(manifest(), sha, 'other/repo'), /does not match/);
  const missing = manifest();
  missing.assets.pop();
  assert.throws(() => validateManifest(missing, sha, repository), /incomplete/);
  const traversal = manifest();
  traversal.assets[0].name = '../secret';
  assert.throws(() => validateManifest(traversal, sha, repository), /Invalid/);
});

test('reruns accept complete releases and reject partial or corrupt attachments', () => {
  verifyRemoteAssets(manifest(), remoteAssets());
  assert.throws(() => verifyRemoteAssets(manifest(), remoteAssets().slice(1)), /count/);
  for (const changes of [{ size: 5 }, { digest: `sha256:${'c'.repeat(64)}` }, { state: 'starter' }]) {
    const corrupt = remoteAssets();
    Object.assign(corrupt[0], changes);
    assert.throws(() => verifyRemoteAssets(manifest(), corrupt), /mismatched/);
  }
});
