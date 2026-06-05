# Computer B Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Computer B fully configurable from the GitHub repository after Google Drive Desktop login.

**Architecture:** A repository-owned idempotent shell bootstrap detects the shared vault, collects local-only secrets, installs dependencies, and registers the daily-sync macOS LaunchAgent. Hermes Gateway exclusively owns Telegram polling. Dynamic TypeScript path setup replaces hardcoded Computer A paths.

**Tech Stack:** Bash, macOS launchd, Node.js, TypeScript, Google Drive Desktop

---

### Task 1: Add bootstrap contract and environment template

**Files:**
- Create: `.env.example`
- Create: `scripts/test-setup-computer-b.sh`
- Create: `setup-computer-b.sh`

- [ ] Add a shell test that verifies syntax, required secret handling, Google Drive detection, and absence of legacy env copying.
- [ ] Run the test and verify it fails before the bootstrap exists.
- [ ] Implement the repository-owned bootstrap and local secret prompts.
- [ ] Run the shell test and verify it passes.

### Task 2: Remove machine-specific path assumptions

**Files:**
- Modify: `packages/capture/tests/setup-google-drive.ts`
- Modify: `packages/capture/telegram/TelegramBot.ts`

- [ ] Resolve the project root dynamically instead of using Computer A paths.
- [ ] Make missing-token messages machine independent.
- [ ] Run the TypeScript build.

### Task 3: Update shared documentation

**Files:**
- Modify: `batiflow-vault/BatiFlow & Hermes 아키텍처 구조도.md`
- Modify: `batiflow-vault/BatiFlow & Hermes 두 대의 컴퓨터 연동 가이드.md`

- [ ] Replace iCloud/Dropbox wording with Google Drive Desktop.
- [ ] Document the GitHub bootstrap command and local-only secret entry.

### Task 4: Verify and publish

**Files:**
- Review: all changed files

- [ ] Run shell tests, `bash -n`, bootstrap `--check`, TypeScript build, and secret scan.
- [ ] Stage only Computer B bootstrap-related repository files.
- [ ] Commit and push to `origin/main`.
