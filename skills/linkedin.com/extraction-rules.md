# LinkedIn Extraction Guidelines

This document details the parsing and extraction rules for BatiFlow's LinkedIn module.

## Core Content Extraction
1. **URL Canonicalization**:
   - Strip all analytics parameters like `?ref=...`, `?trackingId=...`, `?mini=true`, `?lipi=...`.
   - Pattern should resolve to `https://www.linkedin.com/feed/update/urn:li:activity:{id}/` or `https://www.linkedin.com/posts/{slug}-activity-{id}`.

2. **Expansion**:
   - Locate and click the "See more" (`see_more_button`) button to expand the full text.
   - Wait at least 1500ms after clicking to ensure DOM hydration.

3. **Images Extraction**:
   - Identify image tags inside the post body.
   - Wait for lazy loading by scrolling the target element into view (`scrollIntoView()`).
   - Extract the highest resolution URL from `srcset` or fallback to `src`.

4. **Comments Extraction**:
   - Parse top-level comments under the post container.
   - For each comment, collect:
     - Author name
     - Author headline (optional)
     - Comment text
     - Timestamp / relative date

## Exclusions & Avoidances (Durable Decisions)
- **Do not click coordinates**: Screen resolutions change. All clicks must be element-based.
- **Do not use nth-child selectors**: They are highly fragile when page layout changes dynamically.
- **Do not harvest UI Chrome**: Exclude global headers, footer links, share widgets, reaction counters as main body text.
