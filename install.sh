#!/usr/bin/env sh
set -e

### 1. Detect shell and rc file
if [ -n "$ZSH_VERSION" ]; then
  SHELL_NAME="zsh"
  RC_FILE="$HOME/.zshrc"
elif [ -n "$BASH_VERSION" ]; then
  SHELL_NAME="bash"
  RC_FILE="$HOME/.bashrc"
else
  echo "Unsupported shell. Only bash and zsh are supported."
  exit 1
fi

echo "Detected shell: $SHELL_NAME"
echo "Using rc file: $RC_FILE"

### 2. Detect available runtime
RUNTIME=""
ODOO_CMD=""

if command -v bun >/dev/null 2>&1; then
  RUNTIME="bun"
  ODOO_CMD="bun $HOME/odoo-cli"
elif command -v deno >/dev/null 2>&1; then
  RUNTIME="deno"
  ODOO_CMD="deno run -A $HOME/odoo-cli/main.ts"
elif command -v ts-node >/dev/null 2>&1; then
  RUNTIME="ts-node"
  ODOO_CMD="ts-node $HOME/odoo-cli/main.ts"
else
  echo "No TypeScript runtime found (bun, deno, ts-node). Installing bun..."

  curl -fsSL https://bun.sh/install | bash

  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"

  if ! command -v bun >/dev/null 2>&1; then
    echo "Failed to install bun."
    exit 1
  fi

  RUNTIME="bun"
  ODOO_CMD="bun $HOME/odoo-cli"
fi

echo "Using runtime: $RUNTIME"

### 3. Clone repository
cd "$HOME"

if [ -d "$HOME/odoo-cli" ]; then
  echo "Directory ~/odoo-cli already exists. Skipping clone."
else
  echo "Cloning odoo-cli..."
  git clone https://github.com/jum-odoo/odoo-cli.git
fi

### 4. Add alias safely
MARKER_START="# >>> odoo-cli >>>"
MARKER_END="# <<< odoo-cli <<<"

if grep -q "$MARKER_START" "$RC_FILE" 2>/dev/null; then
  echo "odoo-cli alias already configured in $RC_FILE"
else
  echo "Adding alias to $RC_FILE"
  {
    echo ""
    echo "$MARKER_START"
    echo "alias odoo=\"$ODOO_CMD\""
    echo "$MARKER_END"
  } >> "$RC_FILE"
fi

### 5. Done
echo ""
echo "✅ Odoo-CLI installed successfully. Use 'odoo --help'"
