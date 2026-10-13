import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { describeAsset, pdfNames } from './pdf-common.mjs';
import { publishPdfs } from './release-pdfs.mjs';

const sha = 'a'.repeat(40);
const repository = 'test/course';
const pdfAsset = pdfNames('notes/中文.md').asset;
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'antenna-release-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'assets'));
  await writeFile(path.join(directory, 'assets', pdfAsset), '%PDF-1.7 test document');
  await writeFile(path.join(directory, 'assets', 'antenna-course-pdfs.zip'), 'test archive');
  const refreshManifest = async () => {
    const assets = await Promise.all([pdfAsset, 'antenna-course-pdfs.zip'].map(name => describeAsset(path.join(directory, 'assets', name))));
    await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ repository, sha, documents: [pdfNames('notes/中文.md')], assets }));
  };
  await refreshManifest();
  return { directory, refreshManifest };
}

function github({ head = sha } = {}) {
  const state = { tag: null, release: null, assets: [], calls: [], failUpload: false };
  const respond = (data, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status });
  const fetchImpl = async (address, options) => {
    const url = new URL(address);
    const method = options.method;
    const endpoint = url.pathname.replace(`/repos/${repository}`, '');
    const json = typeof options.body === 'string' ? JSON.parse(options.body) : null;
    state.calls.push({ method, endpoint });
    if (method === 'GET' && endpoint.startsWith('/git/ref/tags/')) {
      return state.tag ? respond({ object: { sha: state.tag } }) : respond({}, 404);
    }
    if (method === 'GET' && endpoint.startsWith('/releases/tags/')) {
      return state.release && !state.release.draft ? respond(state.release) : respond({}, 404);
    }
    if (method === 'POST' && endpoint === '/graphql') return respond({ data: { repository: { release: state.release?.draft ? { databaseId: 1, isDraft: true } : null } } });
    if (method === 'GET' && endpoint === '/releases/1') return respond(state.release);
    if (method === 'POST' && endpoint === '/git/refs') {
      state.tag = json.sha;
      return respond({ object: { sha: state.tag } }, 201);
    }
    if (method === 'POST' && endpoint === '/releases') {
      state.release = { ...json, id: 1, upload_url: `https://uploads.github.com/repos/${repository}/releases/1/assets{?name,label}`, html_url: 'https://github.com/test/course/releases/tag/pdf-test' };
      return respond(state.release, 201);
    }
    if (method === 'GET' && endpoint === '/releases/1/assets') return respond(state.assets);
    if (method === 'POST' && endpoint === '/releases/1/assets') {
      if (state.failUpload) return respond({ message: 'Temporary upload failure' }, 503);
      const asset = { id: state.calls.length, name: url.searchParams.get('name'), label: url.searchParams.get('label'), size: options.body.length, state: 'uploaded', digest: `sha256:${createHash('sha256').update(options.body).digest('hex')}` };
      state.assets.push(asset);
      return respond(asset, 201);
    }
    if (method === 'DELETE' && endpoint.startsWith('/releases/assets/')) {
      state.assets = state.assets.filter(({ id }) => id !== Number(endpoint.split('/').at(-1)));
      return respond(null, 204);
    }
    if (method === 'GET' && endpoint === '/git/ref/heads/master') return respond({ object: { sha: head } });
    if (method === 'PATCH' && endpoint === '/releases/1') {
      Object.assign(state.release, json);
      return respond(state.release);
    }
    throw new Error(`Unexpected GitHub request: ${method} ${url}`);
  };
  return { state, fetchImpl };
}

const publish = (fixture, fake) => publishPdfs({ directory: fixture.directory, repository, sha, token: 'test-token', fetchImpl: fake.fetchImpl });

test('publishes a draft only after uploading and verifying every asset', async t => {
  const files = await fixture(t);
  const fake = github();
  await publish(files, fake);
  assert.equal(fake.state.tag, sha);
  assert.equal(fake.state.release.draft, false);
  assert.equal(fake.state.release.make_latest, 'true');
  assert.equal(fake.state.assets.length, 2);
  assert.equal(fake.state.assets[0].label, 'notes/中文.pdf');
  const publication = fake.state.calls.findIndex(({ method }) => method === 'PATCH');
  assert.ok(publication > fake.state.calls.findLastIndex(({ method }) => method === 'POST'));
});

test('rerunning a complete release accepts changed PDF timestamps without modifying it', async t => {
  const files = await fixture(t);
  const fake = github();
  await publish(files, fake);
  await writeFile(path.join(files.directory, 'assets', pdfAsset), '%PDF-1.7 rebuilt with a different timestamp');
  await files.refreshManifest();
  fake.state.calls.length = 0;
  await publish(files, fake);
  assert.ok(fake.state.calls.every(({ method }) => method === 'GET'));
});

test('failed upload leaves a draft that a subsequent run repairs', async t => {
  const files = await fixture(t);
  const fake = github();
  fake.state.failUpload = true;
  await assert.rejects(publish(files, fake), /503/);
  assert.equal(fake.state.release.draft, true);
  assert.ok(fake.state.calls.every(({ method }) => method !== 'PATCH'));
  fake.state.failUpload = false;
  fake.state.assets.push({ id: 99, name: pdfAsset, size: 0, state: 'starter', digest: null });
  await publish(files, fake);
  assert.equal(fake.state.release.draft, false);
  assert.equal(fake.state.assets.length, 2);
  assert.ok(fake.state.calls.some(({ method }) => method === 'DELETE'));
  assert.equal(fake.state.calls.filter(({ method, endpoint }) => method === 'POST' && endpoint === '/releases').length, 1);
});

test('a historical commit publishes without replacing Latest', async t => {
  const files = await fixture(t);
  const fake = github({ head: 'b'.repeat(40) });
  await publish(files, fake);
  assert.equal(fake.state.release.make_latest, 'false');
});

test('corrupt local artifacts fail before any GitHub write or read', async t => {
  const files = await fixture(t);
  const fake = github();
  await writeFile(path.join(files.directory, 'assets', pdfAsset), 'truncated');
  await assert.rejects(publish(files, fake), /Corrupt PDF build artifact/);
  assert.equal(fake.state.calls.length, 0);
});

test('published attachment corruption and a tag pointing elsewhere fail without repair', async t => {
  const files = await fixture(t);
  const fake = github();
  await publish(files, fake);
  fake.state.assets[0].digest = `sha256:${'c'.repeat(64)}`;
  fake.state.calls.length = 0;
  await assert.rejects(publish(files, fake), /mismatched Release attachment/);
  assert.ok(fake.state.calls.every(({ method }) => method === 'GET'));
  fake.state.tag = 'd'.repeat(40);
  await assert.rejects(publish(files, fake), /does not point/);
});
