# BatiFlow v1.0 Acceptance Criteria

This document outlines the concrete, testable criteria that must be satisfied for a build to be certified as successful.

## Acceptance Criteria Checklist

### AC-1: Chrome CDP Launching & Profile Isolation
- [ ] **AC-1.1**: Successfully launches local macOS Google Chrome binary and resolves the WebSocket debugger URL.
- [ ] **AC-1.2**: Creates and writes user-data to the custom profile path `~/Library/Application Support/Google/Chrome/BatiFlowAgent` (or equivalent test directory under workspace config).
- [ ] **AC-1.3**: Establishes a raw WebSocket connection via `chrome-remote-interface` and commands the target browser without Playwright.
- [ ] **AC-1.4**: Spawns multiple concurrent targets and closes them, ensuring no tab leaks or memory bloat occurs.

### AC-2: Recon-First Pipeline
- [ ] **AC-2.1**: When loading a LinkedIn URL, performs a fast check for the presence of global login indicators (e.g. navigation bar, profile menu).
- [ ] **AC-2.2**: Correctly identifies rate limit indicators, auth redirects, or Captcha challenge screens and raises a specialized error code (`BLOCKED_BY_RATE_LIMIT` or `UNAUTHENTICATED`).
- [ ] **AC-2.3**: Canonicalizes LinkedIn tracking URLs (e.g. removing `?ref=...` or `?mini=true`) into pure post URLs.

### AC-3: LinkedIn Capture & Content Fidelity
- [ ] **AC-3.1**: Identifies "See more" / "더 보기" buttons on LinkedIn posts, triggers a simulated click via CDP, and verifies that the text container has expanded.
- [ ] **AC-3.2**: Triggers micro-scroll movements on the page to resolve lazy-loaded image sources (`srcset`).
- [ ] **AC-3.3**: Generates a beautiful, semantic Github-Flavored Markdown file (`post.md`) containing author name, date, main text, linked media, and parsed top-level comments.

### AC-4: Capture Quality Verification
- [ ] **AC-4.1**: Emits a `verification.json` file for every single capture run.
- [ ] **AC-4.2**: Computes a score based on checks (e.g., author extraction = +0.2, content length >= 100 = +0.3, image resolve = +0.2, comments parsed = +0.2, low UI noise = +0.1).
- [ ] **AC-4.3**: Halts execution and flags the capture as `FAILED` if the total `QualityScore` drops below 0.8, generating a trace in `traces/capture-runs/`.

### AC-5: Skill Memory Gate
- [ ] **AC-5.1**: Reads and utilizes persistent selector guidelines from `skills/linkedin.com/selectors.md` during execution.
- [ ] **AC-5.2**: Upon extraction failure due to missing or shifted selectors, generates a proposed selector correction file.
- [ ] **AC-5.3**: Prevents auto-writing changes to selectors and logs a console proposal requiring explicit human confirmation.
