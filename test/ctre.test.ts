import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildManifest,
	compareVersions,
	describeArtifacts,
	normalizeVersion,
	parseIndex,
	planCurrentReleases,
	type CtreIndex,
} from '../src/ctre.ts';

const index: CtreIndex = {
	LatestChannel: '2026',
	ChannelCompliancy: [
		{ Compliancy: 19, Name: '2026' },
		{ Compliancy: 21, Name: '2027-alpha-7' },
	],
	Tools: [
		{
			Name: 'owlet',
			Items: [
				{
					Version: '26.3.0',
					Compliancy: 19,
					Urls: {
						linuxarm64: 'https://redist.ctr-electronics.com/tools/owlet/26.3.0/owlet-linuxarm64',
						'linuxarm64-md5': 'md5',
						'linuxarm64-sha1': 'sha1',
						linuxsystemcore: 'https://redist.ctr-electronics.com/tools/owlet/26.3.0/owlet-linuxsystemcore',
						'linuxsystemcore-md5': 'md5',
						'linuxsystemcore-sha1': 'sha1',
					},
				},
				{ Version: '26.50.0-alpha-1', Compliancy: 19, Urls: {} },
				{ Version: '26.70.0', Compliancy: 21, Urls: {} },
			],
		},
		{ Name: 'corvus', Items: [{ Version: '26.3.0', Compliancy: 19, Urls: {} }] },
		{
			Name: 'PhoenixDiagnosticsProgram',
			Items: [{ Version: '26.3.0', Compliancy: 19, Urls: {} }],
		},
		{ Name: 'passerine', Items: [{ Version: '0.0.1', Compliancy: null, Urls: {} }] },
		{ Name: 'caniv', Items: [{ Version: '1.1.1.0', Compliancy: null, Urls: {} }] },
	],
};

void test('normalizes four-component CTRE versions without changing three-component versions', () => {
	assert.equal(normalizeVersion('1.1.1.0'), '1.1.1+ctre.0');
	assert.equal(normalizeVersion('26.3.0'), '26.3.0');
	assert.equal(normalizeVersion('26.50.0-alpha-1'), '26.50.0-alpha-1');
	assert.throws(() => normalizeVersion('release-1'));
});

void test('compares versions using SemVer precedence', () => {
	assert.ok(compareVersions('26.50.0', '26.3.0') > 0);
	assert.ok(compareVersions('26.50.0', '26.50.0-alpha-1') > 0);
	assert.equal(compareVersions('1.1.1.0', '1.1.1'), 0);
});

void test('plans the newest stable release and excludes newer CTRE channels and prereleases', () => {
	const plan = planCurrentReleases(index);
	assert.deepEqual(
		plan.map(({ tool, upstreamVersion, version }) => ({ tool, upstreamVersion, version })),
		[
			{ tool: 'owlet', upstreamVersion: '26.3.0', version: '26.3.0' },
			{ tool: 'corvus', upstreamVersion: '26.3.0', version: '26.3.0' },
			{
				tool: 'phoenix-diagnostics-server',
				upstreamVersion: '26.3.0',
				version: '26.3.0',
			},
			{ tool: 'passerine', upstreamVersion: '0.0.1', version: '0.0.1' },
			{ tool: 'caniv', upstreamVersion: '1.1.1.0', version: '1.1.1+ctre.0' },
		],
	);
});

void test('describes platform-specific artifacts and avoids a platform collision for SystemCore', () => {
	const artifacts = describeArtifacts(index, 'owlet', '26.3.0');
	assert.deepEqual(
		artifacts.map(({ platformName, platform }) => ({ platformName, platform })),
		[
			{
				platformName: 'linuxarm64',
				platform: { os: 'linux', arch: 'aarch64', libc: 'gnu' },
			},
			{
				platformName: 'linuxsystemcore',
				platform: {
					os: 'linux',
					arch: 'aarch64',
					libc: 'gnu',
					variant: 'systemcore',
				},
			},
		],
	);

	const manifest = buildManifest('owlet', artifacts);
	assert.match(manifest, /format = "raw"/);
	assert.match(manifest, /variant = "systemcore"/);
	assert.match(manifest, /bin = \["owlet"\]/);
});

void test('rejects malformed index data', () => {
	assert.throws(() => parseIndex({ LatestChannel: '2026' }));
});
