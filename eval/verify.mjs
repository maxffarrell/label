import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const fixtures = JSON.parse(
	await readFile(new URL('./fixtures/shadcn-svelte.json', import.meta.url))
);
const fixtureHash = createHash('sha256').update(JSON.stringify(fixtures)).digest('hex');
const cases = new Map(fixtures.cases.map((fixture) => [fixture.id, fixture]));
assert.equal(cases.size, fixtures.cases.length, 'Case IDs must be unique');
const checkCount = fixtures.cases.reduce((sum, fixture) => sum + fixture.expectations.length, 0);
const expectedLabels = fixtures.labels.map((label) => label.name).sort();

for (const phase of ['baseline', 'updated']) {
	const result = JSON.parse(await readFile(new URL(`./results/${phase}.json`, import.meta.url)));
	assert.equal(result.complete, true, `${phase}: incomplete run`);
	assert.equal(result.fixtureHash, fixtureHash, `${phase}: stale fixture hash`);
	assert.equal(result.threshold, fixtures.threshold);
	assert.equal(result.baseline, fixtures.baseline);
	assert.match(result.implementationHash, /^[a-f0-9]{64}$/);
	assert.equal(result.results.length, fixtures.cases.length * result.repeats);
	const seen = new Set();
	let passed = 0;
	for (const row of result.results) {
		const fixture = cases.get(row.case);
		assert.ok(fixture, `${phase}: unknown case`);
		assert.ok(row.repeat >= 1 && row.repeat <= result.repeats);
		const id = `${row.case}:${row.repeat}`;
		assert.ok(!seen.has(id), `${phase}: duplicate case/repeat`);
		seen.add(id);
		assert.deepEqual(Object.keys(row.scores).sort(), expectedLabels);
		assert.ok(
			Object.values(row.scores).every(
				(score) => Number.isFinite(score) && score >= 0 && score <= 1
			)
		);
		assert.equal(row.checks.length, fixture.expectations.length);
		for (const [index, check] of row.checks.entries()) {
			const expectation = fixture.expectations[index];
			assert.equal(check.label, expectation.label);
			assert.equal(check.action, expectation.action);
			assert.equal(check.expected, expectation.expected);
			assert.equal(check.score, row.scores[check.label]);
			const actual =
				check.action === 'add'
					? row.additions.includes(check.label)
					: check.action === 'remove'
						? row.removals.includes(check.label)
						: row.selected.includes(check.label);
			assert.equal(check.actual, actual);
			assert.equal(check.passed, actual === check.expected);
			if (check.passed) passed++;
		}
	}
	assert.equal(result.total, checkCount * result.repeats);
	assert.equal(result.passed, passed);
	console.log(
		`${phase}: ${passed}/${result.total} (${((100 * passed) / result.total).toFixed(1)}%), verified`
	);
}
