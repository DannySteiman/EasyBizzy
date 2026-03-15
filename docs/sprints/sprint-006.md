# Sprint 006

Sprint Goal:
Managers can filter their receipt history by date and branch, manually correct OCR errors, and export a CSV summary.

Frozen Scope:
- Date range filter on receipt list (last 7 days / 30 days / custom)
- Branch filter (OWNER sees all branches; MANAGER sees their branch only)
- Manual correction UI on receipt detail:
    - Editable fields: supplierName, totalAmount, vatAmount, vatPercent, receiptDate, currency
    - Save correction (updateReceiptFields mutation)
    - Corrections stored separately (manualSupplierName, manualTotalAmount, etc.)
    - Display shows manual value if set, fallback to OCR value
- updateReceiptFields mutation with requireManager guard
- deleteReceipt button on detail page (with confirmation)
- CSV export:
    - exportReceiptsCsv query: returns rows for date range + branch
    - Frontend triggers download (Blob + URL.createObjectURL)
    - Columns: date, supplier, total, VAT, currency, branch, uploadedBy, status
- Receipt summary card on manager dashboard:
    - Total receipts this month
    - Total spend this month (sum of totalAmount)
- Lint + build pass

Out of Scope:
- PDF export
- Accountant integrations (QuickBooks, Xero)
- Receipt approval workflow
- Notifications

Vertical Slice 1 — Filters + Correction:
[ ] Add filter UI to receipts list (date range chips + branch selector for OWNER)
[ ] Pass filters to listReceipts query
[ ] Add listReceipts index: by_tenant_branch_date ["tenantId", "branchId", "createdAt"]
[ ] Receipt detail: add editable fields with Save button
[ ] Implement updateReceiptFields mutation

Vertical Slice 2 — Export + Dashboard Summary:
[ ] Implement exportReceiptsCsv query
[ ] Add CSV download button to receipts page
[ ] Add receipt summary metric card to manager home dashboard
[ ] Wire to real data (total count + total spend this month)

Manual Test Checklist:
[ ] Filter by last 7 days shows correct receipts
[ ] Filter by branch works for OWNER (sees all branches)
[ ] MANAGER only sees their branch (cannot change branch filter)
[ ] Manual correction saves and displays correctly
[ ] OCR value shown when no manual correction set
[ ] Delete receipt works (with confirmation)
[ ] CSV download triggers with correct data
[ ] Dashboard metric card shows correct count and spend
[ ] Lint passes
[ ] Build succeeds
