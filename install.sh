#!/usr/bin/env sh
set -e

# COLORS
RESET="\033[0;0m"
RED="\033[0;91m"
GREEN="\033[0;92m"
YELLOW="\033[0;93m"
BLUE="\033[0;94m"
MAGENTA="\033[0;95m"
CYAN="\033[0;96m"

ERROR="${RED}[x]${RESET}"
INFO="${BLUE}[i]${RESET}"
SUCCESS="${GREEN}[o]${RESET}"
WARN="${YELLOW}[!]${RESET}"

### 1. Detect shell and rc file
if [ -n "$ZSH_VERSION" ]; then
  SHELL_NAME="zsh"
  RC_FILE="$HOME/.zshrc"
elif [ -n "$BASH_VERSION" ]; then
  SHELL_NAME="bash"
  RC_FILE="$HOME/.bashrc"
else
  printf "$ERROR Unsupported shell. Only$YELLOW bash$RESET and$YELLOW zsh$RESET are supported.\n\n"
  exit 1
fi

printf "$INFO Detected shell: $YELLOW$SHELL_NAME$RESET\n"

### 2. Detect runtime
RUNTIME=""
ODOO_CMD=""
APP_NAME="Odoo-CLI"
REPO_NAME=odoo-cli
REPO_PATH="$HOME/$REPO_NAME"

if command -v bun >/dev/null 2>&1; then
  RUNTIME="bun"
  ODOO_CMD="bun $REPO_PATH"
elif command -v deno >/dev/null 2>&1; then
  RUNTIME="deno"
  ODOO_CMD="deno run -A $REPO_PATH/index.ts"
elif command -v ts-node >/dev/null 2>&1; then
  RUNTIME="ts-node"
  ODOO_CMD="ts-node $REPO_PATH/index.ts"
else
  printf "$WARN No Typescript runtime found. Installing$YELLOW bun$RESET...\n"

  curl -fsSL https://bun.sh/install | bash

  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"

  if ! command -v bun >/dev/null 2>&1; then
    printf "$ERROR$YELLOW bun$RESET installation failed.\n\n"
    exit 1
  fi

  RUNTIME="bun"
  ODOO_CMD="bun $REPO_PATH"
fi

printf "$INFO Detected runtime: $YELLOW$RUNTIME$RESET\n"

### 3. Clone or update repository
cd "$HOME"

if [ -d "$REPO_PATH/.git" ]; then
  printf "$INFO Git repository detected. Checking for updates...\n"

  cd "$REPO_PATH"

  if git diff --quiet && git diff --cached --quiet; then
    git pull --ff-only >/dev/null 2>&1
    printf "$SUCCESS $APP_NAME updated.\n"
  else
    printf "$WARN Local changes detected in $CYAN$REPO_PATH$RESET. Skipping auto-update.\n"
  fi
else
  printf "$INFO Installing $APP_NAME...\n"
  git clone https://github.com/jum-odoo/$REPO_NAME.git
fi

### 4. Persist alias to rc file (idempotent)
MARKER_START="# >>> $APP_NAME >>>"
MARKER_END="# <<< $APP_NAME <<<"

if ! grep -q "$MARKER_START" "$RC_FILE" 2>/dev/null; then
  printf "$INFO Adding alias to $CYAN$RC_FILE$RESET\n"
  {
    echo ""
    echo "$MARKER_START"
    echo "alias odoo=\"$ODOO_CMD\""
    echo "$MARKER_END"
  } >> "$RC_FILE"
else
  printf "$INFO Alias already present in $CYAN$RC_FILE$RESET\n"
fi

### 5. Make alias available immediately
alias odoo="$ODOO_CMD"

### 6. Done
echo ""
printf "$SUCCESS ✅ $APP_NAME is ready!\n"
printf "$INFO 📋 Run$MAGENTA odoo --help$RESET for the list of available commands\n\n"
