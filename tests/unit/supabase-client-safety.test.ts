// @vitest-environment jsdom
import { describe, it, expect } from "vitest";

describe("Supabase Client Safety Regression Test", () => {
  it("exports a non-throwing noop facade when VITE_SUPABASE_URL is missing", async () => {
    // Ensure env is empty
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    // Importing the client must not throw Error: supabaseUrl is required
    const module = await import("../../src/integrations/supabase/client");
    expect(module.supabase).toBeDefined();

    // Calling common methods must return thennable resolving { data: null, error: null }
    const selectRes = await module.supabase.from("any_table").select("*");
    expect(selectRes).toEqual({ data: null, error: null });

    const authRes = await module.supabase.auth.getSession();
    expect(authRes).toEqual({ data: { session: null }, error: null });
  });
});
