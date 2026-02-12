# Odoo-CLI


## Requirements:

- [Odoo](https://github.com/odoo/odoo) and all of its requirements:
  - [Python](https://www.python.org/);
  - [PostgreSQL](https://www.postgresql.org/docs/current/app-psql.html);
  - etc. (full list on [official documentation](https://www.odoo.com/documentation/master/administration/on_premise.html))
- A **TypeScript** runtime: [bun](https://bun.com/), [deno](https://deno.com/) or [ts-node](https://www.npmjs.com/package/ts-node).

## Setup:

Use the following script to install everything in one go:

```sh
sh -c "$(curl -fsSL https://raw.githubusercontent.com/jum-odoo/odoo-cli/refs/heads/master/install.sh)"
```

## Examples:

Run the server on a database having the same name as the current branch (e.g. master) with default port and addon-paths:
```sh
odoo
```

Overwrite current databasee with a new one, loading **default** addons (i.e. `crm`, `project` and `website`) and all addons starting with **website__**, and start it right after:
```sh
odoo create -i default,website_* --start
```

Run client unit tests from the CLI
```sh
odoo test .test_unit_desktop
```

Edit memory log sources and generate memory graph from a list of runbot links
```sh
odoo memory --edit # Paste links on each line in the file
odoo memory # Open generated logs
```
