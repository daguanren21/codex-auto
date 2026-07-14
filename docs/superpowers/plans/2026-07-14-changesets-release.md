# Encore Changesets Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Publish the Encore CLI as the public scoped npm package `@daguanren21/encore` with the executable name `encore`, using Changesets and GitHub Actions.

**Architecture:** Keep `@codex-auto/core` and `@codex-auto/mcp-server` private workspace packages. Bundle their runtime code into the CLI build, publish only the CLI package, and let Changesets create a release PR before npm publication.

**Tech Stack:** pnpm 10, TypeScript/tsdown, Changesets, GitHub Actions, npm.

## Global Constraints

- The npm package is `@daguanren21/encore`; its bins are `encore` and `codex-auto`.
- Public scoped publishing uses `publishConfig.access = public`.
- Release publication requires the GitHub `NPM_TOKEN` secret.
- The release workflow runs on `main` and uses `changesets/action@v2`.
- `.codegraph/daemon.pid` is local runtime output and must not be committed.

## Tasks

1. Rename the publishable CLI package and add npm metadata, files, scripts, and the Changesets CLI dev dependency.
2. Add `.changeset/config.json` and a patch changeset for the initial Encore release.
3. Add CI and release workflows with least-privilege GitHub permissions.
4. Update English and Chinese documentation with scoped install, `npx --package`, release setup, and release flow.
5. Install dependencies, run lint/typecheck/test/build, inspect the npm tarball, and verify the resulting diff.
