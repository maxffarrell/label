[![npm version](https://flat.badgen.net/npm/v/@ieedan/label?color=yellow)](https://npmjs.com/package/@ieedan/label)
[![npm downloads](https://flat.badgen.net/npm/dm/@ieedan/label?color=yellow)](https://npmjs.com/package/@ieedan/label)

# `@ieedan/label`

A super fast issue/PR labeler built on top of TypeSafe AI's Jev.

Intelligently label issues and pull requests based on their content and history.

## Usage 

You will need a few environment variables:

```sh
TYPESAFE_API_KEY=apikey_...
GITHUB_TOKEN=github_pat_... # you can use the actions one in workflows
```

Then you can use the CLI to label issues and pull requests. (We recommend using the `--dry-run` flag so you can tune what get's applied)

The repository is detected from the git remote (`origin`, then `upstream`) of the repository you run in, so `-R` is only needed when you want to label a different repository.

```sh
npx @ieedan/label label --top 5 # top 5 issues/pulls in the current repository
npx @ieedan/label label -R ieedan/shadcn-svelte-extras --top 5 # label a different repository
npx @ieedan/label label -R ieedan/shadcn-svelte-extras --all --issues # all issues
npx @ieedan/label label -R ieedan/shadcn-svelte-extras --all --prs # all pulls
npx @ieedan/label label -R ieedan/shadcn-svelte-extras --prompt "Never apply the 'help wanted' label" # extra steering
npx @ieedan/label label -R ieedan/shadcn-svelte-extras --dry-run # don't apply any labels
npx @ieedan/label label -R ieedan/shadcn-svelte-extras --threshold 0.5 # default (0.6) minimum confidence score to apply a label
npx @ieedan/label label -R ieedan/shadcn-svelte-extras --include-closed # include closed issues/pulls
npx @ieedan/label label -R ieedan/shadcn-svelte-extras --remove # also remove labels that no longer apply
npx @ieedan/label label -R ieedan/shadcn-svelte-extras --config policies/frontend.yml # use a policy file other than .label.yml
```

Optionally add a `.label.yml` at the repo root to give more guidance on when to apply and remove specific labels.

```yml
prompt: Prefer specific labels over generic ones.

labels:
  bug:
    apply_when: Something isn't working
    remove_when: The report is a feature request, not a defect
    examples:
      - Crash when a required token is missing
    threshold: 0.7
  duplicate:
    context: similar_issues # add similar issues as context
    apply_when: This issue or pull request already exists
  enhancement:
    apply_when: New feature or request
  good first issue:
    apply_when: A solution has already been proposed and agreed upon by the maintainers
    can_apply: false
    can_remove: false

only_configured: true # only apply labels that are configured in this file
```

Policy keys are validated strictly. For example, use `remove_when`, not
`removed_when`; unknown keys now fail instead of being silently ignored. Thresholds
must be finite numbers between 0 and 1.

### Evidence and human label decisions

The GitHub CLI flow reads label events as well as the conversation. The latest
human (`User`) action on each label remains authoritative even if a bot subsequently
contradicts it: a human removal blocks reapplication, and a human addition protects
the label from automatic removal. A later human action supersedes the earlier one.
This applies to all human label actors, without inferring repository permissions
from comment associations. Automation using a personal GitHub token also appears
as a human actor and is therefore protected.

`--remove` is still opt-in and `can_remove: false` is respected. It can reconcile a
bot label against an explicit human removal, or remove an unprotected label scoring
below `1 - threshold`. Missing, non-finite, or out-of-range provider answers never
cause automatic label removal. Human-added state labels such as `needs reproduction`
must be removed by a human; they are not silently handed back to automation.

PR context includes up to 100 changed-file metadata entries, an omitted-file count,
bot identity, review state, and empty-body approvals with their submitted time. The
model is instructed to distinguish duplicate reports from fixes, requested
replacement PRs, upstream causes, and related work; uncertain interpretation can
still produce mistakes. No fork code is executed. Consumers of the low-level
`label()` API can provide `label_overrides` and `files` in the payload; without
those fields it cannot infer historical human actions or changed-file scope.

The default workflow examples do not enable removal. A repository must explicitly
enable `--remove` to reconcile stale labels, and a review only causes reevaluation
if the repository's integration invokes the CLI for that event.

See the [shadcn-svelte replay results](./eval/README.md) for the live before/after
comparison, remaining failures, and reproduction instructions.

### Workflow integration

Check out our examples in the [`examples/github-workflows`](./examples/github-workflows) directory.

This workflow will automatically label issues and pull requests when they are created or updated.
```yml
name: Label

on:
    issues:
        types: [opened, edited, reopened]
    pull_request_target:
        types: [opened, edited, reopened, ready_for_review]
    issue_comment:
        types: [created, edited]

concurrency:
    group: label-${{ github.repository }}-${{ github.event.issue.number || github.event.pull_request.number }}
    cancel-in-progress: true

permissions:
    contents: read
    issues: write
    pull-requests: write

jobs:
    label:
        if: github.event.comment.user.login != 'github-actions[bot]'
        runs-on: ubuntu-latest
        timeout-minutes: 10
        steps:
            - uses: actions/checkout@v4

            - uses: actions/setup-node@v4
              with:
                  node-version: 24

            - name: Label
              env:
                  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
                  TYPESAFE_API_KEY: ${{ secrets.TYPESAFE_API_KEY }}
              run: npx --yes @ieedan/label label -R "$GITHUB_REPOSITORY" "${{ github.event.issue.number || github.event.pull_request.number }}"
```
