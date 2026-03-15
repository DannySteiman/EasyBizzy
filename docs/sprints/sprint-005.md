# Sprint 005

Sprint Goal:
Uploaded receipts are automatically analyzed by Claude AI to extract supplier, total amount, VAT, date and currency — in Hebrew and English — and the results are shown to the user for review.

OCR Engine: Claude API (claude-sonnet-4-6 vision)
- Single API call returns structured JSON (no second parsing step)
- Excellent Hebrew + English support
- Prompt instructs model to return: supplier, totalAmount, vatAmount, vatPercent, receiptDate, currency, language, rawText

Frozen Scope:
- ANTHROPIC_API_KEY environment variable (set in Convex dashboard)
- @anthropic-ai/sdk added to package.json
- convex/receiptOcr.ts — Convex Action that:
    1. Fetches image bytes from Convex storage (ctx.storage.get)
    2. Converts to base64
    3. Calls Claude claude-sonnet-4-6 with vision prompt (Hebrew + English)
    4. Parses structured JSON response
    5. Updates receipt row with extracted fields + status: "done" (or "failed")
- Schema additions to receipts table:
    supplierName, totalAmount, vatAmount, vatPercent,
    receiptDate, currency, language, rawOcrText,
    ocrError (optional, for failed OCR)
- Trigger OCR action automatically after createReceipt (status: "processing")
- Receipt detail page (bottom sheet or full screen):
    - Image (full width)
    - Extracted fields displayed (supplier, total, VAT, date)
    - Status badge: processing / done / failed
    - "Retry OCR" button if status = failed
- Guards: same as Sprint 004 (requireManager + requireSubscriptionAllowed)
- Lint + build pass

Out of Scope:
- Manual field editing / correction (Sprint 006)
- CSV export (Sprint 006)
- Date range filters (Sprint 006)

Vertical Slice 1 — OCR Backend:
[x] Add @anthropic-ai/sdk to package.json
[x] Add OCR fields to receipts schema
[x] Implement convex/receiptOcr.ts action
[x] Wire createReceipt to trigger OCR action (internal action scheduling)
[x] Implement retryOcr mutation

Vertical Slice 2 — Review UI:
[x] Receipt card in list shows status badge (processing spinner, done checkmark, failed warning)
[x] Tap receipt card -> opens detail sheet:
    - Full image
    - Extracted fields (or error message)
    - Retry button (if failed)

Manual Test Checklist:
[ ] Upload receipt -> status immediately shows "processing"
[ ] Within ~5 seconds status flips to "done" (realtime)
[ ] Extracted supplier / amount / VAT / date display correctly
[ ] Hebrew receipt: fields extracted correctly
[ ] English receipt: fields extracted correctly
[ ] If OCR fails: status = "failed", error message shown, retry button visible
[ ] Retry button re-triggers OCR successfully
[ ] Lint passes
[ ] Build succeeds

Environment Variables Required:
- ANTHROPIC_API_KEY (set via: npx convex env set ANTHROPIC_API_KEY "sk-ant-...")
