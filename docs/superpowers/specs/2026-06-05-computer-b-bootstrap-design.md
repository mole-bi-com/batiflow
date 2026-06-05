# Computer B Bootstrap Design

## Goal

After Google Drive Desktop is installed and signed in on Computer B, cloning the
BatiFlow GitHub repository and running one shell script configures BatiFlow,
Hermes, the shared Obsidian vault, and the macOS background jobs.

## Architecture

- `setup-computer-b.sh` lives in the BatiFlow GitHub repository and is the only
  setup entry point.
- The script detects the signed-in Google Drive mount and the shared
  `batiflow-vault` directory.
- Secrets are requested interactively on Computer B and stored only in local
  files with mode `600`. GitHub and Google Drive are not used as secret stores.
- Non-secret Hermes assets may be restored from `batiflow-vault/setup`.
- BatiFlow's daily sync is registered as a user LaunchAgent and Hermes Gateway
  exclusively owns the Telegram long-polling connection.
- The script is idempotent: rerunning it updates dependencies and service files
  without deleting unrelated cron jobs or overwriting existing secrets unless
  explicitly requested.

## Secret Handling

The required BatiFlow secrets are `DEEPSEEK_API_KEY` and
`TELEGRAM_BOT_TOKEN`. Existing local values are preserved. Missing values are
entered with terminal echo disabled. Generated `.env` files are mode `600`.

Tracked `.env.example` files contain names and safe defaults only. Existing
`batiflow-vault/setup/batiflow.env` and `hermes.env` are treated as legacy
secret backups and are never copied by the new setup script.

## Failure Handling

The script exits immediately on a failed required command and prints the failed
step. It checks macOS, Google Drive, Git, Node.js, npm, and the vault before
making changes. A `--check` mode validates prerequisites without installing or
starting services.

## Verification

- Shell syntax check passes.
- `--check` detects the current Google Drive vault and required tools.
- TypeScript build passes.
- Hermes Gateway and BatiFlow's Telegram bot are not started concurrently with
  the same token.
- Git tracked-file scan finds no `.env` secrets or machine-specific generated
  service files.
