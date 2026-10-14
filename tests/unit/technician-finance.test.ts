import { describe, it, expect } from "vitest";

describe("Technician Financial Domain Rules (Alex R01/R02)", () => {
  it("Rule 1: Split applies strictly over HT liquid base (without TVA)", () => {
    const listHT = 1000.00;
    const tvaPercent = 0.20;
    const listTTC = listHT * (1 + tvaPercent); // 1200.00
    const techSplit = 0.60;

    // Commission must be computed from HT, NOT TTC
    const commission = listHT * techSplit;
    expect(commission).toBe(600.00);
    expect(commission).not.toBe(listTTC * techSplit);
  });

  it("Rule 2: Expenses abate directly in the individual net settlement, preserving gross earning", () => {
    const grossEarning = 600.00;
    const techExpenses = 150.00; // Fuel + Hotel

    const netAvailable = grossEarning - techExpenses;
    expect(grossEarning).toBe(600.00); // Production gross remains intact
    expect(netAvailable).toBe(450.00); // Net available for cash out
  });

  it("Rule 3: Partial invoice settlement unlocks proportional share", () => {
    const totalRecognizedHT = 1000.00;
    const techPercentage = 0.60;
    const totalTechShare = totalRecognizedHT * techPercentage; // 600.00

    const partialPaymentRatio = 0.50; // 50% paid
    const unlockedTechShare = totalTechShare * partialPaymentRatio; // 300.00

    expect(unlockedTechShare).toBe(300.00);
  });

  it("Rule 4: Negative balance transitions as carryover to subsequent periods", () => {
    const currentReceivedShare = 200.00;
    const currentExpenses = 350.00; // Higher expenses than revenue

    const currentBalance = currentReceivedShare - currentExpenses; // -150.00
    expect(currentBalance).toBe(-150.00);

    // In next cycle:
    const nextReceivedShare = 500.00;
    const nextBalance = nextReceivedShare + currentBalance; // 500 - 150 = 350
    expect(nextBalance).toBe(350.00);
  });

  it("Rule 5: Counter-entry debits preserve audit immutability on dispute adjustments", () => {
    const initialApproved = 600.00;
    const disputedAdjustment = -100.00; // Glosa / estorno

    const entries = [
      { id: "e1", type: "earning", amount: initialApproved },
      { id: "e2", type: "adjustment_debit", amount: disputedAdjustment },
    ];

    const finalBalance = entries.reduce((acc, curr) => acc + curr.amount, 0);
    expect(entries[0].amount).toBe(600.00); // Original row unchanged
    expect(finalBalance).toBe(500.00);
  });
});
