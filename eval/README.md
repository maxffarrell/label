# shadcn-svelte label replay

The baseline is `ieedan/label@47f83c37073c98275f6d859cbed928180ee88766`, the source of
CLI `0.0.1`. Both versions use the same TypeSafe SDK, policy definitions, fixed
candidate sets, fixtures, and **0.6** threshold. Evaluation ran October 11, 2026.

There are 16 public shadcn-svelte snapshots and one explicitly synthetic positive
duplicate control, with 38 targeted acceptance checks. Each snapshot is evaluated
in its own request, repeated three times. At most four snapshots run concurrently.
The runner only calls TypeSafe: it does not instantiate a GitHub client or write
labels. GitHub context loading and mutation protection are covered separately by
unit/integration tests.

## Before and after

| Acceptance checks | Baseline | Updated |
| --- | ---: | ---: |
| All targeted checks, three repeats | 73/114 (64.0%) | 105/114 (92.1%) |
| Human-removed labels not reapplied | 3/18 | 18/18 |
| Official-demo reproduction handling | 9/12 | 12/12 |
| Unconfirmed dependency report: no bug, CLI retained, no feature | 6/9 | 9/9 |
| Changelog scope clarification, including duplicate removal | 6/9 | 9/9 |
| Existing docs PR: docs retained, no contribution invitation/waiting | 3/9 | 9/9 |
| Confirmed animation defect: bug/workaround retained, no feature | 6/9 | 9/9 |
| Explicit duplicate positive control | 3/3 | 3/3 |

Raw results include every label score and the actual additions/removals that would
be proposed with removal enabled:

- [Baseline results](./results/baseline.json)
- [Updated results](./results/updated.json)
- [Frozen fixtures and expectations](./fixtures/shadcn-svelte.json)

These are development-set acceptance rates, **not repository accuracy, precision,
or recall estimates**. Checks within a case and repeated service calls are not
independent samples. Human override checks exercise deterministic mutation gates;
other checks exercise model interpretation. Correct positive controls are included
to expose lost labels rather than merely rewarding abstention.

## Remaining failures and regressions

The updated version still fails nine of 114 checks:

- #2905: the requested replacement PR is still classified as a duplicate in one
  of three runs (score 0.60), down from three failures on baseline. The earlier
  guard request is in #2904's comments, which candidate-body retrieval does not load.
- #2908: a maintainer-authored defect fix misses `bug` once (0.54). Baseline retained
  `bug` in all three runs. The issue confirmation rule needs a clearer PR distinction.
- #2922: `awaiting submitter` remains in the removal hysteresis band in all three
  runs (0.45–0.55); merely ceasing to select it is not enough for automatic removal.
  Baseline also fails this removal in all three runs. A separate, evidenced
  resolution decision remains necessary. `needs reproduction` removal succeeds.
- #2916: toast component work still gets `cli` in all three runs (0.64–0.67), whereas
  baseline avoids that label. The new `feature` is also missed once, as on baseline.
  File metadata alone does not reliably establish public CLI scope.

The draft should not be promoted as fully solving duplicate retrieval, dynamic
label resolution, or public CLI classification. In particular, GitHub workflows
must still explicitly pass `--remove`; no removal default or live labels changed.

## Fixture limitations

Comments, reviews, and label events are filtered at each declared cutoff. Title,
body, author association, and PR file metadata come from the audit's current API
snapshot, because complete historical revisions were not available. Each case
states its limitations. The toast case intentionally checks the latest port scope,
not the earlier exploration. Candidate sets are frozen controls, not a benchmark
of GitHub search retrieval. The gold checks are audit judgments, not a
maintainer-reviewed comprehensive labeling dataset.

An exploratory batched run was discarded because multiple snapshots of the same
issue shared a request and could expose later context to earlier cases. The scored
comparison isolates snapshots. One proposed workaround-positive expectation was
removed before this comparison: a bare external issue link did not establish a
local workaround in the available input. Neither that pilot nor that ambiguous
expectation is included in the reported totals.

The fixture hash uses canonical `JSON.stringify` serialization. Result files also
record the compiled implementation hash and individual request hashes. Service
outputs are nondeterministic and TypeSafe's backend version is not pinned. These
fixtures are a starting regression set; a separate maintainer-reviewed holdout is
needed before broader deployment claims.

The additional GitHub context requires paginated label-event reads and PR file
reads. Human decisions are enforced from that read-time snapshot; a human edit
during a long inference request still requires a subsequent invocation to refresh
the history. Rechecking immediately before mutation is a follow-up improvement.

## Reproduce

Install and build the proposed version with `pnpm install --frozen-lockfile` and
`pnpm build`. Supply `TYPESAFE_API_KEY` through the process environment or a secret
manager; do not put the value in a command, fixture, report, or tracked file.

```sh
node eval/run.mjs --output /tmp/label-updated.json --repeats 3
```

Build the baseline in a separate checkout of commit
`47f83c37073c98275f6d859cbed928180ee88766`, using its frozen lockfile. From this
checkout, run the same runner and fixtures with the baseline module path:

```sh
node eval/run.mjs --module /path/to/baseline/packages/core/dist/index.mjs --output /tmp/label-baseline.json --repeats 3
```

Do not score incomplete result files. Use `node eval/verify.mjs` to verify the
committed fixture hashes, check totals, and baseline/updated comparisons offline.

## Integration migration

The existing shadcn-svelte policy uses `removed_when` for `awaiting submitter`.
Before adopting the strict parser, change it to `remove_when`; otherwise the CLI
will fail with an actionable configuration error. Existing human label changes
remain authoritative until a later human addition/removal supersedes them. This
includes template labels assigned under a human actor and automation using a
personal token. Human-added dynamic labels are not automatically relinquished.
