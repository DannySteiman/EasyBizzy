# Sprint 004

Sprint Goal:
OWNER and MANAGER can photograph or upload a receipt that is stored in Convex and queued for processing.

Frozen Scope:
- receipts table in schema (tenantId, branchId, imageStorageId, status, uploadedByUserId, createdAt)
- generateUploadUrl action (Convex native file storage)
- createReceipt mutation (after upload, store storageId + metadata)
- listReceipts query (by tenant/branch, ordered by createdAt desc)
- deleteReceipt mutation (OWNER/MANAGER only, own branch)
- Guards: requireTenantContext + requireManager + requireSubscriptionAllowed
- Mobile UI: replace placeholder page with camera/upload button + pending list
- Empty state, loading state, error state
- Lint + build pass

Out of Scope:
- OCR / field extraction (Sprint 005)
- Field editing / correction UI (Sprint 005)
- Filters by date range (Sprint 006)
- CSV export (Sprint 006)

Vertical Slice 1 — Backend:
[x] Add receipts table to convex/schema.ts
[x] Implement convex/receipts.ts:
    - generateUploadUrl (action)
    - createReceipt (mutation)
    - listReceipts (query)
    - deleteReceipt (mutation)

Vertical Slice 2 — Mobile UI:
[x] Replace placeholder receipts page with:
    - Camera / file picker button (input[type=file] capture=environment)
    - Upload + create flow (generate URL -> upload -> createReceipt)
    - Receipt card list (image thumbnail, status badge, date, branch)
    - Empty state ("No receipts yet")
    - Loading skeleton

Manual Test Checklist:
[ ] MANAGER can open receipts page without error
[ ] Camera picker opens on mobile tap
[ ] Photo uploads successfully (status = "pending")
[ ] Receipt appears in list immediately (realtime)
[ ] WORKER cannot access page (guard blocks)
[ ] Inactive subscription blocks upload
[ ] Lint passes (npm run lint)
[ ] Build succeeds (npm run build)
