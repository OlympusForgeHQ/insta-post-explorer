import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const workerRoot = path.resolve(import.meta.dirname, "..");

describe("worker container contract", () => {
  it("uses a multi-stage Node 24 image with a numeric non-root healthchecked runtime", async () => {
    const dockerfile = await readFile(path.join(workerRoot, "Dockerfile"), "utf8");

    expect(dockerfile).toMatch(/^ARG NODE_IMAGE=public\.ecr\.aws\/docker\/library\/node:24-bookworm-slim$/m);
    expect(dockerfile.match(/^FROM \$\{NODE_IMAGE\} AS \S+$/gm)).toEqual([
      "FROM ${NODE_IMAGE} AS build",
      "FROM ${NODE_IMAGE} AS production-dependencies",
      "FROM ${NODE_IMAGE} AS runtime",
    ]);
    expect(dockerfile).toMatch(/^USER 10001:10001$/m);
    expect(dockerfile).toMatch(/^HEALTHCHECK /m);
    expect(dockerfile).toMatch(/^ENTRYPOINT \["\/usr\/bin\/tini", "--"\]$/m);
    expect(dockerfile).toMatch(/process\.env\.WORKER_HEALTH_PORT\|\|\\"8080\\"/);
    expect(dockerfile).not.toMatch(/^EXPOSE /m);
    expect(dockerfile).not.toMatch(/R2_(?:ACCESS|SECRET).*=/);
  });

  it.each([
    { name: "preserves the image outside GitHub Actions", ci: "false", failMirror: false, failHub: false, failBuild: false, exit: 0, pulls: [], image: "public.ecr.aws/docker/library/node:24-bookworm-slim" },
    { name: "uses the cached official image in CI", ci: "true", failMirror: false, failHub: false, failBuild: false, exit: 0, pulls: ["mirror.gcr.io/library/node:24-bookworm-slim"], image: "mirror.gcr.io/library/node:24-bookworm-slim" },
    { name: "falls back to Docker Hub only after a failed mirror pull", ci: "true", failMirror: true, failHub: false, failBuild: false, exit: 0, pulls: ["mirror.gcr.io/library/node:24-bookworm-slim", "docker.io/library/node:24-bookworm-slim"], image: "docker.io/library/node:24-bookworm-slim" },
    { name: "stops when both image pulls fail", ci: "true", failMirror: true, failHub: true, failBuild: false, exit: 31, pulls: ["mirror.gcr.io/library/node:24-bookworm-slim", "docker.io/library/node:24-bookworm-slim"], image: null },
    { name: "propagates a build failure without another pull or build", ci: "true", failMirror: false, failHub: false, failBuild: true, exit: 47, pulls: ["mirror.gcr.io/library/node:24-bookworm-slim"], image: "mirror.gcr.io/library/node:24-bookworm-slim" },
  ])("$name", async ({ ci, failMirror, failHub, failBuild, exit, pulls, image }) => {
    const directory = await mkdtemp(path.join(tmpdir(), "worker-container-ci-"));
    const commandLog = path.join(directory, "commands.log");
    try {
      await writeFile(commandLog, "");
      await writeFile(path.join(directory, "git"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
      await writeFile(path.join(directory, "npm"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
      await writeFile(path.join(directory, "docker"), `#!/bin/sh
printf '%s\\n' "$*" >> "$CI_COMMAND_LOG"
if [ "$1" = pull ]; then
  case "$2" in
    mirror.gcr.io/*) [ "$CI_FAIL_MIRROR" != true ] || exit 31 ;;
    docker.io/*) [ "$CI_FAIL_HUB" != true ] || exit 31 ;;
  esac
fi
if [ "$1" = build ] && [ "$CI_FAIL_BUILD" = true ]; then exit 47; fi
`, { mode: 0o700 });
      const result = spawnSync("bash", [path.resolve(workerRoot, "../../scripts/ci/check.sh")], {
        encoding: "utf8",
        timeout: 10_000,
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          GITHUB_ACTIONS: ci,
          CI_COMMAND_LOG: commandLog,
          CI_FAIL_MIRROR: String(failMirror),
          CI_FAIL_HUB: String(failHub),
          CI_FAIL_BUILD: String(failBuild),
        },
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(exit);
      const commands = (await readFile(commandLog, "utf8")).trim().split("\n").filter(Boolean);
      expect(commands).toEqual([
        ...pulls.map((pull) => `pull ${pull}`),
        ...(image ? [`build --build-arg NODE_IMAGE=${image} -f services/worker/Dockerfile -t insta-post-explorer-worker:ci .`] : []),
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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

