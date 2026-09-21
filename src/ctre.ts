import { createHash } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { pipeline, withHttpError, withJsonResponse } from 'fetch-extras';
import { compare, prerelease, valid } from 'semver';
import { z } from 'zod';

const CTRE_INDEX_URL = 'https://redist.ctr-electronics.com/index.json';
const CTRE_NOTES_URL = 'https://api.ctr-electronics.com/changelog.html';

const ctreReleaseSchema = z.object({
	Version: z.string(),
	Compliancy: z.number().nullable(),
	Urls: z.record(z.string(), z.string()),
});

const ctreIndexSchema = z.object({
	LatestChannel: z.string(),
	ChannelCompliancy: z.array(
		z.object({
			Compliancy: z.number(),
			Name: z.string(),
		}),
	),
	Tools: z.array(
		z.object({
			Name: z.string(),
			Items: z.array(ctreReleaseSchema),
		}),
	),
});

type CtreRelease = z.infer<typeof ctreReleaseSchema>;
export type CtreIndex = z.infer<typeof ctreIndexSchema>;

const fetchCtreIndex = pipeline(fetch, withHttpError(), withJsonResponse({ schema: ctreIndexSchema }));

interface ToolConfig {
	upstreamName: string;
	slug: string;
	bin: string;
}

interface Platform {
	os: string;
	arch?: string;
	libc?: string;
	variant?: string;
}

export interface PlannedRelease {
	tool: string;
	upstreamName: string;
	upstreamVersion: string;
	version: string;
	tag: string;
	bin: string;
}

export interface Artifact {
	platformName: string;
	filename: string;
	path: string;
	url: string;
	platform: Platform;
}

const TOOL_CONFIGS = [
	{ upstreamName: 'owlet', slug: 'owlet', bin: 'owlet' },
	{ upstreamName: 'corvus', slug: 'corvus', bin: 'corvus' },
	{
		upstreamName: 'PhoenixDiagnosticsProgram',
		slug: 'phoenix-diagnostics-server',
		bin: 'PhoenixDiagnosticsProgram',
	},
	{ upstreamName: 'passerine', slug: 'passerine', bin: 'passerine' },
	{ upstreamName: 'caniv', slug: 'caniv', bin: 'caniv' },
] as const satisfies readonly ToolConfig[];

const PLATFORMS: Readonly<Record<string, Platform>> = {
	'linuxx86-64': { os: 'linux', arch: 'x86_64', libc: 'gnu' },
	linuxarm64: { os: 'linux', arch: 'aarch64', libc: 'gnu' },
	linuxarm32: { os: 'linux', arch: 'armv7', libc: 'gnu' },
	linuxathena: { os: 'linux', arch: 'armv7', libc: 'gnu', variant: 'athena' },
	linuxsystemcore: {
		os: 'linux',
		arch: 'aarch64',
		libc: 'gnu',
		variant: 'systemcore',
	},
	'windowsx86-64': { os: 'windows', arch: 'x86_64' },
	macosuniversal: { os: 'darwin' },
};

export function parseIndex(value: unknown): CtreIndex {
	return ctreIndexSchema.parse(value);
}

export async function fetchIndex(url = CTRE_INDEX_URL): Promise<CtreIndex> {
	return fetchCtreIndex(url, { cache: 'no-store' });
}

export function normalizeVersion(version: string): string {
	const semver = valid(version);
	if (semver) return semver;

	const fourPart = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (fourPart) {
		const [, major, minor, patch, revision] = fourPart;
		const normalized = `${major}.${minor}.${patch}+ctre.${revision}`;
		if (valid(normalized)) return normalized;
	}

	throw new Error(`CTRE version is not convertible to SemVer: ${version}`);
}

export function compareVersions(left: string, right: string): number {
	return compare(normalizeVersion(left), normalizeVersion(right));
}

function isPrerelease(version: string): boolean {
	return prerelease(normalizeVersion(version)) !== null;
}

export function planCurrentReleases(index: CtreIndex): PlannedRelease[] {
	const stableChannel = index.ChannelCompliancy.find((channel) => channel.Name === index.LatestChannel);
	if (!stableChannel) {
		throw new Error(`CTRE index does not define its latest channel ${index.LatestChannel}`);
	}

	return TOOL_CONFIGS.map((config) => {
		const tool = index.Tools.find((candidate) => candidate.Name === config.upstreamName);
		if (!tool) throw new Error(`CTRE index is missing ${config.upstreamName}`);

		const releases = tool.Items.filter(
			(release) =>
				(release.Compliancy === stableChannel.Compliancy || release.Compliancy === null) &&
				!isPrerelease(release.Version),
		).sort((left, right) => compareVersions(right.Version, left.Version));
		const release = releases[0];
		if (!release) {
			throw new Error(`CTRE index has no stable ${config.upstreamName} release in channel ${index.LatestChannel}`);
		}

		const version = normalizeVersion(release.Version);
		return {
			tool: config.slug,
			upstreamName: config.upstreamName,
			upstreamVersion: release.Version,
			version,
			tag: `${config.slug}-v${version}`,
			bin: config.bin,
		};
	});
}

function releaseFor(index: CtreIndex, toolSlug: string, upstreamVersion: string) {
	const config = TOOL_CONFIGS.find((candidate) => candidate.slug === toolSlug);
	if (!config) throw new Error(`Unknown tool: ${toolSlug}`);
	const tool = index.Tools.find((candidate) => candidate.Name === config.upstreamName);
	const release = tool?.Items.find((candidate) => candidate.Version === upstreamVersion);
	if (!release) throw new Error(`CTRE index does not contain ${toolSlug} ${upstreamVersion}`);
	return { config, release };
}

function artifactEntries(release: CtreRelease) {
	return Object.entries(release.Urls)
		.filter(([name]) => !name.endsWith('-md5') && !name.endsWith('-sha1'))
		.sort(([left], [right]) => left.localeCompare(right));
}

export function describeArtifacts(index: CtreIndex, toolSlug: string, upstreamVersion: string): Artifact[] {
	const { release } = releaseFor(index, toolSlug, upstreamVersion);
	return artifactEntries(release).map(([platformName, url]) => {
		const platform = PLATFORMS[platformName];
		if (!platform) throw new Error(`Unsupported CTRE platform: ${platformName}`);
		const parsedUrl = new URL(url);
		if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'redist.ctr-electronics.com') {
			throw new Error(`Refusing non-CTRE artifact URL: ${url}`);
		}
		const filename = path.basename(parsedUrl.pathname);
		if (!filename) throw new Error(`CTRE artifact URL has no filename: ${url}`);
		return { platformName, filename, path: filename, url, platform };
	});
}

function tomlString(value: string): string {
	return JSON.stringify(value);
}

export function buildManifest(bin: string, artifacts: readonly Artifact[]): string {
	const lines = [`notes_url = ${tomlString(CTRE_NOTES_URL)}`, `bin = [${tomlString(bin)}]`];
	for (const artifact of artifacts) {
		lines.push('', '[[artifact]]');
		lines.push(`path = ${tomlString(artifact.path)}`);
		lines.push(`url = ${tomlString(artifact.url)}`);
		lines.push('format = "raw"');
		lines.push(`os = ${tomlString(artifact.platform.os)}`);
		if (artifact.platform.arch) lines.push(`arch = ${tomlString(artifact.platform.arch)}`);
		if (artifact.platform.libc) lines.push(`libc = ${tomlString(artifact.platform.libc)}`);
		if (artifact.platform.variant) lines.push(`variant = ${tomlString(artifact.platform.variant)}`);
	}
	return `${lines.join('\n')}\n`;
}

function digest(algorithm: 'md5' | 'sha1', bytes: Uint8Array): string {
	return createHash(algorithm).update(bytes).digest('hex');
}

export async function prepareRelease(
	index: CtreIndex,
	toolSlug: string,
	upstreamVersion: string,
	outputDirectory: string,
): Promise<{ manifest: string; artifacts: Artifact[] }> {
	const { config, release } = releaseFor(index, toolSlug, upstreamVersion);
	await mkdir(outputDirectory, { recursive: true });
	if ((await readdir(outputDirectory)).length !== 0) {
		throw new Error(`Output directory is not empty: ${outputDirectory}`);
	}

	const artifactDirectory = path.join(outputDirectory, 'artifacts');
	await mkdir(artifactDirectory);
	const artifacts = describeArtifacts(index, toolSlug, upstreamVersion);

	const preparedArtifacts = await Promise.all(
		artifacts.map(async (artifact) => {
			const response = await fetch(artifact.url);
			if (!response.ok) {
				throw new Error(`Failed to download ${artifact.url}: ${response.status} ${response.statusText}`);
			}
			const bytes = new Uint8Array(await response.arrayBuffer());
			for (const algorithm of ['md5', 'sha1'] as const) {
				const expected = release.Urls[`${artifact.platformName}-${algorithm}`];
				if (!expected) throw new Error(`CTRE index has no ${algorithm} for ${artifact.filename}`);
				const actual = digest(algorithm, bytes);
				if (actual !== expected.toLowerCase()) {
					throw new Error(`${algorithm} mismatch for ${artifact.filename}: expected ${expected}, got ${actual}`);
				}
			}

			const localPath = path.join(artifactDirectory, artifact.filename);
			await writeFile(localPath, bytes);
			artifact.path = localPath;
			return artifact;
		}),
	);

	const manifest = path.join(outputDirectory, 'release.toml');
	await writeFile(manifest, buildManifest(config.bin, preparedArtifacts));
	return { manifest, artifacts: preparedArtifacts };
}
