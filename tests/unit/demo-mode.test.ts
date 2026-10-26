import { describe, expect, it } from "vitest";
import { isLocalUrl } from "@/shared/env";

describe("DEMO_MODE solo con URLs locales", () => {
  it("acepta localhost e IPs de red privada", () => {
    for (const u of [
      "http://localhost:8080",
      "http://127.0.0.1:3000",
      "http://192.168.1.20:8080",
      "http://10.0.0.5",
      "http://172.20.1.1:8080",
      "http://barberia.local",
    ]) {
      expect(isLocalUrl(u), u).toBe(true);
    }
  });

  it("rechaza dominios públicos e IPs públicas", () => {
    for (const u of [
      "https://facha-style.vercel.app",
      "https://fachastyle.cl",
      "http://8.8.8.8",
      "http://172.32.0.1",
      "http://localhost.evil.com",
      "no-es-url",
    ]) {
      expect(isLocalUrl(u), u).toBe(false);
    }
  });
});
