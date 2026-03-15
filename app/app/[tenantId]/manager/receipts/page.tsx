"use client";

/**
 * RECEIPTS PAGE (Manager)
 * =======================
 * Primary purpose: Upload and review receipt photos with auto-OCR extraction
 * Primary action: Photograph / upload a receipt
 *
 * Mobile-first — follows docs/ui-contract.md
 * - 360px minimum width
 * - 44px minimum tap targets
 * - Cards + bottom sheets, no tables
 * - Camera capture via input[type=file][capture=environment]
 *
 * Sprints 004, 005, 006:
 * - 004: Upload + list
 * - 005: OCR status + detail sheet
 * - 006: Filters + manual correction + CSV export
 */

import { useRef, useState, useMemo, useCallback } from "react";
import { useParams } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

// ─── Types ───────────────────────────────────────────────────────────────────

type Receipt = {
  _id: Id<"receipts">;
  imageStorageId: string;
  imageUrl?: string | null;
  status: "pending" | "processing" | "done" | "failed";
  branchId: Id<"branches">;
  supplierName?: string;
  totalAmount?: number;
  vatAmount?: number;
  vatPercent?: number;
  receiptDate?: string;
  currency?: string;
  language?: string;
  rawOcrText?: string;
  ocrError?: string;
  manualSupplierName?: string;
  manualTotalAmount?: number;
  manualVatAmount?: number;
  manualVatPercent?: number;
  manualReceiptDate?: string;
  manualCurrency?: string;
  uploadedByUserId: string;
  createdAt: number;
};

type DateFilter = "all" | "7d" | "30d";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function displayValue<T>(manual: T | undefined, ocr: T | undefined): T | undefined {
  return manual ?? ocr;
}

function formatCurrency(amount: number | undefined, currency: string | undefined): string {
  if (amount == null) return "—";
  const sym = currency === "ILS" ? "₪" : currency === "USD" ? "$" : currency === "EUR" ? "€" : (currency ?? "");
  return `${sym}${amount.toFixed(2)}`;
}

function formatDate(ds: string | undefined): string {
  if (!ds) return "—";
  try {
    return new Date(ds).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return ds;
  }
}

function statusLabel(s: Receipt["status"]): string {
  return s === "pending" ? "Queued" : s === "processing" ? "Reading..." : s === "done" ? "Done" : "Failed";
}

function statusColor(s: Receipt["status"]): string {
  return s === "done" ? "#16a34a" : s === "failed" ? "#dc2626" : "#d97706";
}

function downloadCsv(rows: Record<string, string | number>[], filename: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => JSON.stringify(r[h] ?? "")).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function ManagerReceiptsPage() {
  const params = useParams();
  const tenantId = params.tenantId as Id<"tenants">;
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Queries
  const tenantInfo = useQuery(api.tenants.getTenant, { tenantId });
  const receipts = useQuery(api.receipts.listReceipts, { tenantId }) as Receipt[] | undefined;
  const branches = useQuery(api.branches.getBranches, { tenantId });
  const exportRows = useQuery(api.receipts.exportReceiptsCsv, { tenantId });

  // Mutations / Actions
  const generateUploadUrl = useAction(api.receipts.generateUploadUrl);
  const createReceipt = useMutation(api.receipts.createReceipt);
  const retryOcr = useMutation(api.receipts.retryOcr);
  const updateReceiptFields = useMutation(api.receipts.updateReceiptFields);
  const deleteReceipt = useMutation(api.receipts.deleteReceipt);

  // UI state
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [isSaving, setIsSaving] = useState(false);

  // Detail sheet: editing state
  const [editSupplier, setEditSupplier] = useState("");
  const [editTotal, setEditTotal] = useState("");
  const [editVat, setEditVat] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editCurrency, setEditCurrency] = useState("");
  const [editMode, setEditMode] = useState(false);

  // Default branch: use manager's branch, or first branch for owner
  const defaultBranchId = useMemo(() => {
    if (tenantInfo?.currentBranchId) return tenantInfo.currentBranchId as Id<"branches">;
    if (branches && branches.length > 0) return branches[0]._id as Id<"branches">;
    return null;
  }, [tenantInfo, branches]);

  // Filter receipts by date
  const filteredReceipts = useMemo(() => {
    if (!receipts) return [];
    if (dateFilter === "all") return receipts;
    const cutoff = Date.now() - (dateFilter === "7d" ? 7 : 30) * 24 * 60 * 60 * 1000;
    return receipts.filter((r) => r.createdAt >= cutoff);
  }, [receipts, dateFilter]);

  // ── Upload handler ──────────────────────────────────────────────────────────

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !defaultBranchId) return;
      if (fileInputRef.current) fileInputRef.current.value = "";

      setUploadError(null);
      setUploading(true);

      try {
        // 1. Get upload URL from Convex
        const uploadUrl = await generateUploadUrl({ tenantId });

        // 2. Upload image directly to Convex storage
        const uploadRes = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });

        if (!uploadRes.ok) throw new Error("Upload failed. Please try again.");

        const { storageId } = await uploadRes.json();

        // 3. Create the receipt record (triggers OCR automatically)
        await createReceipt({
          tenantId,
          branchId: defaultBranchId,
          imageStorageId: storageId,
        });
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setUploading(false);
      }
    },
    [tenantId, defaultBranchId, generateUploadUrl, createReceipt]
  );

  // ── Open detail sheet ───────────────────────────────────────────────────────

  const openDetail = useCallback((r: Receipt) => {
    setSelectedReceipt(r);
    setConfirmDelete(false);
    setEditMode(false);
    setEditSupplier(r.manualSupplierName ?? r.supplierName ?? "");
    setEditTotal(String(r.manualTotalAmount ?? r.totalAmount ?? ""));
    setEditVat(String(r.manualVatAmount ?? r.vatAmount ?? ""));
    setEditDate(r.manualReceiptDate ?? r.receiptDate ?? "");
    setEditCurrency(r.manualCurrency ?? r.currency ?? "");
  }, []);

  // ── Save corrections ────────────────────────────────────────────────────────

  const handleSaveCorrections = useCallback(async () => {
    if (!selectedReceipt) return;
    setIsSaving(true);
    try {
      await updateReceiptFields({
        tenantId,
        receiptId: selectedReceipt._id,
        manualSupplierName: editSupplier || undefined,
        manualTotalAmount: editTotal ? parseFloat(editTotal) : undefined,
        manualVatAmount: editVat ? parseFloat(editVat) : undefined,
        manualReceiptDate: editDate || undefined,
        manualCurrency: editCurrency || undefined,
      });
      setEditMode(false);
    } catch {
      // keep editing open on error
    } finally {
      setIsSaving(false);
    }
  }, [selectedReceipt, tenantId, updateReceiptFields, editSupplier, editTotal, editVat, editDate, editCurrency]);

  // ── Delete receipt ──────────────────────────────────────────────────────────

  const handleDelete = useCallback(async () => {
    if (!selectedReceipt) return;
    setIsSaving(true);
    try {
      await deleteReceipt({ tenantId, receiptId: selectedReceipt._id });
      setSelectedReceipt(null);
    } catch {
      // ignore
    } finally {
      setIsSaving(false);
    }
  }, [selectedReceipt, tenantId, deleteReceipt]);

  // ── Retry OCR ───────────────────────────────────────────────────────────────

  const handleRetryOcr = useCallback(async () => {
    if (!selectedReceipt) return;
    await retryOcr({ tenantId, receiptId: selectedReceipt._id });
  }, [selectedReceipt, tenantId, retryOcr]);

  // ── CSV Export ──────────────────────────────────────────────────────────────

  const handleExport = useCallback(() => {
    if (!exportRows) return;
    downloadCsv(
      exportRows.map((r) => ({
        date: r.date,
        supplier: r.supplier,
        total: r.total,
        vat: r.vat,
        vatPercent: r.vatPercent,
        currency: r.currency,
        status: r.status,
      })),
      `receipts-${new Date().toISOString().slice(0, 10)}.csv`
    );
  }, [exportRows]);

  // ── Loading ─────────────────────────────────────────────────────────────────

  if (tenantInfo === undefined || receipts === undefined) {
    return (
      <div className="dashboard-container">
        <div className="dashboard-loading">
          <div className="spinner" />
          <p>Loading receipts...</p>
        </div>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div>
      <header className="dashboard-header">
        <h1 className="dashboard-title">Receipts</h1>
        <p className="dashboard-subtitle">Expense tracking</p>
      </header>

      {/* Upload button */}
      <section style={{ marginBottom: "1rem" }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
        <button
          className="btn btn-primary"
          style={{ width: "100%", minHeight: 52, fontSize: "1rem", fontWeight: 700 }}
          disabled={uploading || !defaultBranchId}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? "Uploading..." : "📷  Photograph Receipt"}
        </button>
        {uploadError && (
          <p style={{ color: "#dc2626", fontSize: "0.875rem", marginTop: "0.5rem" }}>{uploadError}</p>
        )}
        {!defaultBranchId && (
          <p style={{ color: "var(--muted)", fontSize: "0.875rem", marginTop: "0.5rem" }}>
            No branch available. Please contact your manager.
          </p>
        )}
      </section>

      {/* Date filter chips */}
      <section style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        {(["all", "7d", "30d"] as DateFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setDateFilter(f)}
            style={{
              minHeight: 36,
              padding: "0 0.75rem",
              borderRadius: 20,
              border: "1px solid var(--border)",
              background: dateFilter === f ? "var(--primary)" : "white",
              color: dateFilter === f ? "white" : "var(--foreground)",
              fontSize: "0.8125rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {f === "all" ? "All time" : f === "7d" ? "Last 7 days" : "Last 30 days"}
          </button>
        ))}

        {/* Export CSV */}
        {exportRows && exportRows.length > 0 && (
          <button
            onClick={handleExport}
            style={{
              minHeight: 36,
              padding: "0 0.75rem",
              borderRadius: 20,
              border: "1px solid var(--border)",
              background: "white",
              color: "var(--foreground)",
              fontSize: "0.8125rem",
              fontWeight: 600,
              cursor: "pointer",
              marginLeft: "auto",
            }}
          >
            Export CSV
          </button>
        )}
      </section>

      {/* Receipt list */}
      {filteredReceipts.length === 0 ? (
        <section className="metric-card" style={{ textAlign: "center", padding: "2rem 1rem" }}>
          <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🧾</div>
          <div style={{ fontWeight: 700, marginBottom: "0.25rem" }}>No receipts yet</div>
          <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
            Tap the button above to photograph your first receipt.
          </div>
        </section>
      ) : (
        <section style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {filteredReceipts.map((r) => {
            const supplier = displayValue(r.manualSupplierName, r.supplierName);
            const total = displayValue(r.manualTotalAmount, r.totalAmount);
            const currency = displayValue(r.manualCurrency, r.currency);
            const date = displayValue(r.manualReceiptDate, r.receiptDate);

            return (
              <button
                key={r._id}
                onClick={() => openDetail(r)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  padding: "0.75rem",
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  background: "white",
                  textAlign: "left",
                  cursor: "pointer",
                  minHeight: 72,
                  width: "100%",
                }}
              >
                {/* Thumbnail */}
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 8,
                    overflow: "hidden",
                    flexShrink: 0,
                    background: "var(--border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {r.imageUrl ? (
                    <img src={r.imageUrl} alt="Receipt" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <span style={{ fontSize: "1.5rem" }}>🧾</span>
                  )}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: "0.9375rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {supplier || "Unknown supplier"}
                  </div>
                  <div style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>
                    {formatDate(date)} {date && total != null ? "·" : ""} {formatCurrency(total, currency)}
                  </div>
                </div>

                {/* Status badge */}
                <span
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    color: statusColor(r.status),
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  {r.status === "processing" && <span className="spinner" style={{ width: 12, height: 12 }} />}
                  {statusLabel(r.status)}
                </span>
              </button>
            );
          })}
        </section>
      )}

      {/* ── Detail / Edit Sheet ──────────────────────────────────────────────── */}
      {selectedReceipt && (
        <BottomSheet
          title={editMode ? "Edit Receipt" : "Receipt Details"}
          onClose={() => { setSelectedReceipt(null); setEditMode(false); setConfirmDelete(false); }}
        >
          {/* Image */}
          {selectedReceipt.imageUrl && (
            <div style={{ marginBottom: "0.75rem", borderRadius: 8, overflow: "hidden", maxHeight: 220 }}>
              <img src={selectedReceipt.imageUrl} alt="Receipt" style={{ width: "100%", objectFit: "contain", maxHeight: 220 }} />
            </div>
          )}

          {/* Status banner */}
          {selectedReceipt.status !== "done" && (
            <div
              style={{
                padding: "0.5rem 0.75rem",
                borderRadius: 8,
                background: selectedReceipt.status === "failed" ? "#fef2f2" : "#fffbeb",
                color: statusColor(selectedReceipt.status),
                fontSize: "0.875rem",
                fontWeight: 600,
                marginBottom: "0.75rem",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {selectedReceipt.status === "processing" && <span className="spinner" style={{ width: 14, height: 14 }} />}
              {selectedReceipt.status === "pending" && "Waiting to process..."}
              {selectedReceipt.status === "processing" && "Reading receipt with AI..."}
              {selectedReceipt.status === "failed" && `OCR failed: ${selectedReceipt.ocrError ?? "Unknown error"}`}
            </div>
          )}

          {/* Fields: view or edit */}
          {!editMode ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "0.75rem" }}>
              <FieldRow label="Supplier" value={displayValue(selectedReceipt.manualSupplierName, selectedReceipt.supplierName)} />
              <FieldRow label="Total" value={formatCurrency(displayValue(selectedReceipt.manualTotalAmount, selectedReceipt.totalAmount), displayValue(selectedReceipt.manualCurrency, selectedReceipt.currency))} />
              <FieldRow label="VAT" value={formatCurrency(displayValue(selectedReceipt.manualVatAmount, selectedReceipt.vatAmount), displayValue(selectedReceipt.manualCurrency, selectedReceipt.currency))} />
              <FieldRow label="Date" value={formatDate(displayValue(selectedReceipt.manualReceiptDate, selectedReceipt.receiptDate))} />
              <FieldRow label="Currency" value={displayValue(selectedReceipt.manualCurrency, selectedReceipt.currency)} />
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem", marginBottom: "0.75rem" }}>
              <EditField label="Supplier" value={editSupplier} onChange={setEditSupplier} placeholder="e.g. Super-Pharm" />
              <EditField label="Total amount" value={editTotal} onChange={setEditTotal} placeholder="0.00" type="number" />
              <EditField label="VAT amount" value={editVat} onChange={setEditVat} placeholder="0.00" type="number" />
              <EditField label="Date (YYYY-MM-DD)" value={editDate} onChange={setEditDate} placeholder="2024-01-15" />
              <EditField label="Currency" value={editCurrency} onChange={setEditCurrency} placeholder="ILS" />
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {!editMode ? (
              <>
                <button
                  className="btn btn-primary"
                  style={{ width: "100%", minHeight: 44 }}
                  onClick={() => setEditMode(true)}
                >
                  Edit Fields
                </button>
                {selectedReceipt.status === "failed" && (
                  <button
                    className="btn btn-secondary"
                    style={{ width: "100%", minHeight: 44 }}
                    onClick={handleRetryOcr}
                  >
                    Retry OCR
                  </button>
                )}
                {!confirmDelete ? (
                  <button
                    className="btn btn-secondary"
                    style={{ width: "100%", minHeight: 44, color: "#dc2626" }}
                    onClick={() => setConfirmDelete(true)}
                  >
                    Delete Receipt
                  </button>
                ) : (
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      className="btn btn-secondary"
                      style={{ flex: 1, minHeight: 44 }}
                      onClick={() => setConfirmDelete(false)}
                      disabled={isSaving}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn btn-primary"
                      style={{ flex: 1, minHeight: 44, background: "#dc2626" }}
                      onClick={handleDelete}
                      disabled={isSaving}
                    >
                      {isSaving ? "Deleting..." : "Confirm Delete"}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  className="btn btn-secondary"
                  style={{ flex: 1, minHeight: 44 }}
                  onClick={() => setEditMode(false)}
                  disabled={isSaving}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  style={{ flex: 1, minHeight: 44 }}
                  onClick={handleSaveCorrections}
                  disabled={isSaving}
                >
                  {isSaving ? "Saving..." : "Save"}
                </button>
              </div>
            )}
          </div>
        </BottomSheet>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FieldRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
      <span style={{ fontSize: "0.8125rem", color: "var(--muted)", flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: "0.9rem", fontWeight: 600, textAlign: "right" }}>{value || "—"}</span>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label style={{ display: "block", fontSize: "0.8125rem", color: "var(--muted)", marginBottom: "0.25rem" }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%",
          minHeight: 44,
          padding: "0 0.75rem",
          borderRadius: 8,
          border: "1px solid var(--border)",
          fontSize: "0.9375rem",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}

function BottomSheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "white",
          borderTopLeftRadius: "1rem",
          borderTopRightRadius: "1rem",
          padding: "1rem",
          maxWidth: 480,
          width: "100%",
          margin: "0 auto",
          border: "1px solid var(--border)",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", marginBottom: "1rem" }}>
          <div style={{ fontSize: "1rem", fontWeight: 700 }}>{title}</div>
          <button className="btn btn-secondary" style={{ minHeight: 44 }} onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
