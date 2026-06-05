#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECRETS_FILE="${BATIFLOW_SECRETS_FILE:-$HOME/Downloads/batiflow-computer-b-secrets.txt}"
CHECK_ONLY=false
FORCE_SECRETS=false

for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=true ;;
    --force-secrets) FORCE_SECRETS=true ;;
    *)
      printf 'Unknown option: %s\nUsage: %s [--check] [--force-secrets]\n' "$arg" "$0" >&2
      exit 2
      ;;
  esac
done

step() { printf '\n==> %s\n' "$1"; }
die() { printf '\nERROR: %s\n' "$1" >&2; exit 1; }
trap 'die "Setup failed on line $LINENO. Fix the reported error and rerun this script."' ERR

[[ "$(uname -s)" == "Darwin" ]] || die "Computer B setup currently supports macOS only."

find_vault() {
  local drive_dir vault
  while IFS= read -r drive_dir; do
    for vault in "$drive_dir/My Drive/batiflow-vault" "$drive_dir/내 드라이브/batiflow-vault"; do
      if [[ -d "$vault" ]]; then
        printf '%s\n' "$vault"
        return 0
      fi
    done
  done < <(find "$HOME/Library/CloudStorage" -maxdepth 1 -type d -name 'GoogleDrive-*' 2>/dev/null | sort)
  return 1
}

step "Checking Google Drive Desktop and shared Obsidian vault"
VAULT_PATH="$(find_vault || true)"
[[ -n "$VAULT_PATH" ]] || die "Google Drive Desktop must be installed, signed in, and fully synced with batiflow-vault."
printf 'Vault: %s\n' "$VAULT_PATH"

if $CHECK_ONLY; then
  step "Checking required tools"
  for command_name in git node npm; do
    command -v "$command_name" >/dev/null 2>&1 || die "$command_name is missing."
    printf '%-5s %s\n' "$command_name" "$(command -v "$command_name")"
  done
  [[ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]] || die "Google Chrome is missing."
  printf '\nCHECK PASSED: Computer B prerequisites and Google Drive vault are ready.\n'
  exit 0
fi

ensure_homebrew() {
  if ! command -v brew >/dev/null 2>&1; then
    step "Installing Homebrew"
    NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    if [[ -x /opt/homebrew/bin/brew ]]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ -x /usr/local/bin/brew ]]; then
      eval "$(/usr/local/bin/brew shellenv)"
    fi
  fi
  command -v brew >/dev/null 2>&1 || die "Homebrew installation did not add brew to PATH."
}

step "Installing required tools"
ensure_homebrew
command -v git >/dev/null 2>&1 || brew install git
command -v node >/dev/null 2>&1 || brew install node
command -v python3 >/dev/null 2>&1 || brew install python
[[ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]] || brew install --cask google-chrome

read_env_value() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  sed -n "s/^${key}=//p" "$file" | tail -n 1
}

upsert_env_value() {
  local file="$1" key="$2" value="$3" temp_file
  temp_file="$(mktemp "${file}.XXXXXX")"
  if [[ -f "$file" ]]; then
    grep -v "^${key}=" "$file" > "$temp_file" || true
  fi
  printf '%s=%s\n' "$key" "$value" >> "$temp_file"
  mv "$temp_file" "$file"
}

first_env_value() {
  local key="$1" file value
  shift
  for file in "$@"; do
    value="$(read_env_value "$file" "$key")"
    if [[ -n "$value" ]]; then
      printf '%s' "$value"
      return 0
    fi
  done
}

prompt_secret() {
  local label="$1" current="$2" value
  if [[ -n "$current" ]] && ! $FORCE_SECRETS; then
    printf '%s is already configured; preserving the local value.\n' "$label" >&2
    printf '%s' "$current"
    return 0
  fi
  while [[ -z "${value:-}" ]]; do
    read -r -s -p "Enter $label: " value
    printf '\n' >&2
  done
  printf '%s' "$value"
}

step "Creating local-only BatiFlow secrets"
ENV_PATH="$PROJECT_DIR/.env"
if [[ -f "$SECRETS_FILE" ]]; then
  chmod 600 "$SECRETS_FILE"
  printf 'Reading Computer B input values from: %s\n' "$SECRETS_FILE"
else
  printf 'Secret handoff file not found at %s; missing values will be requested interactively.\n' "$SECRETS_FILE"
fi
DEEPSEEK_API_KEY="$(prompt_secret "DEEPSEEK_API_KEY" "$(first_env_value DEEPSEEK_API_KEY "$ENV_PATH" "$SECRETS_FILE")")"
TELEGRAM_BOT_TOKEN="$(prompt_secret "TELEGRAM_BOT_TOKEN" "$(first_env_value TELEGRAM_BOT_TOKEN "$ENV_PATH" "$SECRETS_FILE")")"
DEEPSEEK_API_BASE="$(read_env_value "$ENV_PATH" DEEPSEEK_API_BASE)"
DEEPSEEK_MODEL="$(read_env_value "$ENV_PATH" DEEPSEEK_MODEL)"
DEEPSEEK_API_BASE="${DEEPSEEK_API_BASE:-https://api.deepseek.com}"
DEEPSEEK_MODEL="${DEEPSEEK_MODEL:-deepseek-reasoner}"

umask 077
printf '%s\n' \
  "DEEPSEEK_API_KEY=$DEEPSEEK_API_KEY" \
  "DEEPSEEK_API_BASE=$DEEPSEEK_API_BASE" \
  "DEEPSEEK_MODEL=$DEEPSEEK_MODEL" \
  "TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN" \
  "OBSIDIAN_VAULT_PATH=$VAULT_PATH" > "$ENV_PATH"
chmod 600 "$ENV_PATH"

step "Installing BatiFlow dependencies"
cd "$PROJECT_DIR"
npm ci
npx playwright install chromium
python3 -m venv "$PROJECT_DIR/.venv"
"$PROJECT_DIR/.venv/bin/python3" -m pip install --upgrade pip youtube-transcript-api
npm run build

step "Configuring BatiFlow daily sync LaunchAgent"
mkdir -p "$PROJECT_DIR/scrap"
npm run worker:register

step "Installing or updating Hermes Agent"
HERMES_DIR="$HOME/.hermes"
HERMES_REPO="$HERMES_DIR/hermes-agent"
mkdir -p "$HERMES_DIR"
if [[ -d "$HERMES_REPO/.git" ]]; then
  git -C "$HERMES_REPO" pull --ff-only
else
  git clone https://github.com/NousResearch/hermes-agent.git "$HERMES_REPO"
fi
bash "$HERMES_REPO/setup-hermes.sh"

step "Installing BatiFlow Hermes skill"
mkdir -p "$HERMES_DIR/skills/batiflow-followup"
cp "$PROJECT_DIR/skills/batiflow-followup/SKILL.md" "$HERMES_DIR/skills/batiflow-followup/SKILL.md"

step "Restoring non-secret Hermes assets from Google Drive"
for asset in config.yaml SOUL.md; do
  if [[ -f "$VAULT_PATH/setup/$asset" ]]; then
    cp "$VAULT_PATH/setup/$asset" "$HERMES_DIR/$asset"
  fi
done
for asset_dir in skills scripts; do
  if [[ -d "$VAULT_PATH/setup/$asset_dir" ]]; then
    mkdir -p "$HERMES_DIR/$asset_dir"
    cp -R "$VAULT_PATH/setup/$asset_dir/." "$HERMES_DIR/$asset_dir/"
  fi
done

HERMES_ENV="$HERMES_DIR/.env"
TELEGRAM_HOME_CHANNEL="$(read_env_value "$HERMES_ENV" TELEGRAM_HOME_CHANNEL)"
TELEGRAM_HOME_CHANNEL="${TELEGRAM_HOME_CHANNEL:-$(read_env_value "$SECRETS_FILE" TELEGRAM_HOME_CHANNEL)}"
if [[ -z "$TELEGRAM_HOME_CHANNEL" ]]; then
  read -r -p "Enter TELEGRAM_HOME_CHANNEL chat ID for Hermes (leave blank to skip): " TELEGRAM_HOME_CHANNEL
fi
upsert_env_value "$HERMES_ENV" DEEPSEEK_API_KEY "$DEEPSEEK_API_KEY"
upsert_env_value "$HERMES_ENV" TELEGRAM_BOT_TOKEN "$TELEGRAM_BOT_TOKEN"
upsert_env_value "$HERMES_ENV" OBSIDIAN_VAULT_PATH "$VAULT_PATH"
upsert_env_value "$HERMES_ENV" TELEGRAM_HOME_CHANNEL "$TELEGRAM_HOME_CHANNEL"
chmod 600 "$HERMES_ENV"

HERMES_BIN="$(command -v hermes || true)"
if [[ -z "$HERMES_BIN" && -x "$HOME/.local/bin/hermes" ]]; then
  HERMES_BIN="$HOME/.local/bin/hermes"
fi
[[ -n "$HERMES_BIN" ]] || die "Hermes installer completed but the hermes command was not found."
"$HERMES_BIN" gateway start

printf '\nSETUP COMPLETE\n'
printf 'Vault: %s\nProject: %s\n' "$VAULT_PATH" "$PROJECT_DIR"
printf '\nComplete each browser login once:\n'
printf '  cd %q\n' "$PROJECT_DIR"
printf '  npm run auth:x\n  npm run auth:threads\n  npm run auth:instagram\n  npm run auth:linkedin\n  npm run auth:youtube\n'
printf '\nAfter confirming Computer B works, delete the handoff file: %s\n' "$SECRETS_FILE"
printf 'Legacy secret backups in %s/setup/*.env are no longer used and should also be deleted.\n' "$VAULT_PATH"
