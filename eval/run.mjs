import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// This runner calls TypeSafe only. It never creates a GitHub client or mutates labels.
const args = process.argv.slice(2);
const option = (name, fallback) => {
	const index = args.indexOf(name);
	return index < 0 ? fallback : args[index + 1];
};
const modulePath = resolve(option('--module', 'packages/core/dist/index.mjs'));
const output = resolve(option('--output', 'eval/results/updated.json'));
const repeats = Number(option('--repeats', '3'));
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) {
	throw new Error('--repeats must be an integer from 1 to 10');
}
if (!process.env.TYPESAFE_API_KEY) {
	throw new Error('Set TYPESAFE_API_KEY in the process environment; never store it in fixtures.');
}

const core = await import(pathToFileURL(modulePath));
const require = createRequire(new URL('../packages/core/package.json', import.meta.url));
const { TypeSafeClient } = await import(pathToFileURL(require.resolve('@typesafe-ai/sdk')));
const client = new TypeSafeClient({ timeout: 120_000 });
const fixtureBytes = await readFile(new URL('./fixtures/shadcn-svelte.json', import.meta.url));
const fixtures = JSON.parse(fixtureBytes);
const items = fixtures.cases.map((fixture) => {
	const parsed = core.parseGitHubPayload(fixture.payload);
	if (parsed.isErr()) throw new Error(`Invalid fixture ${fixture.id}`);
	return parsed.value;
});
const localLabels = fixtures.labels.filter((label) => label.context !== 'similar_issues');
const contextLabels = fixtures.labels.filter((label) => label.context === 'similar_issues');
const requestHashes = [];
const ask = async (request) => {
	requestHashes.push(createHash('sha256').update(JSON.stringify(request)).digest('hex'));
	const response = await client.systemOne(request);
	const answers = {};
	for (const [id, answer] of Object.entries(response.answers)) {
		if (answer && typeof answer === 'object' && 'noul' in answer) {
			answers[id] = { noul: answer.noul };
		}
	}
	return { answers };
};

const results = [];
try {
	for (let repeat = 0; repeat < repeats; repeat++) {
		// Isolate temporal snapshots: a later reply must not leak into an earlier case.
		for (let offset = 0; offset < items.length; offset += 4) {
			const batch = await Promise.all(
				items.slice(offset, offset + 4).map(async (item, batchIndex) => {
					const index = offset + batchIndex;
					const options = { threshold: fixtures.threshold, ask };
					const local = await core.askLabels([item], localLabels, options);
					if (local.isErr()) throw new Error('Provider request failed');
					const contextual = await core.askContextLabels(
						[{ item, candidates: fixtures.cases[index].candidates }],
						contextLabels,
						options
					);
					if (contextual.isErr()) throw new Error('Provider request failed');
					const judgments = [...local.value[0].labels, ...contextual.value[0].labels];
					const decision = {
						item,
						labels: judgments,
						chosen: judgments.filter((label) => label.apply).map((label) => label.name),
					};
					const additions = core.labelsToApply(decision);
					const removals = core.labelsToRemove(decision);
					const checks = fixtures.cases[index].expectations.map((expectation) => {
						const judgment = judgments.find(
							(label) => label.name === expectation.label
						);
						const actual =
							expectation.action === 'add'
								? additions.includes(expectation.label)
								: expectation.action === 'remove'
									? removals.includes(expectation.label)
									: judgment.apply;
						return {
							...expectation,
							actual,
							passed: actual === expectation.expected,
							score: judgment.noul,
						};
					});
					return {
						repeat: repeat + 1,
						case: fixtures.cases[index].id,
						additions,
						removals,
						checks,
						scores: Object.fromEntries(
							judgments.map((label) => [label.name, label.noul])
						),
						selected: decision.chosen,
					};
				})
			);
			results.push(...batch);
		}
		console.log(`Completed repeat ${repeat + 1}/${repeats}`);
	}
} catch {
	// SDK errors may contain request metadata. Do not print provider errors or credentials.
	console.error('Live evaluation failed. No credentials or provider error payload were logged.');
	process.exitCode = 1;
}

const checks = results.flatMap((result) => result.checks);
if (checks.length) {
	await mkdir(dirname(output), { recursive: true });
	await writeFile(
		output,
		`${JSON.stringify(
			{
				evaluatedAt: new Date().toISOString(),
				implementationHash: createHash('sha256')
					.update(await readFile(modulePath))
					.digest('hex'),
				fixtureHash: createHash('sha256').update(JSON.stringify(fixtures)).digest('hex'),
				baseline: fixtures.baseline,
				threshold: fixtures.threshold,
				repeats,
				complete: results.length === repeats * fixtures.cases.length,
				requestHashes,
				passed: checks.filter((check) => check.passed).length,
				total: checks.length,
				results,
			},
			null,
			2
		)}\n`
	);
	console.log(
		`Acceptance checks: ${checks.filter((check) => check.passed).length}/${checks.length}`
	);
}
