import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeAsset, publishedManifest, validateManifest, verifyRemoteAssets } from './pdf-common.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function publishPdfs({ directory = path.join(root, 'dist'), repository, sha, token,
  apiRoot = 'https://api.github.com', fetchImpl = fetch, summaryFile }) {
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !/^[a-f\d]{40}$/.test(sha || '')) {
    throw new Error('GITHUB_TOKEN, GITHUB_REPOSITORY and a full GITHUB_SHA are required');
  }
  const manifest = validateManifest(JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')), sha, repository);
  // Check the downloaded artifact before making any changes to GitHub.
  for (const expected of manifest.assets) {
    const actual = await describeAsset(path.join(directory, 'assets', expected.name));
    if (actual.size !== expected.size || actual.sha256 !== expected.sha256) throw new Error(`Corrupt PDF build artifact: ${expected.name}`);
  }

  const repoPath = `/repos/${repository}`;
  const tag = `pdf-${sha}`;
  async function request(endpoint, { method = 'GET', json, file, allow404 = false } = {}) {
    const url = endpoint.startsWith('https://') ? endpoint : `${apiRoot}${endpoint}`;
    const response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': file ? (endpoint.includes('.zip') ? 'application/zip' : 'application/pdf') : 'application/json',
      },
      body: file || (json === undefined ? undefined : JSON.stringify(json)),
      signal: AbortSignal.timeout(120_000),
    });
    if (allow404 && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub ${method} ${new URL(url).pathname}: ${response.status} ${await response.text()}`);
    return response.status === 204 ? null : response.json();
  }
  async function listAssets(release) {
    const assets = [];
    for (let page = 1; ; page++) {
      const batch = await request(`${repoPath}/releases/${release.id}/assets?per_page=100&page=${page}`);
      assets.push(...batch);
      if (batch.length < 100) return assets;
    }
  }
  async function summarize(release, message) {
    console.log(`${message}: ${release.html_url}`);
    if (summaryFile) {
      await appendFile(summaryFile, `PDF Release: [${tag}](${release.html_url})\n\n${manifest.documents.length} PDFs and a complete ZIP archive.\n`);
    }
  }

  let reference = await request(`${repoPath}/git/ref/tags/${tag}`, { allow404: true });
  if (reference && reference.object.sha !== sha) throw new Error(`Tag ${tag} does not point to the built commit`);
  let release = await request(`${repoPath}/releases/tags/${tag}`, { allow404: true });
  if (!release) {
    // REST lookup by tag only finds published releases. Locate a pending draft
    // with GraphQL so retries do not create a second release for the same tag.
    const [owner, name] = repository.split('/');
    const result = await request('/graphql', { method: 'POST', json: {
      query: 'query($owner: String!, $name: String!, $tag: String!) { repository(owner: $owner, name: $name) { release(tagName: $tag) { databaseId isDraft } } }',
      variables: { owner, name, tag },
    } });
    if (result.errors?.length) throw new Error(`Cannot look up draft Release: ${result.errors.map(error => error.message).join('; ')}`);
    const draft = result.data?.repository?.release;
    if (draft?.isDraft) release = await request(`${repoPath}/releases/${draft.databaseId}`);
  }
  if (release && !release.draft) {
    if (!reference) throw new Error('Published Release is missing its commit tag');
    // Chromium embeds build timestamps. Verify against the original publication,
    // so a fresh build of the same commit can reuse the complete immutable Release.
    verifyRemoteAssets(publishedManifest(release.body, manifest), await listAssets(release));
    await summarize(release, 'Release already published; attachments verified');
  } else {
    if (!reference) {
      reference = await request(`${repoPath}/git/refs`, { method: 'POST', json: { ref: `refs/tags/${tag}`, sha } });
    }
    const downloads = manifest.documents.map(({ source, asset }) => `| ${source.replaceAll('|', '\\|')} | [PDF](https://github.com/${repository}/releases/download/${tag}/${asset}) |`).join('\n');
    const body = `PDFs built from [${sha}](https://github.com/${repository}/commit/${sha}).\n\n${manifest.documents.length} Markdown documents converted to PDF. Download individual PDFs or antenna-course-pdfs.zip for the full collection.\n\n| 講義 | 下載 |\n| --- | --- |\n${downloads}\n\n<!-- pdf-manifest:${Buffer.from(JSON.stringify(manifest)).toString('base64')} -->`;
    if (!release) {
      release = await request(`${repoPath}/releases`, { method: 'POST', json: { tag_name: tag, target_commitish: sha, name: `PDF ${sha.slice(0, 12)}`, body, draft: true, prerelease: false } });
    }
    // A failed run may leave a partial draft. Reuse matching files and repair only this draft.
    let remote = await listAssets(release);
    for (const asset of remote) {
      const expected = manifest.assets.find(({ name }) => name === asset.name);
      if (!expected || asset.state !== 'uploaded' || asset.size !== expected.size || asset.digest !== `sha256:${expected.sha256}`) {
        await request(`${repoPath}/releases/assets/${asset.id}`, { method: 'DELETE' });
        remote = remote.filter(({ id }) => id !== asset.id);
      }
    }
    for (const asset of manifest.assets) {
      if (remote.some(({ name }) => name === asset.name)) continue;
      console.log(`Uploading ${asset.name}`);
      const url = new URL(release.upload_url.replace(/\{.*\}$/, ''));
      url.searchParams.set('name', asset.name);
      const document = manifest.documents.find(document => document.asset === asset.name);
      if (document) url.searchParams.set('label', document.pdf);
      await request(url.href, { method: 'POST', file: await readFile(path.join(directory, 'assets', asset.name)) });
    }
    verifyRemoteAssets(manifest, await listAssets(release));
    const head = await request(`${repoPath}/git/ref/heads/master`);
    release = await request(`${repoPath}/releases/${release.id}`, { method: 'PATCH', json: { body, draft: false, make_latest: head.object.sha === sha ? 'true' : 'false' } });
    await summarize(release, 'Published PDF Release');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await publishPdfs({ repository: process.env.GITHUB_REPOSITORY, sha: process.env.GITHUB_SHA,
    token: process.env.GITHUB_TOKEN, apiRoot: process.env.GITHUB_API_URL,
    summaryFile: process.env.GITHUB_STEP_SUMMARY });
}
