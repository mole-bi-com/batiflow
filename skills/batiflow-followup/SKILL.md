---
name: batiflow-followup
description: Ingest URLs into BatiFlow and revise the most recent BatiFlow Markdown result when the user sends follow-up requirements such as deeper analysis, restructuring, adding counterarguments, or changing the format. Use for URLs and for natural-language requests referring to the immediately preceding BatiFlow result.
---

# BatiFlow Follow-up

Use the terminal tool. The project directory is:

`/Users/seungwoolee/Desktop/project/batiflow`

## URL ingestion

- YouTube:
  `cd /Users/seungwoolee/Desktop/project/batiflow && npm run ingest:youtube -- --url "<URL>"`
- X, Threads, LinkedIn, Instagram:
  `cd /Users/seungwoolee/Desktop/project/batiflow && npx ts-node packages/capture/worker/IngestWorker.ts --url "<URL>"`
- Other HTTP(S) URLs:
  `cd /Users/seungwoolee/Desktop/project/batiflow && npm run ingest:web -- --url "<URL>"`

After ingestion, capture the path printed as `BATIFLOW_RESULT_PATH`. Treat it as the latest BatiFlow result for the current conversation and tell the user the summary and saved path.

## Follow-up revision

When the user sends a request that refers to the latest result without a new URL:

1. Use the latest `BATIFLOW_RESULT_PATH` from the current conversation.
2. Run:
   `cd /Users/seungwoolee/Desktop/project/batiflow && npm run revise:markdown -- --path "<LATEST_PATH>" --instruction "<USER_REQUEST>"`
3. This intentionally overwrites the same Markdown file.
4. Read the revised file and return a concise summary of what changed.

The follow-up request itself is authorization to overwrite the latest result. You MUST run `revise:markdown` before answering. Do not answer by analyzing the prior content directly, do not ask whether the user wants it saved, and do not offer saving as a separate next step. Never use file editing or patch tools as a fallback. If the command fails or times out, retry it once; if it still fails, report the failure without modifying the note another way.

If no latest result path exists in the current conversation, ask the user to send or reply to the source URL again. Never guess a file path.
