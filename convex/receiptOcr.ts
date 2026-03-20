/**
 * RECEIPT OCR ACTION
 * ==================
 *
 * WHERE THIS LIVES: convex/receiptOcr.ts
 *
 * Convex internal action that:
 * 1. Fetches the receipt image from Convex storage
 * 2. Converts to base64
 * 3. Calls Claude claude-opus-4-6 with vision to extract structured receipt data
 *    (works for Hebrew and English receipts)
 * 4. Updates the receipt row with extracted fields + status
 *
 * Triggered automatically by createReceipt via ctx.scheduler.runAfter(0, ...).
 * Also callable via retryOcr mutation.
 *
 * Required environment variable (set in Convex dashboard):
 *   ANTHROPIC_API_KEY = "sk-ant-..."
 */

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";

// =============================================================================
// STRUCTURED EXTRACTION PROMPT
// =============================================================================

const RECEIPT_EXTRACTION_PROMPT = `You are an expert receipt OCR assistant. Analyze this receipt image and extract the following fields.

The receipt may be in Hebrew (RTL), English, or a mix of both. Handle both languages accurately.

Return ONLY a valid JSON object with exactly these fields (use null for any field you cannot determine):

{
  "supplierName": string | null,       // Business/store name
  "totalAmount": number | null,        // Final total amount (after tax)
  "vatAmount": number | null,          // VAT/tax amount
  "vatPercent": number | null,         // VAT percentage (e.g. 17 for 17%)
  "receiptDate": string | null,        // Date in YYYY-MM-DD format
  "currency": string | null,           // ISO currency code: "ILS", "USD", "EUR", etc.
  "language": string | null,           // Primary language: "he", "en", "ar", or "mixed"
  "rawText": string | null             // All text visible on the receipt (for debugging)
}

Rules:
- For Israeli receipts: currency is typically "ILS", VAT is typically 17%
- For totalAmount: use the final grand total (after VAT), not subtotal
- For vatAmount: if VAT is listed separately, use that; otherwise calculate from total and percent
- For receiptDate: parse any date format into YYYY-MM-DD
- Return ONLY the JSON object, no explanation, no markdown, no code blocks`;

// =============================================================================
// OCR RESULT TYPE
// =============================================================================

type OcrResult = {
  supplierName: string | null;
  totalAmount: number | null;
  vatAmount: number | null;
  vatPercent: number | null;
  receiptDate: string | null;
  currency: string | null;
  language: string | null;
  rawText: string | null;
};

// =============================================================================
// INTERNAL OCR ACTION
// =============================================================================

/**
 * Internal action: called by scheduler after receipt upload.
 * Runs OCR on the image and updates the receipt record.
 */
export const processReceipt = internalAction({
  args: {
    receiptId: v.id("receipts"),
  },
  handler: async (ctx, args) => {
    // Mark as processing immediately
    await ctx.runMutation(internal.receipts.updateReceiptOcrResult, {
      receiptId: args.receiptId,
      status: "processing",
    });

    try {
      // 1. Fetch the receipt record to get imageStorageId
      const receipt = await ctx.runQuery(internal.receiptOcr.getReceiptById, {
        receiptId: args.receiptId,
      });

      if (!receipt) {
        throw new Error("Receipt not found.");
      }

      // 2. Fetch image bytes from Convex storage
      const imageBlob = await ctx.storage.get(receipt.imageStorageId as any);
      if (!imageBlob) {
        throw new Error("Image not found in storage.");
      }

      // 3. Convert blob to base64
      const imageBuffer = await imageBlob.arrayBuffer();
      const base64Image = Buffer.from(imageBuffer).toString("base64");

      // Detect media type from the blob
      const mediaType = (imageBlob.type as Anthropic.Base64ImageSource["media_type"]) || "image/jpeg";

      // 4. Call Claude claude-opus-4-6 vision API
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });

      const response = await anthropic.messages.create({
        model: "claude-opus-4-6",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: base64Image,
                },
              },
              {
                type: "text",
                text: RECEIPT_EXTRACTION_PROMPT,
              },
            ],
          },
        ],
      });

      // 5. Parse the JSON response
      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("No text response from OCR model.");
      }

      const rawResponse = textBlock.text.trim();
      let parsed: OcrResult;

      try {
        // Strip markdown code blocks if model wrapped the JSON
        const jsonStr = rawResponse
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/\s*```$/i, "")
          .trim();
        parsed = JSON.parse(jsonStr);
      } catch {
        throw new Error(`Failed to parse OCR JSON: ${rawResponse.slice(0, 200)}`);
      }

      // 6. Update receipt with extracted fields
      await ctx.runMutation(internal.receipts.updateReceiptOcrResult, {
        receiptId: args.receiptId,
        status: "done",
        supplierName: parsed.supplierName ?? undefined,
        totalAmount: parsed.totalAmount ?? undefined,
        vatAmount: parsed.vatAmount ?? undefined,
        vatPercent: parsed.vatPercent ?? undefined,
        receiptDate: parsed.receiptDate ?? undefined,
        currency: parsed.currency ?? undefined,
        language: parsed.language ?? undefined,
        rawOcrText: parsed.rawText ?? undefined,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown OCR error";

      await ctx.runMutation(internal.receipts.updateReceiptOcrResult, {
        receiptId: args.receiptId,
        status: "failed",
        ocrError: errorMessage,
      });
    }
  },
});

// =============================================================================
// INTERNAL QUERY — fetch receipt without tenant guard (for action context)
// =============================================================================

import { internalQuery } from "./_generated/server";

export const getReceiptById = internalQuery({
  args: { receiptId: v.id("receipts") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.receiptId);
  },
});
