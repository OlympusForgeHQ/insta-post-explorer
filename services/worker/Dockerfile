FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY services/worker/package.json services/worker/package.json
RUN npm ci
COPY services/worker services/worker
RUN npm run worker:build

FROM node:24-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY services/worker/package.json services/worker/package.json
RUN npm ci --omit=dev --workspace services/worker --include-workspace-root=false

FROM node:24-bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 worker \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin worker
WORKDIR /app
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV SYNC_PROFILE_DIR=/var/lib/insta-sync/profile
ENV SYNC_EXTENSION_DIR=/app/extension/ig-saved-sync
COPY --from=production-dependencies --chown=10001:10001 /app/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /app/services/worker/dist ./services/worker/dist
COPY --chown=10001:10001 services/worker/package.json ./services/worker/package.json
COPY --chown=10001:10001 extension/ig-saved-sync ./extension/ig-saved-sync
RUN node node_modules/playwright/cli.js install --with-deps chromium \
    && mkdir -p /var/lib/insta-sync \
    && chown 10001:10001 /var/lib/insta-sync \
    && chmod 0700 /var/lib/insta-sync
USER 10001:10001
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD ["node", "-e", "const p=process.env.WORKER_HEALTH_PORT||\"8080\";fetch('http://127.0.0.1:'+p+'/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "services/worker/dist/index.js"]

---TEST---
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

