# ctre-packslip

Unofficial [Packslip](https://packslip.dev/) manifests for the closed-source
[CTR Electronics command-line tools](https://docs.ctr-electronics.com/cli-tools).

This repository does not redistribute CTRE binaries. Its scheduled workflow
downloads each selected artifact from CTRE, checks the MD5 and SHA-1 values in
CTRE's HTTPS-served [release index](https://redist.ctr-electronics.com/index.json),
computes stronger Packslip digests, and signs the resulting manifest with this
repository's GitHub Actions identity.

## Trust model

Every manifest declares `attested_by = "repackager"`. It proves that this
repository observed the listed bytes at CTRE's official URLs and matched CTRE's
published checksums. It is not a Packslip signed by CTRE, and the MD5/SHA-1
values in CTRE's index are checksums rather than detached cryptographic
signatures.

Published GitHub releases contain only the signed Packslip bundle. Versioned
binary URLs continue to point directly to `redist.ctr-electronics.com`.

## Tools

| Packslip project suffix      | Installed command           |
| ---------------------------- | --------------------------- |
| `owlet`                      | `owlet`                     |
| `corvus`                     | `corvus`                    |
| `phoenix-diagnostics-server` | `PhoenixDiagnosticsProgram` |
| `passerine`                  | `passerine`                 |
| `caniv`                      | `caniv`                     |

Install a tool by using this repository's eventual GitHub owner:

```sh
mise use packslip:github.com/<owner>/ctre-packslip/owlet
```

The automation publishes only the newest non-prerelease version associated
with CTRE's current channel. It deliberately excludes alpha and beta releases.
Four-component CTRE versions are normalized to SemVer build metadata; for
example, `1.1.1.0` becomes `1.1.1+ctre.0`.

## Development

Node.js and pnpm versions come from `package.json` through mise:

```sh
mise install
pnpm install
pnpm test
pnpm build
pnpm lint
pnpm format
pnpm knip
```

Inspect the releases the next synchronization would consider:

```sh
pnpm plan
```

Prepare and verify the upstream files for one release without signing it:

```sh
pnpm prepare-release -- --tool owlet --upstream-version 26.3.0 --out ./dist/owlet
```

Publishing runs only in GitHub Actions because Packslip uses the workflow's
OIDC identity. The workflow refuses to overwrite an existing Packslip release
asset.

## Disclaimer

This project is not affiliated with or endorsed by CTR Electronics. CTRE product
names and trademarks belong to their respective owners.
