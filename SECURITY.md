# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue or pull
request. Use GitHub's private reporting: open the repository's **Security** tab
and choose **Report a vulnerability**.

Include what you found, how to reproduce it, and what it lets someone do. You
will get a first answer within a few days. When the problem is real, we agree
on a fix and a disclosure date with you, and credit you if you want that.

## What is covered

The code in this repository: the web app and server, the HTTP API under
`/api/v1`, the OAuth and MCP endpoints, the `sx` command line and the
TypeScript SDK.

## Supported versions

Only the latest commit on `main` gets fixes. There are no long-lived release
branches yet.

## What the sample data is

The API and CLI run on sample data today. Sample tokens such as
`sxp_dana_full_access_0001` are public on purpose and grant nothing real.
Reporting them is not necessary. A way to use a sample token against a real
deployment is a vulnerability: please report that.
