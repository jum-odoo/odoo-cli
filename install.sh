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

### 0. Required commands
for cmd in git curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    printf "$ERROR Required command '$YELLOW$cmd$RESET' is not installed.\n"
    exit 1
  fi
done

### 1. Detect shell (only for messaging / consistency)
if [ -n "$ZSH_VERSION" ]; then
  SHELL_NAME="zsh"
elif [ -n "$BASH_VERSION" ]; then
  SHELL_NAME="bash"
else
  SHELL_NAME="sh"
fi

printf "$INFO Detected shell: $YELLOW$SHELL_NAME$RESET\n"

### 2. Paths (XDG-compliant)
XDG_SHARE="${XDG_DATA_HOME:-$HOME/.local/share}"
XDG_BIN="$HOME/.local/bin"

LAUNCHER_PATH="$XDG_BIN/odoo"

### 3. Detect runtime
RUNTIME=""
ODOO_CMD=""

APP_NAME="Odoo-CLI"
REPO_NAME="odoo-cli"
REPO_PATH="$XDG_SHARE/$REPO_NAME"

if command -v bun >/dev/null 2>&1; then
  RUNTIME="bun"
  ODOO_CMD="bun \"$REPO_PATH\""
elif command -v deno >/dev/null 2>&1; then
  RUNTIME="deno"
  ODOO_CMD="deno run -A \"$REPO_PATH/index.ts\""
elif command -v ts-node >/dev/null 2>&1; then
  RUNTIME="ts-node"
  ODOO_CMD="ts-node \"$REPO_PATH/index.ts\""
else
  printf "$WARN No TypeScript runtime found. Installing$YELLOW bun$RESET...\n"

  if ! command -v bash >/dev/null 2>&1; then
    printf "$ERROR bun installer requires$YELLOW bash$RESET, which is not installed.\n"
    exit 1
  fi

  # bun does not support musl / Alpine
  if [ -f /etc/alpine-release ]; then
    printf "$ERROR bun is not supported on Alpine Linux (musl).\n"
    printf "$INFO Please install deno or ts-node manually.\n"
    exit 1
  fi

  curl -fsSL https://bun.sh/install | bash

  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"

  if ! command -v bun >/dev/null 2>&1; then
    printf "$ERROR$YELLOW bun$RESET installation failed.\n"
    exit 1
  fi

  RUNTIME="bun"
  ODOO_CMD="bun \"$REPO_PATH\""
fi

printf "$INFO Detected runtime: $YELLOW$RUNTIME$RESET\n"

### 4. Clone or update repository
mkdir -p "$XDG_SHARE"

if [ -d "$REPO_PATH/.git" ]; then
  printf "$INFO Git repository detected. Checking for updates...\n"
  cd "$REPO_PATH"

  if git diff --quiet && git diff --cached --quiet; then
    if git pull --ff-only >/dev/null 2>&1; then
      printf "$SUCCESS $APP_NAME updated.\n"
    else
      printf "$WARN Failed to update $APP_NAME.\n"
    fi
  else
    printf "$WARN Local changes detected in $CYAN$REPO_PATH$RESET. Skipping auto-update.\n"
  fi
else
  printf "$INFO Installing $APP_NAME...\n"
  git clone "https://github.com/jum-odoo/$REPO_NAME.git" "$REPO_PATH"
fi

### 5. Install launcher script (~/.local/bin/odoo)
printf "$INFO Installing launcher to $CYAN$LAUNCHER_PATH$RESET\n"

mkdir -p "$XDG_BIN"

cat > "$LAUNCHER_PATH" <<EOF
#!/usr/bin/env sh
set -e
exec $ODOO_CMD "\$@"
EOF

chmod +x "$LAUNCHER_PATH"

### 6. PATH hint (non-invasive)
if ! printf "%s" "$PATH" | grep -q "$XDG_BIN"; then
  printf "$WARN $CYAN$XDG_BIN$RESET is not in your PATH.\n"
  printf "$INFO Add it to your shell config to use$MAGENTA odoo$RESET globally.\n"
fi

### 7. Done
echo ""
printf "$SUCCESS ✅ $APP_NAME is ready!\n"
printf "$INFO 📋 Run$MAGENTA odoo --help$RESET for the list of available commands\n\n"
