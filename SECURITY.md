# Security Policy

## Reporting a Vulnerability

Please do not open a public GitHub issue for security vulnerabilities.

Instead, report it privately via [GitHub Security Advisories](https://github.com/N1TAXE/mockingpug/security/advisories/new)
for this repository, or email n1t4x3@gmail.com.

Include what you can:
- A description of the vulnerability and its potential impact.
- Steps to reproduce, or a minimal example.
- The affected version(s).

You should get an initial response within a few days. Once a fix is
available, we'll coordinate on disclosure timing before it's made public.

## Scope

mockingpug generates mock data and serves it over a mock REST API for
development and testing. It is explicitly **not** intended to run in
production. See [`site/content/docs/security.mdx`](site/content/docs/security.mdx)
for the library's own guidance on keeping mock code out of production builds
(`doctor --assert-prod-safe`, bundler exclusion, etc.) — reports about mock
code accidentally shipping to production are welcome as bugs even though
that's a usage safeguard, not a vulnerability in the traditional sense.

## Supported Versions

This project is pre-1.0. Security fixes are made against the latest
published version only.
