import { spawn } from "node:child_process";
import { access, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

const OWNER_ID = "places-visual-owner";
const DATABASE_NAME = "places_visual";
const POSTGRES_PASSWORD = "local-visual-harness";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const APP_PORT = parsePort(process.argv.slice(2));
const CONTAINER_NAME = `insta-places-visual-${process.pid}-${Date.now().toString(36)}`;
const NEXT_ENV_PATH = path.join(REPO_ROOT, "next-env.d.ts");
const TSCONFIG_PATH = path.join(REPO_ROOT, "tsconfig.json");
const NEXT_DEV_PATH = path.join(REPO_ROOT, ".next", "dev");

let postgresStarted = false;
let nextProcess = null;
let tileServer = null;
let nextDevSnapshot = null;
let shutdownRequested = false;
let resolveShutdown = () => undefined;
const shutdownSignal = new Promise((resolve) => {
  resolveShutdown = resolve;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    shutdownRequested = true;
    resolveShutdown();
  });
}

function parsePort(args) {
  const portFlagIndex = args.indexOf("--port");
  const rawPort = portFlagIndex === -1 ? "3001" : args[portFlagIndex + 1];
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be an integer between 1 and 65535");
  return port;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function throwIfShuttingDown() {
  if (shutdownRequested) throw new Error("Visual globe harness stopped.");
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function snapshotNextDevArtifacts() {
  const [nextEnv, tsconfig, devExisted] = await Promise.all([
    readFile(NEXT_ENV_PATH, "utf8"),
    readFile(TSCONFIG_PATH, "utf8"),
    exists(NEXT_DEV_PATH),
  ]);
  nextDevSnapshot = { nextEnv, tsconfig, devExisted };
}

function normalizeGeneratedNextEnv(value) {
  return value.replace("./.next/dev/types/routes.d.ts", "./.next/types/routes.d.ts");
}

function normalizeGeneratedTsconfig(value) {
  return value.replace(/,\n\s*"\.next\/dev\/dev\/types\/\*\*\/\*\.ts"/, "");
}

async function restoreGeneratedFile(filePath, original, normalize) {
  const current = await readFile(filePath, "utf8");
  if (current === original) return;
  if (normalize(current) !== original) {
    console.warn(`Not restoring ${path.basename(filePath)} because it changed outside the harness.`);
    return;
  }
  const temporary = `${filePath}.places-visual-${process.pid}`;
  await writeFile(temporary, original);
  await rename(temporary, filePath);
}

async function restoreNextDevArtifacts() {
  if (!nextDevSnapshot) return;
  await restoreGeneratedFile(NEXT_ENV_PATH, nextDevSnapshot.nextEnv, normalizeGeneratedNextEnv);
  await restoreGeneratedFile(TSCONFIG_PATH, nextDevSnapshot.tsconfig, normalizeGeneratedTsconfig);
  if (!nextDevSnapshot.devExisted) await rm(NEXT_DEV_PATH, { force: true, recursive: true });
  nextDevSnapshot = null;
}

async function assertLocalDocker() {
  const hostOverride = process.env.DOCKER_HOST?.trim();
  if (hostOverride && !hostOverride.startsWith("unix://")) {
    throw new Error("The visual harness requires a local unix Docker socket.");
  }
  const { stdout } = await run(
    "docker",
    ["context", "inspect", "--format", '{{(index .Endpoints "docker").Host}}'],
    { quiet: true },
  );
  const endpoint = hostOverride || stdout.trim();
  if (!endpoint.startsWith("unix://")) throw new Error("The visual harness refuses a non-local Docker context.");
}

async function assertAppPortAvailable() {
  const server = createTcpServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(APP_PORT, "127.0.0.1", resolve);
  });
  // ponytail: close-and-rebind is sufficient for one local harness; reserve only if concurrent launches matter.
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function run(command, args, { env = process.env, quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: REPO_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (!quiet) process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (!quiet) process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

function assertHarnessDatabase(databaseUrl) {
  const parsed = new URL(databaseUrl);
  if (
    parsed.protocol !== "postgresql:" ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.pathname !== `/${DATABASE_NAME}` ||
    !parsed.port
  ) {
    throw new Error("The visual harness refuses any database except its loopback-only disposable database.");
  }
}

async function startPostgres() {
  throwIfShuttingDown();
  await run(
    "docker",
    [
      "run",
      "--detach",
      "--rm",
      "--name",
      CONTAINER_NAME,
      "--env",
      `POSTGRES_DB=${DATABASE_NAME}`,
      "--env",
      `POSTGRES_PASSWORD=${POSTGRES_PASSWORD}`,
      "--publish",
      "127.0.0.1::5432",
      "postgres:16-alpine",
    ],
    { quiet: true },
  );
  postgresStarted = true;
  throwIfShuttingDown();

  for (let attempt = 0; attempt < 90; attempt += 1) {
    throwIfShuttingDown();
    try {
      await run("docker", ["exec", CONTAINER_NAME, "pg_isready", "-U", "postgres", "-d", DATABASE_NAME], { quiet: true });
      break;
    } catch {
      if (attempt === 89) throw new Error("Timed out waiting for the disposable PostgreSQL container.");
      await sleep(500);
    }
  }

  const { stdout } = await run("docker", ["port", CONTAINER_NAME, "5432/tcp"], { quiet: true });
  throwIfShuttingDown();
  const endpoint = stdout.trim().split(/\s+/)[0];
  if (!endpoint?.startsWith("127.0.0.1:")) throw new Error("Docker did not expose PostgreSQL on loopback.");
  const port = endpoint.slice("127.0.0.1:".length);
  const databaseUrl = new URL(`postgresql://postgres@127.0.0.1:${port}/${DATABASE_NAME}`);
  databaseUrl.password = POSTGRES_PASSWORD;
  assertHarnessDatabase(databaseUrl.toString());
  return databaseUrl.toString();
}

function buildFixtures() {
  const places = [
    {
      id: "places-visual-paris",
      displayName: "Café du Globe Paris",
      city: "Paris",
      country: "France",
      countryCode: "FR",
      continentCode: "EU",
      latitude: 48.8566,
      longitude: 2.3522,
      category: "catering.cafe",
      theme: "Restaurant",
    },
    {
      id: "places-visual-santorini",
      displayName: "Terrasse Santorin",
      city: "Fira",
      country: "Grèce",
      countryCode: "GR",
      continentCode: "EU",
      latitude: 36.3932,
      longitude: 25.4615,
      category: "catering.restaurant",
      theme: "Voyages",
    },
    {
      id: "places-visual-rome",
      displayName: "Atelier Rome",
      city: "Rome",
      country: "Italie",
      countryCode: "IT",
      continentCode: "EU",
      latitude: 41.9028,
      longitude: 12.4964,
      category: "catering.restaurant.italian",
      theme: "Restaurant",
    },
    {
      id: "places-visual-nyc",
      displayName: "Brooklyn Roastery",
      city: "New York",
      country: "États-Unis",
      countryCode: "US",
      continentCode: "NA",
      latitude: 40.7128,
      longitude: -74.006,
      category: "catering.cafe",
      theme: "Voyages",
    },
    {
      id: "places-visual-rio",
      displayName: "Mirador Rio",
      city: "Rio de Janeiro",
      country: "Brésil",
      countryCode: "BR",
      continentCode: "SA",
      latitude: -22.9068,
      longitude: -43.1729,
      category: "entertainment.culture",
      theme: "Voyages",
    },
    {
      id: "places-visual-cape-town",
      displayName: "Table Bay Kitchen",
      city: "Le Cap",
      country: "Afrique du Sud",
      countryCode: "ZA",
      continentCode: "AF",
      latitude: -33.9249,
      longitude: 18.4241,
      category: "catering.restaurant",
      theme: "Restaurant",
    },
    {
      id: "places-visual-sydney",
      displayName: "Harbour Table Sydney",
      city: "Sydney",
      country: "Australie",
      countryCode: "AU",
      continentCode: "OC",
      latitude: -33.8688,
      longitude: 151.2093,
      category: "catering.restaurant",
      theme: "Voyages",
    },
  ];

  for (let index = 0; index < 25; index += 1) {
    places.push({
      id: `places-visual-cluster-${String(index + 1).padStart(3, "0")}`,
      displayName: `Tokyo cluster ${String(index + 1).padStart(3, "0")}`,
      city: "Tokyo",
      country: "Japon",
      countryCode: "JP",
      continentCode: "AS",
      latitude: 35.6762 + (Math.floor(index / 5) - 2) * 0.0025,
      longitude: 139.6503 + ((index % 5) - 2) * 0.0025,
      category: index % 2 === 0 ? "catering.restaurant" : "catering.cafe",
      theme: index % 3 === 0 ? "Restaurant" : "Voyages",
    });
  }

  const regions = [
    { city: "Mexico", country: "Mexique", countryCode: "MX", continentCode: "NA", latitude: 19.4326, longitude: -99.1332 },
    { city: "Reykjavík", country: "Islande", countryCode: "IS", continentCode: "EU", latitude: 64.1466, longitude: -21.9426 },
    { city: "Marrakech", country: "Maroc", countryCode: "MA", continentCode: "AF", latitude: 31.6295, longitude: -7.9811 },
    { city: "Buenos Aires", country: "Argentine", countryCode: "AR", continentCode: "SA", latitude: -34.6037, longitude: -58.3816 },
    { city: "Séoul", country: "Corée du Sud", countryCode: "KR", continentCode: "AS", latitude: 37.5665, longitude: 126.978 },
    { city: "Auckland", country: "Nouvelle-Zélande", countryCode: "NZ", continentCode: "OC", latitude: -36.8485, longitude: 174.7633 },
  ];

  while (places.length < 182) {
    const index = places.length;
    const region = regions[index % regions.length];
    const row = Math.floor(index / regions.length);
    places.push({
      id: `places-visual-${String(index + 1).padStart(3, "0")}`,
      displayName: `${region.city} carnet ${String(index + 1).padStart(3, "0")}`,
      city: region.city,
      country: region.country,
      countryCode: region.countryCode,
      continentCode: region.continentCode,
      latitude: region.latitude + ((row % 5) - 2) * 0.22,
      longitude: region.longitude + ((row % 7) - 3) * 0.25,
      category: index % 3 === 0 ? "catering.cafe" : "catering.restaurant",
      theme: index % 2 === 0 ? "Voyages" : "Restaurant",
    });
  }

  if (places.length !== 182) throw new Error("The visual harness fixture count must stay exactly 182.");
  return places;
}

function normalizedName(value) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

async function seed(databaseUrl) {
  assertHarnessDatabase(databaseUrl);
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const fixtures = buildFixtures();
  try {
    await prisma.postPlace.deleteMany({ where: { ownerId: OWNER_ID } });
    await prisma.place.deleteMany({ where: { ownerId: OWNER_ID } });
    await prisma.post.deleteMany({ where: { ownerId: OWNER_ID } });

    for (const [index, fixture] of fixtures.entries()) {
      const place = await prisma.place.create({
        data: {
          id: fixture.id,
          ownerId: OWNER_ID,
          displayName: fixture.displayName,
          normalizedName: normalizedName(fixture.displayName),
          category: fixture.category,
          provider: "visual-harness",
          providerPlaceId: fixture.id,
          city: fixture.city,
          country: fixture.country,
          countryCode: fixture.countryCode,
          continentCode: fixture.continentCode,
          latitude: fixture.latitude,
          longitude: fixture.longitude,
          precision: index % 5 === 0 ? "PROBABLE" : "EXACT",
          confidence: 0.91,
          reviewStatus: index % 7 === 0 ? "UNREVIEWED" : "CONFIRMED",
          isUserConfirmed: index % 11 === 0,
        },
      });
      const post = await prisma.post.create({
        data: {
          ownerId: OWNER_ID,
          postUrl: `https://visual-harness.invalid/posts/${fixture.id}`,
          thumbnailUrl: "/places/earth-dark.png",
          authorUsername: "visual_harness",
          authorSortKey: "visual_harness",
          caption: `${fixture.displayName} — fixture locale pour le globe`,
          contentType: "IMAGE",
          mainTheme: fixture.theme,
          searchText: `${normalizedName(fixture.displayName)} ${normalizedName(fixture.city)}`,
        },
      });
      await prisma.postPlace.create({
        data: {
          ownerId: OWNER_ID,
          postId: post.id,
          placeId: place.id,
          isPrimary: true,
          precision: place.precision,
          confidence: place.confidence,
          isUserConfirmed: place.isUserConfirmed,
        },
      });
    }
    console.log(`Seeded ${fixtures.length} synthetic Places for ${OWNER_ID}.`);
  } finally {
    await prisma.$disconnect();
  }
}

function localMapStyle(origin) {
  return {
    version: 8,
    projection: { type: "globe" },
    sources: {
      "harness-earth": {
        type: "image",
        url: `${origin}/earth-dark.png`,
        coordinates: [
          [-180, 85.051129],
          [180, 85.051129],
          [180, -85.051129],
          [-180, -85.051129],
        ],
      },
      "harness-tile": {
        type: "raster",
        tiles: [`${origin}/tiles/{z}/{x}/{y}.png`],
        tileSize: 256,
        maxzoom: 0,
      },
    },
    layers: [
      { id: "harness-earth", type: "raster", source: "harness-earth" },
      { id: "harness-tile", type: "raster", source: "harness-tile", paint: { "raster-opacity": 0.01 } },
    ],
  };
}

async function startTileServer() {
  const texture = await readFile(path.join(REPO_ROOT, "public", "places", "earth-dark.png"));
  let origin = "";
  const headers = (contentType) => ({
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    "content-type": contentType,
  });
  tileServer = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname === "/healthz") {
      response.writeHead(200, headers("application/json"));
      response.end('{"status":"ok"}');
      return;
    }
    if (requestUrl.pathname === "/style.json") {
      response.writeHead(200, headers("application/json"));
      response.end(JSON.stringify(localMapStyle(origin)));
      return;
    }
    if (requestUrl.pathname === "/earth-dark.png") {
      response.writeHead(200, headers("image/png"));
      response.end(texture);
      return;
    }
    const tile = /^\/tiles\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(requestUrl.pathname);
    if (tile?.[1] === "0" && tile[2] === "0" && tile[3] === "0") {
      response.writeHead(200, headers("image/png"));
      response.end(texture);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve, reject) => {
    tileServer.once("error", reject);
    tileServer.listen(0, "127.0.0.1", resolve);
  });
  const address = tileServer.address();
  if (!address || typeof address === "string") throw new Error("The local tile server did not expose a TCP port.");
  origin = `http://127.0.0.1:${address.port}`;
  return origin;
}

function harnessEnvironment(databaseUrl, tileServerUrl) {
  assertHarnessDatabase(databaseUrl);
  return {
    ...process.env,
    APP_OWNER_ID: OWNER_ID,
    AUTH_DISABLED: "true",
    DATABASE_URL: databaseUrl,
    NEXT_PUBLIC_PLACES_BENCHMARK: "1",
    NEXT_PUBLIC_PLACES_STYLE_URL: `${tileServerUrl}/style.json`,
    NEXT_PUBLIC_PLACES_TILE_ATTRIBUTION: "Tuiles locales de démonstration",
    NEXT_PUBLIC_PLACES_TILE_URL: "",
    NEXT_TELEMETRY_DISABLED: "1",
    VERCEL_ENV: "development",
  };
}

async function waitForApp(url) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The Next dev server is still compiling.
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

function startNext(environment) {
  nextProcess = spawn(process.execPath, [path.join(REPO_ROOT, "node_modules", "next", "dist", "bin", "next"), "dev", "--port", String(APP_PORT)], {
    cwd: REPO_ROOT,
    detached: true,
    env: environment,
    stdio: "inherit",
  });
  nextProcess.once("error", (error) => {
    console.error(error);
  });
}

function signalChildGroup(child, signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  signalChildGroup(child, "SIGTERM");
  const exitedAfterTerm = await Promise.race([exited.then(() => true), sleep(5_000).then(() => false)]);
  if (!exitedAfterTerm) {
    signalChildGroup(child, "SIGKILL");
    await exited;
  }
}

async function cleanup() {
  try {
    await stopChild(nextProcess);
  } finally {
    try {
      if (tileServer) {
        await new Promise((resolve) => tileServer.close(resolve));
        tileServer = null;
      }
    } finally {
      try {
        if (postgresStarted) {
          await run("docker", ["rm", "--force", CONTAINER_NAME], { quiet: true }).catch(() => undefined);
          postgresStarted = false;
        }
      } finally {
        await restoreNextDevArtifacts().catch((error) => console.error(error));
      }
    }
  }
}

async function main() {
  await snapshotNextDevArtifacts();
  throwIfShuttingDown();
  await assertLocalDocker();
  await assertAppPortAvailable();
  throwIfShuttingDown();
  const databaseUrl = await startPostgres();
  throwIfShuttingDown();
  const environment = harnessEnvironment(databaseUrl, await startTileServer());
  throwIfShuttingDown();
  await run("npm", ["exec", "--", "prisma", "migrate", "deploy"], { env: environment });
  throwIfShuttingDown();
  await seed(databaseUrl);
  throwIfShuttingDown();
  startNext(environment);
  await waitForApp(`http://127.0.0.1:${APP_PORT}/places`);
  throwIfShuttingDown();
  console.log(`Places visual globe is ready at http://127.0.0.1:${APP_PORT}/places`);
  console.log(`PostgreSQL is disposable and scoped to ${OWNER_ID}; stop with Ctrl+C.`);

  await Promise.race([shutdownSignal, new Promise((resolve) => nextProcess.once("exit", resolve))]);
}

main()
  .catch((error) => {
    if (!shutdownRequested) {
      console.error(error);
      process.exitCode = 1;
    }
  })
  .finally(cleanup);
