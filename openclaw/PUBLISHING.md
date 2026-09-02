# Publishing `@postfleet/postfleet` to ClawHub

This is an OpenClaw **code plugin** (family `code-plugin`) with no real runtime: the
MCP server and the skill are declared statically in `openclaw.plugin.json`.

It is **not** an npm package. Do not `npm publish` from this folder. The npm artifact is
`@postfleet/mcp`, published separately — it lives at `packages/mcp` in the private
monorepo and at the repository root in the public `postfleet-mcp` mirror.

## Why it is shaped this way

Two constraints pull in opposite directions, and only this shape satisfies both:

- `clawhub package publish` rejects any package without `openclaw.plugin.json`,
  whatever `--family` or `--bundle-format` you pass. An Agent Plugins bundle (root
  `plugin.json` + `mcp.json`) fails with `openclaw.plugin.json required`.
- OpenClaw treats a package carrying `openclaw.plugin.json` as a **native** plugin, and
  refuses to install one whose `package.json` has no `openclaw.extensions`
  (`package.json missing openclaw.extensions`).

So the package carries the native manifest plus a no-op `index.js` entry. Verified
against `openclaw@2026.8.2` and `clawhub@0.23.3`: `openclaw plugins inspect postfleet
--runtime` reports `Status: loaded`, `Format: openclaw`, and the `postfleet` MCP server, and
`openclaw skills list` shows the skill as ready.

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

The private monorepo (`packages/openclaw-plugin`) is the source of truth. The public
repo carries the publishable mirror at `openclaw/`, copied across by hand at release
time — the same arrangement `@postfleet/mcp` already has. Sync the files before
publishing.

## Each release

1. Bump `version` in `package.json`.
2. Copy this folder to `openclaw/` in the public repo, push, and note the SHA.
3. Pack, validate, dry-run, publish — from the public checkout.

`clawhub package publish <folder>` fails on Windows with `spawnSync npm ENOENT` when it
tries to pack for you, so pack by hand and publish the tarball. Also pass **absolute
paths**: the CLI resolves relative ones against its own skills workdir and reports
`Path must be a package folder`.

`npm pack` names the tarball from the current version, so derive the path rather than
typing it — otherwise these commands go stale the moment you bump.

```bash
cd openclaw   # in the postfleet-mcp checkout
TGZ=/tmp/$(npm pack --silent --pack-destination /tmp)
SHA=$(git rev-parse HEAD)

clawhub package validate "$PWD"
clawhub package publish "$TGZ" \
  --family code-plugin --owner postfleet \
  --source-repo Thestral12/postfleet-mcp --source-commit "$SHA" \
  --source-path openclaw --dry-run

clawhub package publish "$TGZ" \
  --family code-plugin --owner postfleet \
  --source-repo Thestral12/postfleet-mcp --source-commit "$SHA" \
  --source-path openclaw \
  --categories tools --topics "email,mailbox,inbox" --wait
```

`$SHA` has to be a commit that is **pushed** to the public repo, so run this from a
clean checkout of the merged branch, not a local-only commit.

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

`openclaw.compat.pluginApi` is a **range** (`>=2026.8.2`) — the plugin API floor it
needs, deliberately open at the top so a newer OpenClaw can still install it. Pinning it
to an exact version would claim compatibility with that release alone.
`openclaw.build.openclawVersion` is the exact version it was built and tested against,
`2026.8.2`.

Raise the floor only when you rely on something newer; refresh `openclawVersion` every
time you retest. ClawHub validates both explicitly and does not fall back to
`package.json.version`.

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
