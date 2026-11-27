# Pena Agent Guide

This guide shows how to install and run the agent on a build server.

## Install the agent

The agent is a small program that reads your docs
and reports problems before a release. It runs on
Linux, macOS and Windows without extra setup.

You can use **bold text** for warnings and *italic text* for terms.
Run `pena check` to start a scan. See the
[setup page](https://example.com/setup) for details.

![Architecture diagram](https://example.com/diagram.png)

### Requirements

- Node 22 or newer
  - Linux or macOS
  - Windows 10 or newer
- A docs folder with Markdown files
-	Step with a tab after the dash

### Steps

1. Download the package.
2. Unpack it.
3. Run the first scan.

> Always scan on a clean checkout.
> Results can differ on a dirty tree.

```bash
pena check docs/
pena report --format text
```

Example output:

    Checked 12 files
    Found 0 problems

That is all you need to start.
