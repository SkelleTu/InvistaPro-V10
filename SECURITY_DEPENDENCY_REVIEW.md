# Dependency Security Review

Review date: 2026-10-11  
Scope: isolated audit branch only; no production deployment.

## Remediations verified
- Upgraded Vite to the patched 6.4.x line; the successful build resolved Vite 6.4.4.
- Upgraded drizzle-kit to 0.31.11.
- Pinned postcss-selector-parser to 7.1.6, which resolves the reported selector-parser advisory.
- Replaced the unused, deprecated @esbuild-kit/esm-loader dependency with the already-used tsx package via an npm override.
- Regenerated package-lock.json on the audit branch only.
- TypeScript validation, production policy tests, and production build passed in the dependency-remediation workflow.
- `npm audit --omit=dev --audit-level=high` reported **0 production dependency vulnerabilities**.

## Remaining development-only risk
The full npm audit still reports **7 high-severity findings and 0 moderate findings**, all in the Tailwind CSS 3 development/build-tool chain: tailwindcss, @tailwindcss/typography, tailwindcss-animate, chokidar, fast-glob, micromatch, and braces.

The root braces advisory is GHSA-vfj7-8cjw-p6xm and currently lists no patched upstream release: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm. These packages are development dependencies and are excluded from the production dependency audit, but the development toolchain is not fully clean.

A Tailwind 4 migration could remove this legacy dependency chain, but it changes CSS processing, plugin compatibility, and configuration. It must be handled as a separate visual migration with regression checks, not forced into the trading/security patch without validating that the UI remains intact.

## Status
Production dependency audit: PASS  
TypeScript / policy tests / dependency-remediation build: PASS  
Full development dependency audit: NOT CLEAN (7 high, upstream remediation needed)  
UI chunk-splitting change: awaiting the latest CI run  
Production merge/deploy: not performed
