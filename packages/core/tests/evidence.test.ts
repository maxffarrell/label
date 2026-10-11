import { describe, expect, it } from 'vitest';
import {
	humanLabelOverrides,
	listChangedFiles,
	listItemConversation,
	parseGitHubPayload,
} from '../src/github';
import { collectDecisions, labelsToApply, labelsToRemove } from '../src/jev';
import { labelIssues } from '../src/label';
import { parseLabelPolicy } from '../src/policy';

describe('human label decisions', () => {
	it('retains the latest human decision despite later bots, including bots without a suffix', () => {
		const events = [
			{
				event: 'labeled',
				label: { name: 'Parity' },
				actor: { login: 'maintainer', type: 'User' },
				created_at: '2026-10-01T00:00:00Z',
			},
			{
				event: 'unlabeled',
				label: { name: 'parity' },
				actor: { login: 'maintainer', type: 'User' },
				created_at: '2026-10-02T00:00:00Z',
			},
			{
				event: 'labeled',
				label: { name: 'parity' },
				actor: { login: 'Copilot', type: 'Bot' },
				created_at: '2026-10-03T00:00:00Z',
			},
			{
				event: 'labeled',
				label: { name: 'parity' },
				actor: { login: 'github-actions[bot]', type: 'Bot' },
				created_at: '2026-10-04T00:00:00Z',
			},
		];
		expect(humanLabelOverrides(events.reverse())).toEqual([
			{
				name: 'parity',
				action: 'unlabeled',
				author: 'maintainer',
				createdAt: '2026-10-02T00:00:00Z',
			},
		]);
	});

	it('blocks a high-score reapplication and preserves a human-added label with a low score', () => {
		const parsed = parseGitHubPayload({
			issue: { number: 2915, title: 'Dependency conflict', labels: ['bug', 'duplicate'] },
			label_overrides: [
				{
					name: 'Duplicate',
					action: 'unlabeled',
					author: 'maintainer',
					createdAt: '2026-10-06T20:18:39Z',
				},
				{
					name: 'bug',
					action: 'labeled',
					author: 'maintainer',
					createdAt: '2026-10-06T20:18:39Z',
				},
			],
		});
		if (parsed.isErr()) throw parsed.error;
		const [decision] = collectDecisions(
			[parsed.value],
			[
				{ name: 'duplicate', description: null },
				{ name: 'bug', description: null },
			],
			{ item_0_label_0: { noul: 0.89 }, item_0_label_1: { noul: 0.01 } },
			0.6
		);
		expect(labelsToApply(decision!)).toEqual([]);
		expect(labelsToRemove(decision!)).toEqual(['duplicate']);
	});

	it('lets a later human addition supersede a removal', () => {
		expect(
			humanLabelOverrides([
				{
					event: 'unlabeled',
					label: { name: 'bug' },
					actor: { login: 'maintainer', type: 'User' },
					created_at: '2026-10-01T00:00:00Z',
				},
				{
					event: 'labeled',
					label: { name: 'bug' },
					actor: { login: 'maintainer', type: 'User' },
					created_at: '2026-10-02T00:00:00Z',
				},
			])[0]?.action
		).toBe('labeled');
	});
});

describe('uncertain provider answers', () => {
	it.each([
		undefined,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		-0.1,
		1.1,
	])('does not remove a label for missing/invalid answer %s', (score) => {
		const item = {
			type: 'issue' as const,
			number: 1,
			title: 'Bug',
			body: '',
			currentLabels: ['bug'],
			comments: [],
		};
		const answers: Record<string, { noul: number }> =
			score === undefined ? {} : { item_0_label_0: { noul: score } };
		const [decision] = collectDecisions(
			[item],
			[{ name: 'bug', description: null }],
			answers,
			0.6
		);
		expect(labelsToApply(decision!)).toEqual([]);
		expect(labelsToRemove(decision!)).toEqual([]);
	});
});

describe('policy validation', () => {
	it('rejects the production removed_when typo with an actionable error', () => {
		const result = parseLabelPolicy(
			'labels:\n  awaiting submitter:\n    removed_when: Submitter replied\n'
		);
		expect(result.isErr()).toBe(true);
		if (result.isErr()) expect(result.error.detail).toContain('Use remove_when');
	});
	it('rejects misspelled root configuration', () => {
		expect(parseLabelPolicy('only_configurd: true').isErr()).toBe(true);
	});
});

describe('PR context', () => {
	it('retains empty approvals at their submitted time and marks Copilot as a bot', async () => {
		const result = await listItemConversation(
			{ owner: 'o', name: 'r' },
			{ type: 'pull_request', number: 1 },
			{
				token: 'test',
				fetch: async (input) =>
					Response.json(
						String(input).includes('/reviews')
							? [
									{
										user: { login: 'maintainer', type: 'User' },
										author_association: 'COLLABORATOR',
										state: 'APPROVED',
										body: '',
										submitted_at: '2026-10-01T00:00:00Z',
									},
									{
										user: { login: 'Copilot', type: 'Bot' },
										author_association: 'CONTRIBUTOR',
										state: 'COMMENTED',
										body: 'Review.',
										submitted_at: '2026-10-02T00:00:00Z',
									},
								]
							: []
					),
			}
		);
		if (result.isErr()) throw result.error;
		expect(result.value).toMatchObject([
			{ body: '', reviewState: 'APPROVED', createdAt: '2026-10-01T00:00:00Z', isBot: false },
			{ author: 'Copilot', isBot: true },
		]);
	});

	it('bounds file context and omits patches', async () => {
		const files = Array.from({ length: 102 }, (_, i) => ({
			filename: `file-${i}.ts`,
			status: 'modified',
			additions: 1,
			deletions: 1,
			patch: 'do not include',
		}));
		const result = await listChangedFiles({ owner: 'o', name: 'r' }, 1, {
			token: 'test',
			fetch: async (input) =>
				Response.json(new URL(String(input)).searchParams.get('page') === '1' ? files : []),
		});
		if (result.isErr()) throw result.error;
		expect(result.value.omitted).toBe(2);
		expect(result.value.files).toHaveLength(100);
		expect(result.value.files[0]).not.toHaveProperty('patch');
	});

	it('loads GitHub evidence and enforces the override before any mutation', async () => {
		const writes: string[] = [];
		const result = await labelIssues({
			repo: 'o/r',
			numbers: [1],
			token: 'test',
			remove: true,
			fetch: async (input, init) => {
				const url = String(input);
				if (init?.method && init.method !== 'GET') {
					writes.push(init.method);
					return Response.json({});
				}
				if (url.endsWith('/issues/1'))
					return Response.json({
						number: 1,
						title: 'Fix',
						pull_request: {},
						labels: ['docs'],
					});
				if (url.includes('/events'))
					return Response.json([
						{
							event: 'unlabeled',
							label: { name: 'duplicate' },
							actor: { login: 'maintainer', type: 'User' },
							created_at: '2026-10-01T00:00:00Z',
						},
						{
							event: 'labeled',
							label: { name: 'docs' },
							actor: { login: 'maintainer', type: 'User' },
							created_at: '2026-10-01T00:00:00Z',
						},
					]);
				if (url.includes('/files'))
					return Response.json([
						{
							filename: 'docs/guide.md',
							status: 'modified',
							additions: 2,
							deletions: 1,
						},
					]);
				if (url.includes('/labels'))
					return Response.json([
						{ name: 'duplicate', description: null },
						{ name: 'docs', description: null },
					]);
				return Response.json([]);
			},
			ask: async ({ state }) => {
				expect(state).toMatchObject({
					items: [
						{
							files: [{ filename: 'docs/guide.md' }],
							labelOverrides: [
								{ name: 'duplicate', action: 'unlabeled' },
								{ name: 'docs', action: 'labeled' },
							],
						},
					],
				});
				return {
					answers: { item_0_label_0: { noul: 0.99 }, item_0_label_1: { noul: 0.01 } },
				};
			},
		});
		expect(result.isOk()).toBe(true);
		expect(writes).toEqual([]);
	});
});
