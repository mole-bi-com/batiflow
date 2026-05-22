# BatiFlow v1.0 Requirements & Traceability

This document describes the functional and technical requirements for the BatiFlow v1.0 capture engine, detailing the traceability from developer intent to technical specifications.

## R1: Real Chrome CDP-based Capture Engine
BatiFlow must use a real local Google Chrome browser instance via Chrome DevTools Protocol (CDP) for high-fidelity extraction of dynamic web content (specifically LinkedIn) to avoid bot detection and retain logged-in sessions.

- **R1.1**: The system must locate and launch the macOS Google Chrome binary in debugging mode (`--remote-debugging-port=9222`).
- **R1.2**: A separate browser profile (`BatiFlowAgent`) must be used with a persistent `--user-data-dir` so login sessions (cookies, indexedDB, localStorage) are stored separate from the user's primary browser profile.
- **R1.3**: The capture engine must interface with Chrome using direct CDP websocket connections rather than loading heavy browser automation frameworks where possible.
- **R1.4**: Tab management must support tab-level isolation (`TabPool`), allowing multiple simultaneous capture requests to run in isolated contexts without mixing states or tabs.
- **R1.5**: If the CDP capture fails or Chrome is unavailable, the system must gracefully fall back to a headless Playwright scraper.

## R2: Recon-First Workflow
To ensure stability and early failure detection, the browser session must execute a reconnaissance check before scraping the target body.

- **R2.1**: Detect if the current session is logged into LinkedIn. If unauthenticated, halt and trigger a login prompt.
- **R2.2**: Canonicalize the target URL to resolve redirections or tracking parameters.
- **R2.3**: Verify if the post is blocked, rate-limited, or showing a Captcha challenge.
- **R2.4**: Locate the primary structural containers (post body, media tags) to verify structural integrity before full capture.

## R3: Verification-First Extraction Quality
Every captured result must be strictly validated against a set of quality heuristics rather than silently saving incomplete or corrupt markdowns.

- **R3.1**: Check if essential fields (author, body content, timestamp) are successfully parsed.
- **R3.2**: Check if extracted text length matches realistic minimum bounds (e.g. >= 100 characters).
- **R3.3**: Cross-reference the number of extracted media tags with the references within the generated Markdown file.
- **R3.4**: Compute a `QualityScore` (0.0 to 1.0) and output a structured `verification.json` and execution trace `capture.trace.json`.

## R4: Skill Memory Gate (Durable Learning)
The capture engine must learn from failures to adjust selectors or behaviors, but must selectively gate what is persisted as "durable knowledge" to avoid saving ephemeral actions.

- **R4.1**: Create site-specific skill folders (e.g., `skills/linkedin.com/`) to store stable selector paths, extraction hints, and rate-limit rules.
- **R4.2**: Extract ephemeral metrics vs durable guidelines from failed runs.
- **R4.3**: Present selector or behavior updates as a proposal to the user, appending it to the site's skill notes only upon human approval.
