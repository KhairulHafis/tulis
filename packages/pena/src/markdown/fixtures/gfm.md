# Command Reference

The table below lists the common commands.

| Command | Purpose | Docs |
| ------- | ------- | ---- |
| `check` | Scan the docs | [Check guide](https://example.com/check) |
| `report` | Print the `summary` | [Report guide](https://example.com/report) |
| `init` | Create a config | [Init guide](https://example.com/init) |

## Release checklist

- [x] Run the scan
- [ ] Review the report

## Notes

The scan is fast[^speed] on small folders.

Old flags are ~~removed~~ no longer supported.

Visit https://example.com/pena for more information.

[^speed]: A folder with 100 files takes about one second.
[^unused]: This note is kept for later.

## More details

Each command prints a short summary at the end.
The summary shows the number of files and the number
of problems found. Exit codes follow the usual rules.

Use the `--quiet` flag to hide the summary.
