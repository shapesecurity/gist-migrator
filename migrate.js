#!/usr/bin/env node
/*
   Copyright 2022 F5, Inc.

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/

const { spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { Octokit } = require('@octokit/rest');
const { Gitlab: Gitbeaker } = require('@gitbeaker/node');
const prompts = require('prompts');

(async () => {
  const options = {
    githubUrl: 'https://api.github.com',
    gitlabUrl: 'https://gitlab.com',
    githubAccessToken: process.env.GITHUB_ACCESS_TOKEN,
    gitlabAccessToken: process.env.GITLAB_ACCESS_TOKEN,
    force: false,
  };
  let promptsConfig = [
    {
      type: 'text',
      name: 'githubUrl',
      message: 'GitHub API URL',
      initial: options.githubUrl,
      validate: value => {
        try {
          new URL(value);
        } catch {
          return 'URL invalid';
        }
        return true;
      },
      format: value => new URL(value).origin,
    },
    {
      type: 'text',
      name: 'gitlabUrl',
      message: 'GitLab API URL',
      initial: options.gitlabUrl,
      validate: value => {
        try {
          new URL(value);
        } catch {
          return 'URL invalid';
        }
        return true;
      },
      format: value => new URL(value).origin,
    },
  ];

  if (options.githubAccessToken == null || options.githubAccessToken === '') {
    promptsConfig.push({
      type: 'password',
      name: 'githubAccessToken',
      message: 'GitHub access token:',
      validate: v => v != null && v !== '' || 'invalid access token',
    });
  }

  if (options.gitlabAccessToken == null || options.gitlabAccessToken === '') {
    promptsConfig.push({
      type: 'password',
      name: 'gitlabAccessToken',
      message: 'GitLab access token:',
      validate: v => v != null && v !== '' || 'invalid access token',
    });
  }

  Object.assign(options, await prompts(promptsConfig));

  if (options.githubAccessToken == null || options.gitlabAccessToken == null) {
    // the user cancelled the input prompt with Ctrl-C or Ctrl-D
    throw new Error('Access tokens not supplied.');
  }

  const octokit = new Octokit({
    auth: options.githubAccessToken,
    baseUrl: options.githubUrl,
  });
  const gitbeaker = new Gitbeaker({
    token: options.gitlabAccessToken,
    host: options.gitlabUrl,
  });

  const gists = [];

  console.log('Fetching gist data...');

  for await (const response of octokit.paginate.iterator(octokit.rest.gists.list, {})) {
    if (response.status < 200 || response.status >= 300) {
      console.error(response);
      break;
    }
    gists.push(...response.data);
  }
  gists.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  console.log(`Fetched data for ${gists.length} gist${gists.length === 1 ? '' : 's'}.`);

  console.log('Fetching snippet data...');

  const snippets = await gitbeaker.Snippets.all();

  console.log(`Fetched data for ${snippets.length} snippet${snippets.length === 1 ? '' : 's'}.`);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gists-'));
  if (tempDir === '' || tempDir === '/') {
    throw new Error('Something went wrong.');
  }
  try {
    await fs.stat(tempDir);
  } catch {
    throw new Error('Failed to create temporary directory.');
  }

  for (const gist of gists) {
    const humanName = `${gist.id} (${generateSnippetTitle(gist)})`;
    const dirName = path.join(tempDir, gist.id);

    if (!options.force) {
      const existingSnippet = snippets.find(snippet => equivalent(gist, snippet));
      if (existingSnippet != null) {
        console.log(`Skipping ${humanName}. Already migrated to ${existingSnippet.web_url}.`);
        continue;
      }
    }

    console.log(`Migrating ${humanName}.`);
    const { error, status, stderr } = spawnSync('ssh-agent', ['git', 'clone', '--depth', '1', convertHTTPToGit(gist.git_pull_url), dirName]);
    if (error != null) {
      console.error(error.toString().trim());
      continue;
    }
    if (status !== 0) {
      console.error(stderr.toString().trim());
      continue;
    }

    const filenames = Object.keys(gist.files);
    if (filenames.length > 10) {
      console.error('Unable to migrate, as snippets are limited to 10 files each.');
      continue;
    }

    const files = await Promise.all(filenames.map(async filename =>
      ({
        file_path: filename,
        content: await fs.readFile(path.join(dirName, filename), { encoding: 'utf8' }),
      }),
    ));

    const snippet = await gitbeaker.Snippets.create(null, void 0, void 0, null, {
      title: generateSnippetTitle(gist),
      description: generateSnippetDescription(gist),
      visibility: generateSnippetVisibility(gist),
      files,
    });

    console.log(`Migrated to ${snippet.web_url}`);
  }

  await fs.rm(tempDir, { recursive: true });

  console.log('Done.');
})();

function generateSnippetTitle(gist) {
  return gist.description == null || gist.description === '' ? Object.keys(gist.files).join(', ') : gist.description;
}

function generateSnippetDescription(gist) {
  return `Migrated from ${gist.html_url}`;
}

function generateSnippetVisibility(gist) {
  return gist.public ? 'internal' : 'private';
}

function equivalent(gist, snippet) {
  const gistFiles = new Set(Object.keys(gist.files));
  const snippetFiles = new Set(snippet.files.map(f => f.path));
  return snippet.visibility === generateSnippetVisibility(gist) &&
    snippet.title === generateSnippetTitle(gist) &&
    snippet.description === generateSnippetDescription(gist) &&
    gistFiles.size === snippetFiles.size &&
    [...gistFiles.keys()].every(k => snippetFiles.has(k));
}

const HTTP_REGEXP = /^https?:\/\/([^/]+)\/([a-f0-9]+)\.git/;
function convertHTTPToGit(url) {
  const match = HTTP_REGEXP.exec(url);
  if (match == null) {
    return url;
  }
  const [, host, id] = match;
  return `git@${host}:${id}.git`;
}
