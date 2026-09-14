import { Router, type Request, type Response } from "express";
import { fetchAICompletion, parseToolCall } from "../lib/ai.js";
import { requireAuth } from "../middleware/auth.js";

export const extractRouter = Router();

// S5A-008: Proteger todos os endpoints caros de extração/OCR de IA contra chamadas anônimas
extractRouter.use(requireAuth);

extractRouter.post("/production-order", async (req: Request, res: Response) => {
  try {
    const { imageBase64, mimeType, fileName } = req.body;
    if (!imageBase64) return res.status(400).json({ error: "No image data provided" });

    const aiRes = await fetchAICompletion({
      messages: [
        {
          role: "system",
          content: `You are a pragmatic data extraction assistant for QWork Nexus, an automotive production/order tracking system.
Your job: extract vehicle and claim metadata from a document (PDF, photo of paper order, screenshot).

RULES:
- Do not invent data. If uncertain, return null.
- Normalize license plate to uppercase (do not add separators).
- VIN: 17 characters alphanumeric when possible; if partial, return what you see.
- Return honest per-field confidence: high/medium/low.
- Output must be a SINGLE order object (not a list).`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract the following fields from the document "${fileName}": client, platform, license_plate, vin, brand, model, color, insurer, vehicle_notes. Return per-field confidence. Do not guess.`,
            },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          ],
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "extract_production_order",
            description: "Extract production order vehicle metadata with per-field confidence.",
            parameters: {
              type: "object",
              properties: {
                order: {
                  type: "object",
                  properties: {
                    client: { type: "string" },
                    platform: { type: "string" },
                    license_plate: { type: "string" },
                    vin: { type: "string" },
                    brand: { type: "string" },
                    model: { type: "string" },
                    color: { type: "string" },
                    insurer: { type: "string" },
                    vehicle_notes: { type: "string" },
                    field_confidence: {
                      type: "object",
                      properties: {
                        client: { type: "string", enum: ["high", "medium", "low"] },
                        platform: { type: "string", enum: ["high", "medium", "low"] },
                        license_plate: { type: "string", enum: ["high", "medium", "low"] },
                        vin: { type: "string", enum: ["high", "medium", "low"] },
                        brand: { type: "string", enum: ["high", "medium", "low"] },
                        model: { type: "string", enum: ["high", "medium", "low"] },
                        color: { type: "string", enum: ["high", "medium", "low"] },
                        insurer: { type: "string", enum: ["high", "medium", "low"] },
                        vehicle_notes: { type: "string", enum: ["high", "medium", "low"] },
                      },
                    },
                  },
                },
                confidence: { type: "string", enum: ["high", "medium", "low"] },
                notes: { type: "string" },
              },
              required: ["order", "confidence"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "extract_production_order" } },
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      if (aiRes.status === 429) return res.status(429).json({ error: "Rate limit exceeded. Try again shortly." });
      if (aiRes.status === 402) return res.status(402).json({ error: "AI credits exhausted." });
      return res.status(500).json({ error: `AI error: ${aiRes.status} — ${errText}` });
    }

    const data = await aiRes.json();
    const extracted = parseToolCall(data);
    return res.json(extracted);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[extract/production-order]", msg);
    return res.status(500).json({ error: msg });
  }
});

extractRouter.post("/service-order", async (req: Request, res: Response) => {
  try {
    const { imageBase64, mimeType, fileName } = req.body;
    if (!imageBase64) return res.status(400).json({ error: "No image data provided" });

    const aiRes = await fetchAICompletion({
      messages: [
        {
          role: "system",
          content: `You are a pragmatic data extraction assistant for QWork Nexus, an automotive service management system.
Your job: extract structured data from service order documents (PDFs, photos of paper forms, screenshots).

PRIORITIES (in order):
1. STRUCTURE FIRST: Identify rows and columns. Each row = one service order entry.
2. NUMBERS MATTER MOST: Get prices and totals right. Numbers are the hardest to correct manually.
3. TEXT IS SECONDARY: Client names, technician names, etc. can be corrected by the user.

CONFIDENCE SCORING — be honest:
- "high": clearly printed/typed, no ambiguity
- "medium": readable but could be misread
- "low": handwritten, blurry, or guessing. User MUST verify.

FIELD RULES:
- "client" = COMPANY or PERSON who OWNS the vehicle (e.g. Uber, Bolt, a fleet company)
- "technician" = PERSON who PERFORMS the work. These are NEVER the same.
- If unsure about a text field → return null. Never fabricate data.
- Prices must be numbers (no currency symbols). If you can't read a price → return null.
- Total should match sum of services.

A document may have MULTIPLE rows. Extract ALL of them.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract service order data from this document. File: "${fileName}". Focus on: how many distinct service entries/rows exist, and for each row extract: client, platform, technician, week, car_name, license_plate, up to 4 services (name + price), total. For every field, honestly assess confidence (high/medium/low).`,
            },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          ],
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "extract_service_orders",
            description: "Extract structured service order data with per-field confidence",
            parameters: {
              type: "object",
              properties: {
                orders: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      client: { type: "string" },
                      platform: { type: "string" },
                      technician: { type: "string" },
                      week: { type: "string" },
                      car_name: { type: "string" },
                      license_plate: { type: "string" },
                      service_1_name: { type: "string" },
                      service_1_price: { type: "number" },
                      service_2_name: { type: "string" },
                      service_2_price: { type: "number" },
                      service_3_name: { type: "string" },
                      service_3_price: { type: "number" },
                      service_4_name: { type: "string" },
                      service_4_price: { type: "number" },
                      total: { type: "number" },
                      field_confidence: {
                        type: "object",
                        properties: {
                          client: { type: "string", enum: ["high", "medium", "low"] },
                          platform: { type: "string", enum: ["high", "medium", "low"] },
                          technician: { type: "string", enum: ["high", "medium", "low"] },
                          week: { type: "string", enum: ["high", "medium", "low"] },
                          car_name: { type: "string", enum: ["high", "medium", "low"] },
                          license_plate: { type: "string", enum: ["high", "medium", "low"] },
                          service_1_price: { type: "string", enum: ["high", "medium", "low"] },
                          service_2_price: { type: "string", enum: ["high", "medium", "low"] },
                          service_3_price: { type: "string", enum: ["high", "medium", "low"] },
                          service_4_price: { type: "string", enum: ["high", "medium", "low"] },
                          total: { type: "string", enum: ["high", "medium", "low"] },
                        },
                      },
                      total_mismatch: { type: "boolean" },
                    },
                    required: ["client", "car_name"],
                  },
                },
                confidence: { type: "string", enum: ["high", "medium", "low"] },
                notes: { type: "string" },
              },
              required: ["orders", "confidence"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "extract_service_orders" } },
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      if (aiRes.status === 429) return res.status(429).json({ error: "Rate limit exceeded. Try again shortly." });
      if (aiRes.status === 402) return res.status(402).json({ error: "AI credits exhausted." });
      return res.status(500).json({ error: `AI error: ${aiRes.status} — ${errText}` });
    }

    const data = await aiRes.json();
    const extracted = parseToolCall(data) as any;

    // Post-processing: validate totals and flag sparse rows
    if (extracted?.orders) {
      for (const order of extracted.orders) {
        if (!order.field_confidence) order.field_confidence = {};
        const computed = [1, 2, 3, 4].reduce((s: number, i: number) => s + (order[`service_${i}_price`] || 0), 0);
        if (order.total != null && Math.abs(computed - order.total) > 0.01) {
          order.total_mismatch = true;
          order.field_confidence.total = "low";
        }
        const textFields = ["client", "platform", "technician", "week", "car_name", "license_plate"];
        const filled = textFields.filter(f => order[f]?.trim()).length;
        if (filled <= 2) {
          for (const f of textFields) {
            if (!order[f]?.trim() && !order.field_confidence[f]) order.field_confidence[f] = "low";
          }
        }
      }
    }

    return res.json(extracted);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[extract/service-order]", msg);
    return res.status(500).json({ error: msg });
  }
});

extractRouter.post("/payment-order", async (req: Request, res: Response) => {
  try {
    const { imageBase64, mimeType, fileName } = req.body;
    if (!imageBase64) return res.status(400).json({ error: "No image data provided" });

    const aiRes = await fetchAICompletion({
      messages: [
        {
          role: "system",
          content: `You are a pragmatic data extraction assistant for QWork Nexus, an automotive payment tracking system.
Your job: extract structured payment data from payment order lists (PDFs, photos, screenshots).

PRIORITIES:
1. STRUCTURE FIRST: Identify rows. Each row = one vehicle/service entry.
2. NUMBERS MATTER MOST: Get prices and totals right.
3. TEXT IS SECONDARY: Client/platform/technician names can be corrected by the user.

CONFIDENCE SCORING:
- "high": clearly printed/typed, no ambiguity
- "medium": readable but could be misread
- "low": handwritten, blurry, or uncertain

FIELD RULES:
- "client" = company or person who owns/manages the vehicles (e.g. Quality Work, PDR-Team)
- "platform" = service platform name if present
- "list_name" = list or batch identifier (e.g. list number, week reference)
- "technician" = person performing the work (if different from client)
- services = array of {name, price} pairs per vehicle
- total = grand total for this vehicle entry
- A document may have MULTIPLE rows. Extract ALL of them.
- If a price is "NaN" or unreadable, return null.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract payment order data from this document. File: "${fileName}". For each vehicle row, extract: client, platform, list_name, technician, car_name, license_plate, services (array of {name, price}), total. Also provide overall confidence and any notes.`,
            },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          ],
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "extract_payment_orders",
            description: "Extract structured payment order data with per-field confidence",
            parameters: {
              type: "object",
              properties: {
                orders: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      client: { type: "string" },
                      platform: { type: "string" },
                      list_name: { type: "string" },
                      technician: { type: "string" },
                      car_name: { type: "string" },
                      license_plate: { type: "string" },
                      services: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            name: { type: "string" },
                            price: { type: "number" },
                            confidence: { type: "string", enum: ["high", "medium", "low"] },
                          },
                          required: ["name"],
                        },
                      },
                      total: { type: "number" },
                      field_confidence: {
                        type: "object",
                        properties: {
                          client: { type: "string", enum: ["high", "medium", "low"] },
                          platform: { type: "string", enum: ["high", "medium", "low"] },
                          list_name: { type: "string", enum: ["high", "medium", "low"] },
                          technician: { type: "string", enum: ["high", "medium", "low"] },
                          car_name: { type: "string", enum: ["high", "medium", "low"] },
                          license_plate: { type: "string", enum: ["high", "medium", "low"] },
                          total: { type: "string", enum: ["high", "medium", "low"] },
                        },
                      },
                      total_mismatch: { type: "boolean" },
                    },
                    required: ["car_name"],
                  },
                },
                confidence: { type: "string", enum: ["high", "medium", "low"] },
                notes: { type: "string" },
              },
              required: ["orders", "confidence"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "extract_payment_orders" } },
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      if (aiRes.status === 429) return res.status(429).json({ error: "Rate limit exceeded. Try again shortly." });
      if (aiRes.status === 402) return res.status(402).json({ error: "AI credits exhausted." });
      return res.status(500).json({ error: `AI error: ${aiRes.status} — ${errText}` });
    }

    const data = await aiRes.json();
    const extracted = parseToolCall(data) as any;

    if (extracted?.orders) {
      for (const order of extracted.orders) {
        if (!order.field_confidence) order.field_confidence = {};
        if (order.services?.length > 0) {
          const computed = order.services.reduce((s: number, svc: any) => s + (svc.price ?? 0), 0);
          if (order.total != null && Math.abs(computed - order.total) > 0.01) {
            order.total_mismatch = true;
            order.field_confidence.total = "low";
          }
        }
      }
    }

    return res.json(extracted);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[extract/payment-order]", msg);
    return res.status(500).json({ error: msg });
  }
});

extractRouter.post("/invoice", async (req: Request, res: Response) => {
  try {
    const { fileBase64, mimeType, fileName, pages } = req.body;
    const pageImages: Array<{ base64: string; mimeType: string }> = Array.isArray(pages)
      ? pages.filter((p: any) => typeof p?.base64 === "string" && typeof p?.mimeType === "string").slice(0, 6)
      : [];
    if (!fileBase64 && pageImages.length === 0) {
      return res.status(400).json({ error: "No file data provided" });
    }
    if (!mimeType && pageImages.length === 0) {
      return res.status(400).json({ error: "Missing mimeType" });
    }

    const systemPrompt = `You are an expert invoice extraction assistant for European billing (PT, FR, EN, ES, IT, DE).
Extract STRUCTURED data from invoices/receipts (incoming, supplier-issued documents), including multi-page PDFs.

LANGUAGE-AWARE LABELS to detect:
- Invoice number: "Facture", "Fatura", "Invoice", "Factura", "Fattura", "Rechnung", "Nº", "N°", "No."
- Issue date: "Date", "Data", "Émission", "Emissão", "Issued"
- Due date: "Échéance", "Vencimento", "Due", "Vencimiento", "Scadenza", "Fällig"
- Supplier (issuer): top of document, with logo / SIRET / VAT / NIF
- Client (recipient): "Facturé à", "Faturado a", "Bill to", "Facturado a"
- Total: "Total TTC", "Total c/ IVA", "Total", "Importe total", "Totale", "Gesamtbetrag"
- Tax: "TVA", "IVA", "VAT", "MwSt"
- Currency: detect from symbol (€, $, £, R$) or ISO code

CONFIDENCE per field: "high" | "medium" | "low"
Return null when not present — never fabricate.
Merge data across all provided pages. Keep line items normalized and totals coherent.`;

    const userPrompt = `Extract invoice data from this document. Filename: "${fileName ?? "unknown"}".
Identify supplier (issuer) vs client (recipient) carefully.
Return amounts as plain numbers (no currency symbol). Dates as YYYY-MM-DD.
Return line_items with description, quantity, unit_price, tax_rate, tax_amount and total.
If the PDF has multiple pages, combine all pages before answering.`;

    const contentParts: Array<
      { type: "text"; text: string } |
      { type: "image_url"; image_url: { url: string } }
    > = [{ type: "text", text: userPrompt }];

    if (pageImages.length > 0) {
      for (const page of pageImages) {
        contentParts.push({
          type: "image_url",
          image_url: { url: `data:${page.mimeType};base64,${page.base64}` },
        });
      }
    } else {
      contentParts.push({
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${fileBase64}` },
      });
    }

    const aiRes = await fetchAICompletion({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: contentParts as any },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "extract_invoice",
            description: "Extract structured invoice data with per-field confidence",
            parameters: {
              type: "object",
              properties: {
                invoice_number:  { type: "string" },
                supplier_name:   { type: "string" },
                supplier_tax_id: { type: "string" },
                customer_name:   { type: "string" },
                customer_tax_id: { type: "string" },
                issue_date:      { type: "string", description: "YYYY-MM-DD" },
                due_date:        { type: "string", description: "YYYY-MM-DD" },
                total_amount:    { type: "number" },
                tax_amount:      { type: "number" },
                net_amount:      { type: "number" },
                page_count:      { type: "number" },
                currency:        { type: "string", description: "ISO code (EUR, USD, BRL, GBP)" },
                language:        { type: "string", enum: ["pt", "fr", "en", "es", "it", "de"] },
                notes:           { type: "string" },
                line_items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      description: { type: "string" },
                      quantity:    { type: "number" },
                      unit_price:  { type: "number" },
                      tax_rate:    { type: "number" },
                      tax_amount:  { type: "number" },
                      total:       { type: "number" },
                    },
                    required: ["description"],
                    additionalProperties: false,
                  },
                },
                tax_breakdown: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      label:        { type: "string" },
                      rate:         { type: "number" },
                      taxable_base: { type: "number" },
                      amount:       { type: "number" },
                    },
                    additionalProperties: false,
                  },
                },
                field_confidence: {
                  type: "object",
                  properties: {
                    invoice_number: { type: "string", enum: ["high", "medium", "low"] },
                    supplier_name:  { type: "string", enum: ["high", "medium", "low"] },
                    customer_name:  { type: "string", enum: ["high", "medium", "low"] },
                    issue_date:     { type: "string", enum: ["high", "medium", "low"] },
                    due_date:       { type: "string", enum: ["high", "medium", "low"] },
                    total_amount:   { type: "string", enum: ["high", "medium", "low"] },
                    tax_amount:     { type: "string", enum: ["high", "medium", "low"] },
                    net_amount:     { type: "string", enum: ["high", "medium", "low"] },
                  },
                },
                confidence: { type: "string", enum: ["high", "medium", "low"] },
              },
              required: ["confidence"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "extract_invoice" } },
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      if (aiRes.status === 429) return res.status(429).json({ error: "Rate limit exceeded. Try again shortly." });
      if (aiRes.status === 402) return res.status(402).json({ error: "AI credits exhausted." });
      return res.status(500).json({ error: `AI error: ${aiRes.status} — ${errText}` });
    }

    const data = await aiRes.json();
    const extracted = parseToolCall(data);
    return res.json(extracted);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[extract/invoice]", msg);
    return res.status(500).json({ error: msg });
  }
});

extractRouter.post("/receipt", async (req: Request, res: Response) => {
  try {
    const { fileBase64, mimeType, fileName } = req.body;
    if (!fileBase64) return res.status(400).json({ error: "No file data provided" });
    if (!mimeType) return res.status(400).json({ error: "Missing mimeType" });

    const aiRes = await fetchAICompletion({
      messages: [
        {
          role: "system",
          content: `You extract structured data from receipts, invoices, fuel tickets, toll receipts, restaurant tickets and any operational fiscal document (EU: PT, FR, EN, ES, IT, DE).
Detect amounts, dates, merchant/vendor, currency, document number.
Classify the most probable expense CATEGORY from this exact set:
- "fuel"     (combustível, posto, station, gasolina, diesel)
- "rent"     (aluguel, location, loyer, rental)
- "tax"      (governo, impôt, taxe, tax, IRS, URSSAF, IRPF)
- "material" (compras, achats, supplies, peças, parts)
- "salary"   (salário, retirada, withdrawal, prélèvement)
- "travel"   (viagem, péage, toll, hotel, parking, transporte)
- "other"    (anything else — restaurant, miscellaneous)
Return null when not present — never fabricate.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract structured data from this receipt/invoice. Filename: "${fileName ?? "unknown"}".
Return amount as a plain number. Dates as YYYY-MM-DD. Currency as ISO code.`,
            },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${fileBase64}` } },
          ],
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "extract_receipt",
            description: "Extract structured receipt data",
            parameters: {
              type: "object",
              properties: {
                merchant: { type: "string", description: "Vendor/merchant name" },
                document_number: { type: "string" },
                issue_date: { type: "string", description: "YYYY-MM-DD" },
                amount: { type: "number", description: "Total amount, plain number" },
                currency: { type: "string", description: "ISO code (EUR, USD, BRL, GBP)" },
                category: {
                  type: "string",
                  enum: ["fuel", "rent", "tax", "material", "salary", "travel", "other"],
                },
                description: { type: "string", description: "Short human description" },
                confidence: { type: "string", enum: ["high", "medium", "low"] },
              },
              required: ["confidence"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "extract_receipt" } },
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      if (aiRes.status === 429) return res.status(429).json({ error: "Rate limit exceeded. Try again shortly." });
      if (aiRes.status === 402) return res.status(402).json({ error: "AI credits exhausted." });
      return res.status(500).json({ error: `AI error: ${aiRes.status} — ${errText}` });
    }

    const data = await aiRes.json();
    const extracted = parseToolCall(data);
    return res.json(extracted);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[extract/receipt]", msg);
    return res.status(500).json({ error: msg });
  }
});
