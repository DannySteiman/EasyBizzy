"use client";

import { useMemo, useState } from "react";

type Category = "Food" | "Drinks" | "Services";

type Product = {
  id: string;
  name: string;
  desc: string;
  category: Category;
};

const PRODUCTS: Product[] = [
  { id: "p1", name: "House Sandwich", desc: "Signature sandwich (placeholder).", category: "Food" },
  { id: "p2", name: "Iced Latte", desc: "Espresso + milk over ice (placeholder).", category: "Drinks" },
  { id: "p3", name: "On-site setup", desc: "Setup service (placeholder).", category: "Services" },
];

export default function WorkerProductsPage() {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Record<Category, boolean>>({
    Food: true,
    Drinks: false,
    Services: false,
  });
  const [sheetProductId, setSheetProductId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return PRODUCTS;
    return PRODUCTS.filter((p) => (p.name + " " + p.desc).toLowerCase().includes(q));
  }, [search]);

  const productById = useMemo(() => {
    const m = new Map(filtered.map((p) => [p.id, p]));
    return m;
  }, [filtered]);

  const categories: Category[] = ["Food", "Drinks", "Services"];

  return (
    <div>
      <header className="dashboard-header">
        <h1 className="dashboard-title">Products</h1>
        <p className="dashboard-subtitle">Products &amp; Services</p>
      </header>

      <WorkerCard>
        <label style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>Search</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products..."
            style={{
              minHeight: 44,
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "0 0.75rem",
              fontSize: "0.875rem",
            }}
          />
        </label>
      </WorkerCard>

      {categories.map((c) => {
        const isOpen = open[c];
        const items = filtered.filter((p) => p.category === c);
        return (
          <WorkerCard key={c}>
            <button
              onClick={() => setOpen((prev) => ({ ...prev, [c]: !prev[c] }))}
              style={{
                width: "100%",
                minHeight: 44,
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                textAlign: "left",
              }}
            >
              <div style={{ fontSize: "1rem", fontWeight: 800 }}>{c}</div>
              <div style={{ color: "var(--muted)", fontSize: "1.25rem", lineHeight: 1 }}>
                {isOpen ? "▾" : "▸"}
              </div>
            </button>

            {isOpen && (
              <div style={{ marginTop: "0.75rem" }}>
                {items.length === 0 ? (
                  <div style={{ color: "var(--muted)", fontSize: "0.875rem" }}>No items.</div>
                ) : (
                  <div className="action-list" style={{ gap: "0.5rem" }}>
                    {items.map((p) => (
                      <button
                        key={p.id}
                        className="action-item"
                        style={{ width: "100%", textAlign: "left", cursor: "pointer" }}
                        onClick={() => setSheetProductId(p.id)}
                      >
                        <span className="action-icon">📦</span>
                        <span className="action-content">
                          <span className="action-label">{p.name}</span>
                          <span className="action-description">{p.desc}</span>
                        </span>
                        <span className="action-chevron">›</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </WorkerCard>
        );
      })}

      {sheetProductId && (
        <BottomSheet title="Product details" onClose={() => setSheetProductId(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div>
              <div style={{ fontSize: "1.125rem", fontWeight: 800 }}>
                {productById.get(sheetProductId)?.name ?? "—"}
              </div>
              <div style={{ fontSize: "0.875rem", color: "var(--muted)", marginTop: 4 }}>
                {productById.get(sheetProductId)?.desc ?? "—"}
              </div>
            </div>

            <WorkerCard>
              <div style={{ fontSize: "0.875rem", fontWeight: 700 }}>Ingredients / Materials</div>
              <div style={{ fontSize: "0.875rem", color: "var(--muted)", marginTop: 6 }}>
                Placeholder list goes here.
              </div>
            </WorkerCard>

            <WorkerCard>
              <div style={{ fontSize: "0.875rem", fontWeight: 700 }}>Internal notes</div>
              <div style={{ fontSize: "0.875rem", color: "var(--muted)", marginTop: 6 }}>
                Placeholder notes go here.
              </div>
            </WorkerCard>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}

function WorkerCard({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        background: "white",
        border: "1px solid var(--border)",
        borderRadius: "0.75rem",
        padding: "1rem",
        marginBottom: "0.75rem",
      }}
    >
      {children}
    </section>
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
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
          <div style={{ fontSize: "1rem", fontWeight: 700 }}>{title}</div>
          <button className="btn btn-secondary" style={{ minHeight: 44 }} onClick={onClose}>
            Close
          </button>
        </div>
        <div style={{ marginTop: "0.75rem" }}>{children}</div>
      </div>
    </div>
  );
}

