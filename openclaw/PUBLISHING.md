# Publishing `@postfleet/postfleet` to ClawHub

This is an OpenClaw **code plugin** (family `code-plugin`) with no real runtime: the
MCP server and the skill are declared statically in `openclaw.plugin.json`.

It is **not** an npm package. Do not `npm publish` from this folder; the npm artifact is
`packages/mcp` (`@postfleet/mcp`), published separately.

## Why it is shaped this way

Two constraints pull in opposite directions, and only this shape satisfies both:

- `clawhub package publish` rejects any package without `openclaw.plugin.json`,
  whatever `--family` or `--bundle-format` you pass. An Agent Plugins bundle (root
  `plugin.json` + `mcp.json`) fails with `openclaw.plugin.json required`.
- OpenClaw treats a package carrying `openclaw.plugin.json` as a **native** plugin, and
  refuses to install one whose `package.json` has no `openclaw.extensions`
  (`package.json missing openclaw.extensions`).

So the package carries the native manifest plus a no-op `index.js` entry. Verified
against `openclaw@2026.8.2` and `clawhub@0.23.3`: `plugins inspect postfleet --runtime`
reports `Status: loaded`, `Format: openclaw`, and the `postfleet` MCP server, and
`skills list` shows the skill as ready.

## One-time setup

```bash
npm i -g clawhub
clawhub login
clawhub publisher create postfleet --display-name "Postfleet"
```

The package scope must match the publish owner: `@postfleet/postfleet` can only be
published as `postfleet`. If ClawHub says the handle is taken, file an
[Org / Namespace Claim](https://github.com/openclaw/clawhub/issues/new?template=org-namespace-claim.yml)
rather than renaming the scope.

## Source attribution

Code plugins **require** `--source-repo` and `--source-commit`, and the commit has to be
pushed and reachable — a private repo needs `GITHUB_TOKEN` and leaves a source link
nobody outside the org can open. Publish from a commit in the public
[postfleet-mcp](https://github.com/Thestral12/postfleet-mcp) repo, not from the private
monorepo.

This monorepo folder is the source of truth. The public repo carries a copy at
`openclaw/`, mirrored by hand at release time — the same arrangement `packages/mcp`
has with that repo. Copy the files across before publishing.

## Each release

1. Bump `version` in `package.json`.
2. Copy this folder to `openclaw/` in the public repo, push, and note the SHA.
3. Pack, validate, dry-run, publish — from the public checkout.

`clawhub package publish <folder>` fails on Windows with `spawnSync npm ENOENT` when it
tries to pack for you, so pack by hand and publish the tarball. Also pass **absolute
paths**: the CLI resolves relative ones against its own skills workdir and reports
`Path must be a package folder`.

```bash
cd openclaw   # in the postfleet-mcp checkout
npm pack --pack-destination /tmp

clawhub package validate "$PWD"
clawhub package publish /tmp/postfleet-postfleet-1.0.0.tgz \
  --family code-plugin --owner postfleet \
  --source-repo Thestral12/postfleet-mcp --source-commit <sha> \
  --source-path openclaw --dry-run

clawhub package publish /tmp/postfleet-postfleet-1.0.0.tgz \
  --family code-plugin --owner postfleet \
  --source-repo Thestral12/postfleet-mcp --source-commit <sha> \
  --source-path openclaw \
  --categories tools --topics "email,mailbox,inbox" --wait
```

`--wait` blocks until ClawHub's automated security checks finish. New releases stay out
of public install surfaces until they pass, so a successful upload is not yet a live
listing.

`validate` writes a `reports/` folder into this directory. It is gitignored; delete it
if it gets in the way.

## Catalog metadata

Categories come from the **plugin** list, not the skill list: `channels`, `models`,
`memory`, `context`, `voice`, `media`, `web`, `tools`, `runtime`, `gateway`,
`security`, `other`. Max 3 categories and 5 topics. Omitting either flag on a
re-publish keeps the stored value; passing `""` clears it.

## Compatibility

`openclaw.compat.pluginApi` and `openclaw.build.openclawVersion` are pinned to
`2026.8.2`. Bump them when you retest against a newer OpenClaw; ClawHub validates them
explicitly and does not fall back to `package.json.version`.

## Trusted publishing (optional, later)

After the first token-authenticated publish, a package manager can enable secretless
GitHub Actions publishes:

```bash
clawhub package trusted-publisher set @postfleet/postfleet \
  --repository Thestral12/postfleet-mcp \
  --workflow-filename package-publish.yml
```

Tag-push releases still need `CLAWHUB_TOKEN`; only `workflow_dispatch` runs can use
OIDC.
