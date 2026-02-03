"use client";

import Link from "next/link";

/**
 * CHECKOUT CANCEL PAGE
 * ====================
 * 
 * Simple page shown when user cancels checkout.
 * No data writes - just UI with link back to pricing.
 */
export default function CheckoutCancelPage() {
  return (
    <div className="page-center">
      <div className="card">
        <h1 className="title">Payment canceled</h1>
        <p className="subtitle">
          You can try again anytime. No charges were made.
        </p>
        <Link href="/pricing" className="btn btn-primary">
          Back to Pricing
        </Link>
      </div>
    </div>
  );
}
