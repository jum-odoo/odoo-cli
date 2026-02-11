# Odoo-CLI

## Requirements:

- **Odoo** and all of its requirements (Python 3, PostgreSQL, etc.)
- Bun (recommended, can be used with other TS runtimes)

## Setup:

Use the following script to install everything in one go:
```bash
curl -fsSL https://github.com/jum-odoo/odoo-cli/blob/master/install.sh | bash
```

## Examples:

Run the server on the current branch's database with default ports and addon-paths:
```bash
odoo
```

Get the list of available commands:
```bash
odoo --help
```

Drop the current database, create a new one with **default** addons (i.e. `crm`, `project` and `website`), and start it right after:
```bash
odoo create default --start
```

Run client unit tests from the server
```bash
odoo test .test_unit_desktop
```

Edit memory log sources and generate memory graph from a list of runbot links
```bash
odoo memory --edit # paste links on each line in the file
odoo memory --open
```
