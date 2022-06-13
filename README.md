Gist Migrator
=============

## Information

Migrates a single user's GitHub [gists](https://docs.github.com/en/get-started/writing-on-github/editing-and-sharing-content-with-gists/creating-gists#about-gists)
to GitLab [snippets](https://docs.gitlab.com/ee/user/snippets.html). Secret
gists will become private snippets. Gists with more than 10 files will fail to
migrate due to an intentional limitation of GitLab snippets. On successive
runs, gists that have already been migrated will not be migrated again.

## Usage

Just run `npx gist-migrator` and follow the prompts. Use the default API URLs
to migrate gists from the public GitHub instance (github.com) to the public
GitLab instance (gitlab.com).

GitHub personal access tokens can be created at https://github.com/settings/tokens

GitLab personal access tokens can be created at https://gitlab.com/-/profile/personal_access_tokens

Access tokens can optionally be provided via the `GITHUB_ACCESS_TOKEN` and
`GITLAB_ACCESS_TOKEN` environment variables.

## License

```
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
```
