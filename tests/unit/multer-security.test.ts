// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import express from "../../backend/node_modules/express/index.js";
import multer from "../../backend/node_modules/multer/index.js";

describe("Multer 2.3.0 Security & Regression Suite", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 1024, fieldNameSize: 500 },
    });

    app.post("/upload-test", (req, res) => {
      upload.single("file")(req, res, (err) => {
        if (err) {
          if (err instanceof multer.MulterError) {
            return res.status(400).json({ error: err.code, message: err.message });
          }
          return res.status(500).json({ error: "UNKNOWN_ERROR", message: err.message });
        }
        res.status(200).json({
          received: true,
          fileName: req.file?.originalname,
          size: req.file?.size,
          bodyKeys: Object.keys(req.body || {}),
        });
      });
    });

    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const addr = server.address() as any;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("MULTER-01: successfully processes valid file upload into memoryStorage", async () => {
    const boundary = "---------------------------974767299852498929531610575";
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="sample.txt"',
      "Content-Type: text/plain",
      "",
      "Hello Operix Multer 2.3.0",
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const res = await fetch(`${baseUrl}/upload-test`, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
    expect(json.fileName).toBe("sample.txt");
    expect(json.size).toBe(25);
  });

  it("MULTER-02: enforces fileSize limit without crashing the process", async () => {
    const boundary = "---------------------------974767299852498929531610576";
    // Exceeds the 1024 bytes limit
    const oversizedContent = "A".repeat(2048);
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="oversized.txt"',
      "Content-Type: text/plain",
      "",
      oversizedContent,
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const res = await fetch(`${baseUrl}/upload-test`, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("LIMIT_FILE_SIZE");
  });

  it("MULTER-03: safely handles crafted multipart field names (CVE-2026-77078 / GHSA-wc9g-mqfw-jrwm)", async () => {
    const boundary = "---------------------------974767299852498929531610577";
    // Craft oversized array index and prototype keys
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="__proto__[polluted]"',
      "",
      "malicious_value",
      `--${boundary}`,
      'Content-Disposition: form-data; name="items[999999999]"',
      "",
      "sparse_array_dos_attempt",
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="test.txt"',
      "Content-Type: text/plain",
      "",
      "Safe content",
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const res = await fetch(`${baseUrl}/upload-test`, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    // Node process must not crash, request completes safely
    expect([200, 400]).toContain(res.status);

    // Verify Object prototype was not polluted
    expect((Object.prototype as any).polluted).toBeUndefined();
  });
});
