import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const workerRoot = path.resolve(import.meta.dirname, "..");

describe("worker container contract", () => {
  it("uses a multi-stage Node 24 image with a numeric non-root healthchecked runtime", async () => {
    const dockerfile = await readFile(path.join(workerRoot, "Dockerfile"), "utf8");

    expect(dockerfile.match(/^FROM node:24[^\n]* AS /gm)?.length).toBeGreaterThanOrEqual(2);
    expect(dockerfile).toMatch(/^USER 10001:10001$/m);
    expect(dockerfile).toMatch(/^HEALTHCHECK /m);
    expect(dockerfile).toMatch(/^ENTRYPOINT ["\/usr\/bin\/tini", "--"]$/m);
    expect(dockerfile).toMatch(/^ENTRYPOINT \["\/usr\/bin\/tini", "--"\]$/m);
    expect(dockerfile).toMatch(/process\.env\.WORKER_HEALTH_PORT\|\|\\"8080\\"/);
    expect(dockerfile).not.toMatch(/^EXPOSE /m);
    expect(dockerfile).not.toMatch(/R2_(?:ACCESS|SECRET).*=/);
  });

  it("defines one private hardened service with worker-only R2 credential mapping", async () => {
    const compose = await readFile(path.join(workerRoot, "docker-compose.yml"), "utf8");

    expect(compose).toMatch(/^services:\s*\n  worker:/m);
    expect(compose.match(/^  [a-zA-Z0-9_-]+:\s*$/gm)).toEqual(["  worker:"]);
    expect(compose).not.toMatch(/^    ports:/m);
    expect(compose).toMatch(/cap_drop:\s*\n      - ALL/);
    expect(compose).toMatch(/no-new-privileges:true/);
    expect(compose).toMatch(/R2_ACCESS_KEY_ID:.*R2_WORKER_ACCESS_KEY_ID/);
    expect(compose).toMatch(/R2_SECRET_ACCESS_KEY:.*R2_WORKER_SECRET_ACCESS_KEY/);
    expect(compose).not.toMatch(/R2_ACCESS_KEY_ID:.*\$\{R2_ACCESS_KEY_ID/);
  });
});

