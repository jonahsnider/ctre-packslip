#!/usr/bin/env node

import { resolve } from 'node:path';
import { fetchIndex, planCurrentReleases, prepareRelease } from './ctre.ts';

function option(name: string, args: readonly string[]): string {
	const index = args.indexOf(name);
	const value = index === -1 ? undefined : args[index + 1];
	if (!value || value.startsWith('--')) throw new Error(`Missing required option ${name}`);
	return value;
}

try {
	const [command, ...args] = process.argv.slice(2);
	const index = await fetchIndex();

	if (command === 'plan') {
		process.stdout.write(`${JSON.stringify({ include: planCurrentReleases(index) })}\n`);
	} else if (command === 'prepare') {
		const tool = option('--tool', args);
		const upstreamVersion = option('--upstream-version', args);
		const outputDirectory = resolve(option('--out', args));
		const result = await prepareRelease(index, tool, upstreamVersion, outputDirectory);
		process.stdout.write(
			`${JSON.stringify({ manifest: result.manifest, artifacts: result.artifacts.map((artifact) => artifact.path) })}\n`,
		);
	} else {
		throw new Error('Usage: ctre-packslip <plan|prepare>');
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
