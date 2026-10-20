// @vitest-environment node

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

vi.mock("server-only", () => ({}));

import type { PlaceCandidate, PlaceCandidateRecord } from "@/lib/places/candidates";
import type { PlaceResolutionInput, PlaceResolver, ResolvedPlaceCandidate } from "@/server/places/resolvers/types";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim() ?? "";
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const OWNER_A = "owner-analysis-a";
const OWNER_B = "owner-analysis-b";

let prisma: PrismaClient;
let analysis: typeof import("@/server/places/analysis");
let batch: typeof import("@/server/places/caption-batch");
let jobs: typeof import("@/server/places/jobs");
const previousDatabaseUrl = process.env.DATABASE_URL;

// Build a candidate record carrying the current input_hash + analysis_version,
// exactly as the exporter would stamp them, so the freshness gate passes.
async function freshRecord(ownerId: string, postId: string, candidates: PlaceCandidate[]): Promise<PlaceCandidateRecord> {
  const [line] = await batch.exportCaptionBatch({ ownerId, postId, force: true });
  return { post_id: postId, input_hash: line.input_hash, analysis_version: line.analysis_version, candidates };
}

// In-memory resolver: no network, no real Geoapify. Returns a scripted list per
// candidate name, or throws to simulate a provider failure.
class FakeResolver implements PlaceResolver {
  constructor(
    private readonly byName: Record<string, ResolvedPlaceCandidate[]>,
    private readonly failure?: Error,
  ) {}
  async resolve(input: PlaceResolutionInput): Promise<ResolvedPlaceCandidate[]> {
    if (this.failure) throw this.failure;
    return this.byName[input.candidate.name ?? ""] ?? [];
  }
}

function resolved(overrides: Partial<ResolvedPlaceCandidate> = {}): ResolvedPlaceCandidate {
  return {
    provider: "geoapify",
    providerPlaceId: "geo-nobu",
    displayName: "Nobu Dubai",
    category: "catering.restaurant",
    address: "Atlantis, Dubai",
    city: "Dubai",
    region: null,
    country: "United Arab Emirates",
    countryCode: "AE",
    latitude: 25.13,
    longitude: 55.11,
    providerResultType: "amenity",
    providerRank: 0.95,
    providerMatchType: "full_match",
    attribution: "Powered by Geoapify",
    ...overrides,
  };
}

function candidate(overrides: Partial<PlaceCandidate> = {}): PlaceCandidate {
  return {
    name: "Nobu Dubai",
    address: null,
    city: "Dubai",
    region: null,
    country: "United Arab Emirates",
    category: "restaurant",
    confidence: 0.95,
    evidence: [{ type: "CAPTION", excerpt: "Dinner at Nobu Dubai" }],
    ...overrides,
  };
}

function anonymousBuilding(overrides: Partial<ResolvedPlaceCandidate> = {}): ResolvedPlaceCandidate {
  return resolved({providerName: null, providerResultType: "building", providerRank: 1,
    displayName: "10 Main Street, Dubai, United Arab Emirates", address: "10 Main Street, Dubai, United Arab Emirates",
    street: "Main Street", houseNumber: "10", providerPlaceId: "geo-anonymous-building", ...overrides});
}

function researchedBuilding(name: string): ResolvedPlaceCandidate {
  return anonymousBuilding({webResearch:{name,streetAddress:'10 Main Street',city:'Dubai',country:'United Arab Emirates',postalCode:null,
    sources:[{url:'https://bakery.example/locations',excerpt:`${name}, 10 Main Street, Dubai, United Arab Emirates`},
      {url:'https://city.example/bakeries',excerpt:`${name}, 10 Main Street, Dubai, United Arab Emirates`}],
    researchedAt:'2026-10-20T12:00:00.000Z'}});
}

function contextualArea(name: string, overrides: Partial<ResolvedPlaceCandidate> = {}): import('@/server/places/analysis').CandidatePlan {
  return {candidate: candidate({name}), best: {resolved: resolved({providerPlaceId: 'geo-dubai-area',
    displayName: 'Dubai', providerName: 'Dubai', providerResultType: 'city', address: null, ...overrides}),
    scored: {precision: 'APPROXIMATE', confidence: .6, approximationRadiusMeters: 10_000, reasons: ['contextual_venue_area'],
      contextualArea: {level: 'city', sourceName: name, missingDetails: ['business_address']}}}};
}

async function persistPlans(postId: string, plans: import('@/server/places/analysis').CandidatePlan[], preserveExisting = false) {
  const job = await jobs.createMetadataAnalysisJob({ownerId: OWNER_A, postId});
  return prisma.$transaction(tx => analysis.persistMetadataAnalysis(tx, {ownerId: OWNER_A, postId, jobId: job.id, plans, preserveExisting}));
}

async function businessRecord(postId: string, name: string | null, ownerId = OWNER_A, category: PlaceCandidate['category'] = "patisserie") {
  await seedPost(postId, ownerId, "Restaurant");
  const excerpt = name ? `Pastries at ${name}` : "Pastries at this address";
  await prisma.post.update({where: {id: postId}, data: {caption: excerpt}});
  return freshRecord(ownerId, postId, [candidate({name, address: "10 Main Street", category,
    evidence: [{type: "CAPTION", excerpt}]})]);
}

describeWithDatabase("Places metadata analysis persistence on PostgreSQL", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    ({ prisma } = await import("@/server/db"));
    analysis = await import("@/server/places/analysis");
    batch = await import("@/server/places/caption-batch");
    jobs = await import("@/server/places/jobs");
    await resetDatabase();
  });

  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousDatabaseUrl;
  });

  beforeEach(resetDatabase);
  it('reuses the same verified identity across providers and keeps rejected identities rejected',async()=>{
    await seedPost('provider-first',OWNER_A,'Restaurant');
    await seedPost('provider-second',OWNER_A,'Restaurant');
    await analysis.analyzeCandidateBatchRecord({ownerId:OWNER_A,record:await freshRecord(OWNER_A,'provider-first',[candidate()]),
      resolver:new FakeResolver({'Nobu Dubai':[resolved()]}),commit:true});
    const known=await prisma.place.findFirstOrThrow({where:{ownerId:OWNER_A}});
    await prisma.place.update({where:{id:known.id},data:{provider:'legacy-provider',isUserConfirmed:true,reviewStatus:'REJECTED',displayName:'Restaurant Nobu Dubai',normalizedName:'restaurant nobu dubai'}});
    await analysis.analyzeCandidateBatchRecord({ownerId:OWNER_A,record:await freshRecord(OWNER_A,'provider-second',[candidate()]),
      resolver:new FakeResolver({'Nobu Dubai':[resolved({providerPlaceId:'geo-nobu-new',providerResultType:'poi',address:'Atlantis Hotel, Dubai'})]}),commit:true});
    expect(await prisma.place.count({where:{ownerId:OWNER_A}})).toBe(1);
    expect(await prisma.postPlace.count({where:{postId:'provider-second'}})).toBe(0);
    expect((await prisma.place.findUniqueOrThrow({where:{id:known.id}})).reviewStatus).toBe('REJECTED');
  });

  it('never persists raw Google content or coordinates through a resolver override',async()=>{
    await seedPost('raw-google-blocked',OWNER_A,'Restaurant');
    const receipt=await analysis.analyzeCandidateBatchRecord({ownerId:OWNER_A,record:await freshRecord(OWNER_A,'raw-google-blocked',[candidate()]),
      resolver:new FakeResolver({'Nobu Dubai':[resolved({provider:'google',providerPlaceId:'google-only'})]}),commit:true});
    expect(receipt.unknownCandidates).toBe(1);
    expect(await prisma.place.count({where:{ownerId:OWNER_A}})).toBe(0);
    expect((await prisma.placeAnalysisJob.findFirstOrThrow({where:{postId:'raw-google-blocked'}})).result).toMatchObject({decisions:[{reasons:['provider_content_not_persistable']}]});
  });

  it("labels an anonymous verified building from its source business without rewriting provider identity", async () => {
    const record = await businessRecord("address-labelled-post", "Maison Étoile");
    const provider = anonymousBuilding();
    const before = structuredClone(provider);
    const receipt = await analysis.analyzeCandidateBatchRecord({ownerId: OWNER_A, commit: true,
      record,
      resolver: new FakeResolver({"Maison Étoile": [provider]})});
    expect(receipt).toMatchObject({status: "SUCCEEDED", placesPersisted: 1});
    expect(provider).toEqual(before);
    const place = await prisma.place.findFirstOrThrow({where: {ownerId: OWNER_A}});
    expect(place).toMatchObject({displayName: "Maison Étoile", normalizedName: "maison etoile",
      providerPlaceId: "geo-anonymous-building", latitude: provider.latitude, longitude: provider.longitude, precision: "EXACT"});
    expect(place.metadata).toMatchObject({label: {source: "source_candidate_verified_address",
      candidateName: "Maison Étoile", sourcePostId: "address-labelled-post", providerName: null,
      providerDisplayName: "10 Main Street, Dubai, United Arab Emirates"}});
    expect(await prisma.placeEvidence.findFirstOrThrow({where: {placeId: place.id, evidenceType: "PROVIDER_MATCH"}}))
      .toMatchObject({normalizedValue: "geoapify:geo-anonymous-building", metadata: {reasons: expect.arrayContaining(["verified_street_address"])}});
  });

  it('persists web address proof separately, retains usage, and gives two occupants independent stable identities',async()=>{
    await seedPost('web-address',OWNER_A,'Restaurant');
    const source=candidate({name:'Maison Étoile',category:'patisserie'});
    const provider=researchedBuilding(source.name!);
    const before=structuredClone(source);
    const plans=await analysis.planAll([source],'Restaurant',new FakeResolver({'Maison Étoile':[provider]}));
    const job=await jobs.createMetadataAnalysisJob({ownerId:OWNER_A,postId:'web-address'});
    await prisma.placeAnalysisJob.update({where:{id:job.id},data:{result:{googleUsage:{requests:1},webSearchUsage:{requests:1,limit:20}}}});
    const write=()=>prisma.$transaction(tx=>analysis.persistMetadataAnalysis(tx,{ownerId:OWNER_A,postId:'web-address',jobId:job.id,plans}));
    await write();
    const first=await prisma.place.findFirstOrThrow({where:{ownerId:OWNER_A}});
    expect(first).toMatchObject({displayName:'Maison Étoile',precision:'EXACT',provider:'geoapify',address:provider.address,
      metadata:{sourceProviderPlaceId:'geo-anonymous-building',label:{source:'web_research_verified_address',
        candidateName:'Maison Étoile',sourcePostId:'web-address',providerName:null,providerDisplayName:provider.displayName}}});
    expect(first.providerPlaceId).not.toBe(provider.providerPlaceId);
    expect(await prisma.placeEvidence.findFirstOrThrow({where:{placeId:first.id,evidenceType:'PROVIDER_MATCH'}}))
      .toMatchObject({normalizedValue:'geoapify:geo-anonymous-building',metadata:{webResearch:provider.webResearch,
        reasons:expect.arrayContaining(['verified_web_address'])}});
    expect(await prisma.placeEvidence.findMany({where:{placeId:first.id,evidenceType:'CAPTION'},select:{excerpt:true}}))
      .toEqual([{excerpt:source.evidence[0].excerpt}]);
    expect((await prisma.placeAnalysisJob.findUniqueOrThrow({where:{id:job.id}})).result)
      .toMatchObject({googleUsage:{requests:1},webSearchUsage:{requests:1,limit:20},decisions:[{candidate:{address:null}}]});
    await write();
    expect(await prisma.place.count({where:{ownerId:OWNER_A}})).toBe(1);
    expect(await prisma.placeEvidence.count({where:{analysisJobId:job.id}})).toBe(2);
    expect(source).toEqual(before);
    await seedPost('web-other-occupant',OWNER_A,'Restaurant');
    await persistPlans('web-other-occupant',await analysis.planAll([candidate({name:'Other Bakery'})],'Restaurant',
      new FakeResolver({'Other Bakery':[researchedBuilding('Other Bakery')]})));
    const places=await prisma.place.findMany({where:{ownerId:OWNER_A},orderBy:{displayName:'asc'}});
    expect(places.map(place=>place.displayName)).toEqual(['Maison Étoile','Other Bakery']);
    expect(new Set(places.map(place=>place.providerPlaceId)).size).toBe(2);
  });

  it.each(['automatic','removed','rejected','renamed','confirmed'] as const)(
    'preserves an existing source-address identity when researched evidence arrives: %s',async protection=>{
      const name='Maison Étoile',postId=`legacy-web-${protection}`;
      await analysis.analyzeCandidateBatchRecord({ownerId:OWNER_A,commit:true,record:await businessRecord(postId,name),
        resolver:new FakeResolver({[name]:[anonymousBuilding()]})});
      const original=await prisma.place.findFirstOrThrow({where:{ownerId:OWNER_A}});
      const link=await prisma.postPlace.findFirstOrThrow({where:{postId}});
      if(protection==='removed')await prisma.postPlace.delete({where:{id:link.id}});
      if(protection==='rejected')await prisma.place.update({where:{id:original.id},data:{reviewStatus:'REJECTED'}});
      if(protection==='renamed')await prisma.place.update({where:{id:original.id},data:{displayName:'Owner correction'}});
      if(protection==='confirmed')await prisma.place.update({where:{id:original.id},data:{isUserConfirmed:true,reviewStatus:'CONFIRMED'}});
      const before=await prisma.place.findUniqueOrThrow({where:{id:original.id}});
      for(let replay=0;replay<2;replay++)await persistPlans(postId,await analysis.planAll([candidate({name})],'Restaurant',
        new FakeResolver({[name]:[researchedBuilding(name)]})));
      expect(await prisma.place.count({where:{ownerId:OWNER_A}})).toBe(1);
      expect(await prisma.postPlace.count({where:{postId}})).toBe(protection==='removed'?0:1);
      if(protection!=='automatic')expect(await prisma.place.findUniqueOrThrow({where:{id:original.id}})).toEqual(before);
    });

  it('replaces only the matching automatic zone after independent web address verification',async()=>{
    await seedPost('web-area-upgrade',OWNER_A,'Restaurant');
    const first=contextualArea('Alpha Bakery'),other=contextualArea('Beta Cafe');
    await persistPlans('web-area-upgrade',[first,other]);
    const plans=await analysis.planAll([first.candidate],'Restaurant',new FakeResolver({'Alpha Bakery':[researchedBuilding('Alpha Bakery')]}));
    await persistPlans('web-area-upgrade',plans,true);
    const links=await prisma.postPlace.findMany({where:{postId:'web-area-upgrade'},include:{place:true}});
    expect(links.map(link=>[link.place.displayName,link.precision]).sort()).toEqual([['Alpha Bakery','EXACT'],['Beta Cafe','APPROXIMATE']]);
  });

  it('does not bypass a confirmed source address when research returns a new geographic provider identity',async()=>{
    const name='Maison Étoile',postId='confirmed-new-geo-id';
    await analysis.analyzeCandidateBatchRecord({ownerId:OWNER_A,commit:true,record:await businessRecord(postId,name),
      resolver:new FakeResolver({[name]:[anonymousBuilding()]})});
    const original=await prisma.place.findFirstOrThrow({where:{ownerId:OWNER_A}});
    await prisma.place.update({where:{id:original.id},data:{isUserConfirmed:true,reviewStatus:'CONFIRMED'}});
    const before=await prisma.place.findUniqueOrThrow({where:{id:original.id}});
    const result={...researchedBuilding(name),providerPlaceId:'new-building-entry'};
    await persistPlans(postId,await analysis.planAll([candidate({name})],'Restaurant',new FakeResolver({[name]:[result]})));
    expect(await prisma.place.count({where:{ownerId:OWNER_A}})).toBe(1);
    expect(await prisma.postPlace.count({where:{postId}})).toBe(1);
    expect(await prisma.place.findUniqueOrThrow({where:{id:original.id}})).toEqual(before);
  });

  it.each(["automatic", "confirmed", "legacy_category_review", "preserveExisting"])("refuses a different occupant before canonical early returns (%s)", async (protection) => {
    const provider = anonymousBuilding();
    const first = await analysis.analyzeCandidateBatchRecord({ownerId: OWNER_A, commit: true,
      record: await businessRecord("first-occupant", "Maison Étoile"),
      resolver: new FakeResolver({"Maison Étoile": [provider]})});
    const original = await prisma.place.findFirstOrThrow({where: {ownerId: OWNER_A}});
    if (protection === "confirmed") await prisma.place.update({where: {id: original.id}, data: {isUserConfirmed: true, reviewStatus: "CONFIRMED"}});
    if (protection === "legacy_category_review") await prisma.placeEvidence.create({data: {ownerId: OWNER_A,
      postId: "first-occupant", placeId: original.id, analysisJobId: first.jobId!, evidenceType: "USER_CORRECTION",
      excerpt: "Owner category", confidence: 1, metadata: {action: "PLACE_CATEGORY_CORRECTED"}}});
    const before = await prisma.place.findUniqueOrThrow({where: {id: original.id}});
    const record = await businessRecord("second-occupant", "Different Bakery");
    const job = await jobs.createMetadataAnalysisJob({ownerId: OWNER_A, postId: record.post_id});
    const plans = await analysis.planAll(record.candidates, "Restaurant", new FakeResolver({"Different Bakery": [provider]}));
    const receipt = await prisma.$transaction(tx => analysis.persistMetadataAnalysis(tx, {
      ownerId: OWNER_A, postId: record.post_id, jobId: job.id, plans, preserveExisting: protection === "preserveExisting"}));
    expect(receipt).toMatchObject({status: "NEEDS_REVIEW", unknownCandidates: 1, linksPersisted: 0});
    expect(await prisma.place.findUniqueOrThrow({where: {id: original.id}})).toEqual(before);
    expect(await prisma.postPlace.count({where: {postId: record.post_id}})).toBe(0);
    expect(await prisma.placeEvidence.findFirstOrThrow({where: {postId: record.post_id}})).toMatchObject({placeId: null});
    expect((await prisma.placeAnalysisJob.findUniqueOrThrow({where: {id: job.id}})).result)
      .toMatchObject({decisions: [{precision: "UNKNOWN", reasons: ["existing_identity_conflict"]}]});
  });

  it("reuses recognized business aliases without changing the source label or its original provenance", async () => {
    const provider = anonymousBuilding();
    for (const [postId, name] of [["source-label", "Maison Étoile"], ["source-alias", "Maison Etoile Bakery"], ["source-handle", "MaisonEtoile"]]) {
      await analysis.analyzeCandidateBatchRecord({ownerId: OWNER_A, commit: true,
        record: await businessRecord(postId, name), resolver: new FakeResolver({[name]: [{...provider, providerRank: postId === "source-label" ? 1 : 0.95}]})});
    }
    expect(await prisma.place.count({where: {ownerId: OWNER_A}})).toBe(1);
    expect(await prisma.postPlace.count({where: {ownerId: OWNER_A}})).toBe(3);
    expect(await prisma.place.findFirstOrThrow({where: {ownerId: OWNER_A}}))
      .toMatchObject({displayName: "Maison Étoile", confidence: 1, metadata: {label: {candidateName: "Maison Étoile", sourcePostId: "source-label"}}});
  });

  it("keeps legacy address-only identities for review rather than assigning the next business to them", async () => {
    const provider = anonymousBuilding();
    await analysis.analyzeCandidateBatchRecord({ownerId: OWNER_A, commit: true,
      record: await businessRecord("legacy-address", null), resolver: {resolve: async () => [provider]}});
    const before = await prisma.place.findFirstOrThrow({where: {ownerId: OWNER_A}});
    const receipt = await analysis.analyzeCandidateBatchRecord({ownerId: OWNER_A, commit: true,
      record: await businessRecord("legacy-incoming", "Maison Étoile"), resolver: {resolve: async () => [provider]}});
    expect(receipt).toMatchObject({status: "NEEDS_REVIEW", linksPersisted: 0});
    expect(await prisma.place.findUniqueOrThrow({where: {id: before.id}})).toEqual(before);
    expect(await prisma.postPlace.count({where: {postId: "legacy-incoming"}})).toBe(0);
  });

  it("serializes competing occupants of one anonymous building and keeps owners independent", async () => {
    const provider = anonymousBuilding();
    const records = await Promise.all([businessRecord("racing-a", "Maison Étoile"), businessRecord("racing-b", "Different Bakery")]);
    const receipts = await Promise.all(records.map(record => analysis.analyzeCandidateBatchRecord({ownerId: OWNER_A,
      commit: true, record, resolver: {resolve: async () => [provider]}})));
    expect(receipts.map(receipt => receipt.status).sort()).toEqual(["NEEDS_REVIEW", "SUCCEEDED"]);
    expect(await prisma.place.count({where: {ownerId: OWNER_A}})).toBe(1);
    expect(await prisma.postPlace.count({where: {ownerId: OWNER_A}})).toBe(1);
    const other = await analysis.analyzeCandidateBatchRecord({ownerId: OWNER_B, commit: true,
      record: await businessRecord("other-owner", "Other Owner Bakery", OWNER_B), resolver: {resolve: async () => [provider]}});
    expect(other.status).toBe("SUCCEEDED");
    expect(await prisma.place.findFirstOrThrow({where: {ownerId: OWNER_B}})).toMatchObject({displayName: "Other Owner Bakery"});
  });

  it("reuses a manually confirmed same-site business across providers but never a neighboring branch", async () => {
    const provider = anonymousBuilding();
    await analysis.analyzeCandidateBatchRecord({ownerId: OWNER_A, commit: true,
      record: await businessRecord("legacy-provider", "Maison Étoile"), resolver: {resolve: async () => [provider]}});
    const known = await prisma.place.findFirstOrThrow({where: {ownerId: OWNER_A}});
    await prisma.place.update({where: {id: known.id}, data: {provider: "legacy-provider", isUserConfirmed: true, reviewStatus: "CONFIRMED"}});
    const before = await prisma.place.findUniqueOrThrow({where: {id: known.id}});
    const matching = await analysis.analyzeCandidateBatchRecord({ownerId: OWNER_A, commit: true,
      record: await businessRecord("matching-provider", "Maison Etoile Bakery"), resolver: {resolve: async () => [provider]}});
    expect(matching).toMatchObject({status: "SUCCEEDED", linksPersisted: 1});
    expect(await prisma.place.count({where: {ownerId: OWNER_A}})).toBe(1);
    expect(await prisma.place.findUniqueOrThrow({where: {id: known.id}})).toEqual(before);
    const neighbor = await businessRecord("neighbor-provider", "Maison Étoile");
    neighbor.candidates[0].address = "12 Main Street";
    const receipt = await analysis.analyzeCandidateBatchRecord({ownerId: OWNER_A, commit: true, record: neighbor,
      resolver: {resolve: async () => [anonymousBuilding({providerPlaceId: "neighbor-building", houseNumber: "12",
        address: "12 Main Street, Dubai, United Arab Emirates", displayName: "12 Main Street, Dubai, United Arab Emirates", latitude: 25.1301})]}});
    expect(receipt.status).toBe("NEEDS_REVIEW");
    expect(await prisma.postPlace.count({where: {postId: "neighbor-provider"}})).toBe(0);
  });

  it.each(["same_provider", "different_provider"])("holds an inconsistent source label after a manual canonical rename (%s)", async (identity) => {
    const provider = anonymousBuilding();
    await analysis.analyzeCandidateBatchRecord({ownerId: OWNER_A, commit: true,
      record: await businessRecord("before-manual-rename", "Maison Étoile"), resolver: {resolve: async () => [provider]}});
    const known = await prisma.place.findFirstOrThrow({where: {ownerId: OWNER_A}});
    await prisma.place.update({where: {id: known.id}, data: {displayName: "Different Bakery", normalizedName: "different bakery",
      isUserConfirmed: true, reviewStatus: "CONFIRMED", ...(identity === "different_provider" ? {provider: "legacy-provider"} : {})}});
    const before = await prisma.place.findUniqueOrThrow({where: {id: known.id}});
    for (const [index, name] of ["Maison Étoile", "Different Bakery"].entries()) {
      const postId = `after-manual-rename-${index}`;
      const receipt = await analysis.analyzeCandidateBatchRecord({ownerId: OWNER_A, commit: true,
        record: await businessRecord(postId, name), resolver: {resolve: async () => [provider]}});
      expect(receipt).toMatchObject({status: "NEEDS_REVIEW", linksPersisted: 0, unknownCandidates: 1});
      expect(await prisma.postPlace.count({where: {postId}})).toBe(0);
    }
    expect(await prisma.place.count({where: {ownerId: OWNER_A}})).toBe(1);
    expect(await prisma.place.findUniqueOrThrow({where: {id: known.id}})).toEqual(before);
  });

  it("preserves named provider labels and excludes non-business or unasserted anonymous results", async () => {
    const examples: Array<{name: string; category: PlaceCandidate['category']; provider: ResolvedPlaceCandidate}> = [
      {name: "Maison Étoile", category: "patisserie", provider: anonymousBuilding({providerName: "Maison Étoile", providerResultType: "amenity", displayName: "Maison Étoile, Dubai"})},
      {name: "Some Destination", category: "voyage", provider: anonymousBuilding()},
      {name: "Some Shop", category: "divers", provider: anonymousBuilding()},
      {name: "Maison Étoile", category: "patisserie", provider: anonymousBuilding({providerName: undefined})},
    ];
    for (const [index, example] of examples.entries()) {
      const provider = {...example.provider, providerPlaceId: `excluded-label-${index}`};
      const receipt = await analysis.analyzeCandidateBatchRecord({ownerId: OWNER_A, commit: true,
        record: await businessRecord(`excluded-label-${index}`, example.name, OWNER_A, example.category), resolver: {resolve: async () => [provider]}});
      expect(receipt.status).toBe("SUCCEEDED");
      const place = await prisma.place.findUniqueOrThrow({where: {ownerId_provider_providerPlaceId: {ownerId: OWNER_A, provider: "geoapify", providerPlaceId: provider.providerPlaceId}}});
      expect(place.displayName).toBe(provider.displayName);
      expect(place.metadata).not.toHaveProperty("label");
    }
  });

  it("persists a resolved EXACT place with one primary link and evidence", async () => {
    await seedPost("nobu-post", OWNER_A, "Voyages");
    const resolver = new FakeResolver({ "Nobu Dubai": [resolved()] });

    const result = await analysis.analyzeCandidateBatchRecord({
      ownerId: OWNER_A,
      record: await freshRecord(OWNER_A, "nobu-post", [candidate()]),
      resolver,
      commit: true,
    });

    expect(result.status).toBe("SUCCEEDED");
    const place = await prisma.place.findFirstOrThrow({ where: { ownerId: OWNER_A } });
    expect(place.precision).toBe("EXACT");
    expect(place.approximationRadiusMeters).toBeNull();
    expect(place.continentCode).toBe("AS");
    const link = await prisma.postPlace.findFirstOrThrow({ where: { ownerId: OWNER_A } });
    expect(link.isPrimary).toBe(true);
    expect(await prisma.placeEvidence.count({ where: { ownerId: OWNER_A, evidenceType: "PROVIDER_MATCH" } })).toBe(1);
    expect(await prisma.placeEvidence.count({ where: { ownerId: OWNER_A, evidenceType: "CAPTION" } })).toBe(1);
    const job = await prisma.placeAnalysisJob.findFirstOrThrow({ where: { ownerId: OWNER_A } });
    expect(job.status).toBe("SUCCEEDED");
  });

  it("persists post-based cafe classification and timed evidence regardless of Geoapify category", async () => {
    await seedPost("brunch-post", OWNER_A, "Restaurant");
    const resolver = new FakeResolver({ "Nobu Dubai": [resolved({ category: "catering.fast_food" })] });
    const proposed = { ...candidate(), category: "cafe", categoryReason: "Brunch and coffee in the caption", evidence: [
      { type: "CAPTION", excerpt: "Brunch and coffee" },
      { type: "AUDIO_TRANSCRIPT", excerpt: "Nobu Dubai", videoTimestampMs: 4000, mediaId: "media-1" },
    ] } as PlaceCandidate;
    const record = await freshRecord(OWNER_A,"brunch-post",[proposed]);
    await analysis.analyzeCandidateBatchRecord({ownerId:OWNER_A,record,resolver,commit:true});
    const place = await prisma.place.findFirstOrThrow({where:{ownerId:OWNER_A}});
    expect(place.category).toBe("cafe");
    expect(place.metadata).toMatchObject({classification:{source:"post_analysis",category:"cafe",reason:"Brunch and coffee in the caption"}});
    const audio = await prisma.placeEvidence.findFirstOrThrow({where:{ownerId:OWNER_A,evidenceType:"AUDIO_TRANSCRIPT"}});
    expect(audio.videoTimestampMs).toBe(4000);
    expect(audio.metadata).toMatchObject({mediaId:"media-1"});
    await prisma.place.update({where:{id:place.id},data:{isUserConfirmed:true,category:"patisserie"}});
    await analysis.analyzeCandidateBatchRecord({ownerId:OWNER_A,record,resolver,commit:true});
    expect((await prisma.place.findUniqueOrThrow({where:{id:place.id}})).category).toBe("patisserie");
  });

  it("preserves a known venue category across unknown mentions while accepting specific corrections", async () => {
    const resolver = new FakeResolver({ "Nobu Dubai": [resolved()] });
    const write = async (postId: string, category: PlaceCandidate["category"]) => {
      await seedPost(postId, OWNER_A, "Voyages");
      await analysis.analyzeCandidateBatchRecord({ ownerId: OWNER_A, resolver, commit: true,
        record: await freshRecord(OWNER_A, postId, [candidate({ category, categoryReason: `Evidence for ${category}` })]),
      });
      return prisma.place.findFirstOrThrow({ where: { ownerId: OWNER_A } });
    };
    const first = await write("known-cafe", "cafe");
    const unknown = await write("unknown-mention", "divers");
    expect(unknown.category).toBe("cafe");
    expect(unknown.metadata).toMatchObject({ classification: { category: "cafe", reason: "Evidence for cafe" } });
    expect(await prisma.postPlace.count({ where: { ownerId: OWNER_A, placeId: first.id } })).toBe(2);
    const corrected = await write("specific-pastry", "patisserie");
    expect(corrected.category).toBe("patisserie");
    await prisma.place.update({ where: { id: first.id }, data: { isUserConfirmed: true } });
    expect((await write("automatic-restaurant", "restaurant")).category).toBe("patisserie");
  });

  it.each(["PLACE_CATEGORY_CORRECTED", "POST_PLACE_CORRECTED"])("scopes legacy protection to canonical corrections (%s)", async (action) => {
    await seedPost("reviewed-cafe", OWNER_A, "Restaurant");
    await seedPost("later-restaurant", OWNER_A, "Voyages");
    const resolver = new FakeResolver({ "Nobu Dubai": [resolved()] });
    const first = await analysis.analyzeCandidateBatchRecord({ ownerId: OWNER_A, resolver, commit: true,
      record: await freshRecord(OWNER_A, "reviewed-cafe", [candidate({ category: "cafe" })]),
    });
    const before = await prisma.place.findFirstOrThrow({ where: { ownerId: OWNER_A } });
    await prisma.placeEvidence.create({ data: { ownerId: OWNER_A, postId: "reviewed-cafe", placeId: before.id,
      analysisJobId: first.jobId!, evidenceType: "USER_CORRECTION", excerpt: "Owner-approved cafe correction",
      confidence: 1, metadata: { action },
    } });
    await analysis.analyzeCandidateBatchRecord({ ownerId: OWNER_A, resolver, commit: true,
      record: await freshRecord(OWNER_A, "later-restaurant", [candidate({ category: "restaurant" })]),
    });
    const after = await prisma.place.findUniqueOrThrow({ where: { id: before.id } });
    if (action === "PLACE_CATEGORY_CORRECTED") expect(after).toEqual(before);
    else expect(after.category).toBe("restaurant");
    expect(await prisma.postPlace.count({ where: { ownerId: OWNER_A, placeId: before.id } })).toBe(2);
  });

  it.each(["strong-first", "weak-first"])("retains shared certainty and each post's score (%s)", async (order) => {
    const resolver = new FakeResolver({ "Nobu Dubai": [resolved()] });
    const strengths = order === "strong-first" ? [0.95, 0.85, 0.5] : [0.5, 0.85, 0.95];
    for (const strength of strengths) {
      const postId = `shared-${strength}`;
      await seedPost(postId, OWNER_A, "Voyages");
      await analysis.analyzeCandidateBatchRecord({
        ownerId: OWNER_A, record: await freshRecord(OWNER_A, postId, [candidate({ confidence: strength, ...(strength===.5?{country:null}:{}) })]),
        resolver, commit: true,
      });
    }
    const place = await prisma.place.findFirstOrThrow({ where: { ownerId: OWNER_A } });
    const strong = await prisma.postPlace.findFirstOrThrow({ where: { postId: "shared-0.95" } });
    const weak = await prisma.postPlace.findFirstOrThrow({ where: { postId: "shared-0.5" } });
    const medium = await prisma.postPlace.findFirstOrThrow({ where: { postId: "shared-0.85" } });
    expect(strong.precision).toBe("EXACT");
    expect(medium.precision).toBe("EXACT");
    expect(medium.confidence).toBeLessThan(strong.confidence);
    expect(weak.precision).toBe("PROBABLE");
    expect(weak.confidence).toBeLessThan(strong.confidence);
    const weakEvidence = await prisma.placeEvidence.findFirstOrThrow({
      where: { postId: weak.postId, evidenceType: "PROVIDER_MATCH" },
    });
    expect(weakEvidence.confidence).toBe(weak.confidence);
    expect(place).toMatchObject({ precision: strong.precision, confidence: strong.confidence, approximationRadiusMeters: null });
    expect(await prisma.place.count({ where: { ownerId: OWNER_A } })).toBe(1);
  });

  it("retains a stronger shared resolution committed while another post waits", async () => {
    const resolver = new FakeResolver({ "Nobu Dubai": [resolved()] });
    await seedPost("shared-original", OWNER_A, "Voyages");
    await analysis.analyzeCandidateBatchRecord({ ownerId: OWNER_A,
      record: await freshRecord(OWNER_A, "shared-original", [candidate()]), resolver, commit: true });
    const strongest = await prisma.place.findFirstOrThrow({ where: { ownerId: OWNER_A } });
    await prisma.place.update({ where: { id: strongest.id }, data: { precision: "PROBABLE", confidence: 0.8 } });
    await seedPost("shared-waiting", OWNER_A, "Voyages");
    const record = await freshRecord(OWNER_A, "shared-waiting", [candidate({ confidence: 0.5, country:null })]);
    const ready = Promise.withResolvers<number>();
    const release = Promise.withResolvers<void>();
    const writer = prisma.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      await tx.place.update({ where: { id: strongest.id },
        data: { precision: strongest.precision, confidence: strongest.confidence } });
      ready.resolve(pid);
      await release.promise;
    }, { timeout: 10_000 });
    let waiting: ReturnType<typeof analysis.analyzeCandidateBatchRecord> | undefined;
    try {
      const pid = await ready.promise;
      waiting = analysis.analyzeCandidateBatchRecord({ ownerId: OWNER_A, record, resolver, commit: true });
      await expect.poll(async () => (await prisma.$queryRaw<Array<{ pid: number }>>`
        SELECT pid FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`).length).toBe(1);
      release.resolve();
      await writer;
      await waiting;
      expect(await prisma.place.findUniqueOrThrow({ where: { id: strongest.id } }))
        .toMatchObject({ precision: strongest.precision, confidence: strongest.confidence });
      expect(await prisma.postPlace.findFirstOrThrow({ where: { postId: record.post_id } }))
        .toMatchObject({ precision: "PROBABLE" });
    } finally {
      release.resolve();
      await Promise.allSettled([writer, waiting]);
    }
  });

  it("applies corrected geographic data even when the new post has weaker evidence", async () => {
    await seedPost("original-location", OWNER_A, "Voyages");
    await analysis.analyzeCandidateBatchRecord({ ownerId: OWNER_A,
      record: await freshRecord(OWNER_A, "original-location", [candidate()]),
      resolver: new FakeResolver({ "Nobu Dubai": [resolved()] }), commit: true });
    await seedPost("corrected-location", OWNER_A, "Voyages");
    const correction = resolved({ address: "Corrected address, Dubai", latitude: 25.14 });
    await analysis.analyzeCandidateBatchRecord({ ownerId: OWNER_A,
      record: await freshRecord(OWNER_A, "corrected-location", [candidate({ confidence: 0.5, country:null })]),
      resolver: new FakeResolver({ "Nobu Dubai": [correction] }), commit: true });
    const place = await prisma.place.findFirstOrThrow({ where: { ownerId: OWNER_A } });
    const correctedLink = await prisma.postPlace.findFirstOrThrow({ where: { postId: "corrected-location" } });
    expect(place).toMatchObject({ address: correction.address, latitude: correction.latitude,
      precision: "PROBABLE", confidence: correctedLink.confidence });
  });

  it("persists an APPROXIMATE city with a mandatory radius", async () => {
    await seedPost("kyoto-post", OWNER_A, "Voyages");
    const resolver = new FakeResolver({
      Kyoto: [resolved({ providerPlaceId: "geo-kyoto", displayName: "Kyoto", city: "Kyoto", country: "Japan", countryCode: "JP", providerResultType: "city" })],
    });

    await analysis.analyzeCandidateBatchRecord({
      ownerId: OWNER_A,
      record: await freshRecord(OWNER_A, "kyoto-post", [candidate({ name: "Kyoto", city: "Kyoto", country: "Japan", category: "voyage", confidence: 0.7 })]),
      resolver,
      commit: true,
    });

    const place = await prisma.place.findFirstOrThrow({ where: { ownerId: OWNER_A } });
    expect(place.precision).toBe("APPROXIMATE");
    expect(place.approximationRadiusMeters).toBe(10_000);
    expect(place.continentCode).toBe("AS");
  });

  it("keeps matching APPROXIMATE areas isolated to their source posts", async () => {
    await seedPost("kyoto-first", OWNER_A, "Voyages");
    await seedPost("kyoto-second", OWNER_A, "Restaurant");
    const resolver = new FakeResolver({
      Kyoto: [resolved({ providerPlaceId: "geo-kyoto", displayName: "Kyoto", city: "Kyoto", country: "Japan", countryCode: "JP", providerResultType: "city" })],
    });

    for (const postId of ["kyoto-first", "kyoto-second"]) {
      await analysis.analyzeCandidateBatchRecord({
        ownerId: OWNER_A,
        record: await freshRecord(OWNER_A, postId, [candidate({ name: "Kyoto", city: "Kyoto", country: "Japan", category: "voyage", confidence: 0.7 })]),
        resolver,
        commit: true,
      });
    }

    expect(await prisma.place.count({ where: { ownerId: OWNER_A, precision: "APPROXIMATE" } })).toBe(2);
    expect(await prisma.postPlace.count({ where: { ownerId: OWNER_A, precision: "APPROXIMATE" } })).toBe(2);
  });

  it('keeps source-named businesses distinct inside one area and stable when the provider area improves', async () => {
    for (const id of ['venues-first', 'venues-second']) await seedPost(id, OWNER_A, 'Restaurant');
    await persistPlans('venues-first', [contextualArea('Alpha Bakery'), contextualArea('Beta Cafe')]);
    const original = await prisma.place.findMany({where: {ownerId: OWNER_A}, orderBy: {displayName: 'asc'}});
    expect(original.map(place => place.displayName)).toEqual(['Alpha Bakery', 'Beta Cafe']);
    expect(original[0].metadata).toMatchObject({label: {source: 'source_candidate_approximate_area',
      candidateName: 'Alpha Bakery', sourcePostId: 'venues-first', providerDisplayName: 'Dubai'}});
    await persistPlans('venues-first', [contextualArea('Alpha Bakery', {providerPlaceId: 'geo-district', displayName: 'Central Dubai'})]);
    const improved = await prisma.place.findUniqueOrThrow({where: {id: original[0].id}});
    expect(improved.displayName).toBe('Alpha Bakery');
    expect(improved.metadata).toMatchObject({sourceProviderPlaceId: 'geo-district', label: {providerDisplayName: 'Central Dubai'}});
    expect(await prisma.postPlace.count({where: {postId: 'venues-first'}})).toBe(2);
    await persistPlans('venues-second', [contextualArea('Alpha Bakery')]);
    expect(await prisma.place.count({where: {ownerId: OWNER_A}})).toBe(3);
  });

  it('preserves manual removal, rejection and confirmation when a business area changes', async () => {
    for (const protection of ['removed', 'rejected', 'confirmed'] as const) {
      const postId = `area-${protection}`;
      await seedPost(postId, OWNER_A, 'Restaurant');
      await persistPlans(postId, [contextualArea('Alpha Bakery')]);
      const link = await prisma.postPlace.findFirstOrThrow({where: {postId}, include: {place: true}});
      if (protection === 'removed') await prisma.postPlace.delete({where: {id: link.id}});
      if (protection === 'rejected') await prisma.place.update({where: {id: link.placeId}, data: {reviewStatus: 'REJECTED'}});
      if (protection === 'confirmed') {
        await prisma.place.update({where: {id: link.placeId}, data: {isUserConfirmed: true, reviewStatus: 'CONFIRMED', displayName: 'Owner label'}});
        await prisma.postPlace.update({where: {id: link.id}, data: {isUserConfirmed: true}});
      }
      await persistPlans(postId, [contextualArea('Alpha Bakery', {providerPlaceId: `geo-${protection}-new`, latitude: 25.3})]);
      expect(await prisma.place.count({where: {ownerId: OWNER_A, postLinks: {some: {postId}}}})).toBe(protection === 'removed' ? 0 : 1);
      expect(await prisma.place.findUniqueOrThrow({where: {id: link.placeId}})).toMatchObject(protection === 'confirmed'
        ? {displayName: 'Owner label', latitude: link.place.latitude, isUserConfirmed: true} : {latitude: link.place.latitude});
    }
  });

  it.each([false, true])('upgrades only the matching automatic business zone while preserving other businesses (additive %s)', async preserveExisting => {
    await seedPost('area-upgrade', OWNER_A, 'Restaurant');
    const alpha = contextualArea('Alpha Bakery'), beta = contextualArea('Beta Cafe');
    beta.best!.scored.confidence = .8;
    await persistPlans('area-upgrade', [alpha, beta]);
    await persistPlans('area-upgrade', [{candidate: alpha.candidate, best: {resolved: resolved({displayName: 'Alpha Bakery', providerName: 'Alpha Bakery'}),
      scored: {precision: 'EXACT', confidence: .95, approximationRadiusMeters: null, reasons: ['venue_identity_and_context']}}}], preserveExisting);
    const links = await prisma.postPlace.findMany({where: {postId: 'area-upgrade'}, include: {place: true}});
    expect(links.map(link => [link.place.displayName, link.precision]).sort()).toEqual([['Alpha Bakery', 'EXACT'], ['Beta Cafe', 'APPROXIMATE']]);
    expect(await prisma.place.count({where: {ownerId: OWNER_A}})).toBe(3);
  });

  it('keeps prior exact removals, rejections, renames and confirmations authoritative over a new area identity', async () => {
    for (const protection of ['removed', 'rejected', 'renamed', 'confirmed', 'removed-district'] as const) {
      const postId = `prior-exact-${protection}`;
      await seedPost(postId, OWNER_A, 'Restaurant');
      const plan = contextualArea('Alpha Bakery');
      if (protection === 'removed-district') {
        plan.candidate = {...plan.candidate, city: 'Shanghai', country: 'China'};
        plan.best!.resolved = {...plan.best!.resolved, city: 'Shanghai', region: 'Shanghai', country: 'China', countryCode: 'CN'};
      }
      await persistPlans(postId, [{candidate: plan.candidate, best: {resolved: resolved({providerPlaceId: `geo-exact-${protection}`, displayName: 'Alpha Bakery', providerName: 'Alpha Bakery'}),
        scored: {precision: 'EXACT', confidence: .95, approximationRadiusMeters: null, reasons: ['venue_identity_and_context']}}}]);
      const link = await prisma.postPlace.findFirstOrThrow({where: {postId}, include: {place: true}});
      if (protection === 'removed-district') await prisma.place.update({where: {id: link.placeId}, data: {city: 'Xuhui District', region: 'Shanghai', country: 'China', countryCode: 'CN'}});
      if (protection.startsWith('removed')) await prisma.postPlace.delete({where: {id: link.id}});
      if (protection === 'rejected') await prisma.place.update({where: {id: link.placeId}, data: {reviewStatus: 'REJECTED'}});
      if (protection === 'renamed') await prisma.place.update({where: {id: link.placeId}, data: {displayName: 'Owner correction', normalizedName: 'owner correction'}});
      if (protection === 'confirmed') await prisma.place.update({where: {id: link.placeId}, data: {isUserConfirmed: true, reviewStatus: 'CONFIRMED'}});
      for (let replay = 0; replay < 3; replay++) await persistPlans(postId, [plan]);
      expect(await prisma.place.count({where: {ownerId: OWNER_A, providerPlaceId: {startsWith: 'contextual-venue:'}}})).toBe(0);
      expect(await prisma.postPlace.findMany({where: {postId}})).toHaveLength(protection.startsWith('removed') ? 0 : 1);
      if (protection === 'confirmed') expect(await prisma.postPlace.findUniqueOrThrow({where: {id: link.id}})).toMatchObject({precision: 'EXACT', confidence: .95});
    }
  });

  it('keeps manually confirmed business areas and links during an additive exact upgrade', async () => {
    for (const target of ['place', 'link'] as const) {
      const postId = `manual-area-${target}`;
      await seedPost(postId, OWNER_A, 'Restaurant');
      const area = contextualArea('Alpha Bakery');
      await persistPlans(postId, [area]);
      const link = await prisma.postPlace.findFirstOrThrow({where: {postId}, include: {place: true}});
      if (target === 'place') await prisma.place.update({where: {id: link.placeId}, data: {isUserConfirmed: true, reviewStatus: 'CONFIRMED'}});
      else await prisma.postPlace.update({where: {id: link.id}, data: {isUserConfirmed: true}});
      const before = await prisma.postPlace.findUniqueOrThrow({where: {id: link.id}});
      await persistPlans(postId, [{candidate: area.candidate, best: {resolved: resolved({providerPlaceId: `exact-manual-${target}`, displayName: 'Alpha Bakery', providerName: 'Alpha Bakery'}),
        scored: {precision: 'EXACT', confidence: .95, approximationRadiusMeters: null, reasons: ['venue_identity_and_context']}}}], true);
      expect(await prisma.postPlace.findUniqueOrThrow({where: {id: link.id}})).toEqual(before);
      expect(await prisma.place.findUniqueOrThrow({where: {id: link.placeId}})).toMatchObject({displayName: 'Alpha Bakery', precision: 'APPROXIMATE', latitude: link.place.latitude});
    }
  });

  it('preserves removals across equivalent country and administrative labels without conflating conflicting contexts', async () => {
    for (const [label, region, countryCode, country, expectedLinks] of [
      ['CN', 'Xuhui', 'CN', 'China', 0],
      ['Chine', 'Xuhui', 'CN', 'China', 0],
      ['China', 'Xuhui District', 'CN', 'China', 0],
      ['Japan', 'Xuhui', 'JP', 'Japan', 1],
      ['China', 'Jingan District', 'CN', 'China', 1],
    ] as const) {
      const postId = `area-context-${label}-${region}`;
      await seedPost(postId, OWNER_A, 'Restaurant');
      const original = contextualArea('Alpha Bakery', {city: 'Shanghai', region: 'Shanghai', country: 'China', countryCode: 'CN',
        administrativeLabels: {district: 'Xuhui District', city: 'Shanghai'}});
      original.candidate = {...original.candidate, city: 'Shanghai', region: 'Xuhui', country: 'China'};
      await persistPlans(postId, [original]);
      const link = await prisma.postPlace.findFirstOrThrow({where: {postId}});
      await prisma.postPlace.delete({where: {id: link.id}});
      const replacement = contextualArea('Alpha Bakery', {providerPlaceId: `changed-${label}-${region}`, city: 'Shanghai', region: 'Shanghai', country, countryCode,
        administrativeLabels: {district: region.includes('Jingan') ? 'Jingan District' : 'Xuhui District', city: 'Shanghai'}});
      replacement.candidate = {...original.candidate, country: label, region};
      await persistPlans(postId, [replacement]);
      expect(await prisma.postPlace.count({where: {postId}})).toBe(expectedLinks);
    }
  });

  it('upgrades equivalent country and district labels but preserves areas in genuinely different contexts', async () => {
    for (const [country, countryCode, region, expectedAreas] of [
      ['CN', 'CN', 'Xuhui District', 0],
      ['Chine', 'CN', 'Xuhui', 0],
      ['Japan', 'JP', 'Xuhui District', 1],
      ['China', 'CN', 'Jingan District', 1],
    ] as const) {
      const postId = `area-upgrade-context-${country}-${region}`;
      await seedPost(postId, OWNER_A, 'Restaurant');
      const area = contextualArea('Alpha Bakery', {city: 'Shanghai', region: 'Shanghai', country: 'China', countryCode: 'CN',
        administrativeLabels: {district: 'Xuhui District', city: 'Shanghai'}});
      area.candidate = {...area.candidate, city: 'Shanghai', region: 'Xuhui', country: 'China'};
      await persistPlans(postId, [area]);
      await persistPlans(postId, [{candidate: {...area.candidate, country, region}, best: {
        resolved: resolved({providerPlaceId: `exact-${postId}`, displayName: 'Alpha Bakery', providerName: 'Alpha Bakery',
          city: 'Shanghai', region: 'Shanghai', country: countryCode === 'JP' ? 'Japan' : 'China', countryCode,
          administrativeLabels: {district: region.includes('Jingan') ? 'Jingan District' : 'Xuhui District', city: 'Shanghai'}}),
        scored: {precision: 'EXACT', confidence: .95, approximationRadiusMeters: null, reasons: ['venue_identity_and_context']},
      }}], true);
      expect(await prisma.postPlace.count({where: {postId, precision: 'APPROXIMATE'}})).toBe(expectedAreas);
      expect(await prisma.postPlace.count({where: {postId, precision: 'EXACT'}})).toBe(1);
    }
  });

  it("records an UNKNOWN candidate as evidence only and creates no place", async () => {
    await seedPost("country-post", OWNER_A, "Voyages");
    const resolver = new FakeResolver({
      Japan: [resolved({ providerPlaceId: "geo-jp", displayName: "Japan", city: null, country: "Japan", countryCode: "JP", providerResultType: "country" })],
    });

    const result = await analysis.analyzeCandidateBatchRecord({
      ownerId: OWNER_A,
      record: await freshRecord(OWNER_A, "country-post", [candidate({ name: "Japan", city: null, country: "Japan", evidence: [{ type: "CAPTION", excerpt: "Somewhere in Japan" }] })]),
      resolver,
      commit: true,
    });

    expect(result.status).toBe("NEEDS_REVIEW");
    expect(await prisma.place.count({ where: { ownerId: OWNER_A } })).toBe(0);
    expect(await prisma.postPlace.count({ where: { ownerId: OWNER_A } })).toBe(0);
    const evidence = await prisma.placeEvidence.findFirstOrThrow({ where: { ownerId: OWNER_A, evidenceType: "CAPTION" } });
    expect(evidence.placeId).toBeNull();
    const job = await prisma.placeAnalysisJob.findFirstOrThrow({ where: { ownerId: OWNER_A } });
    expect(job.status).toBe("NEEDS_REVIEW");
  });

  it("links multiple distinct places with exactly one primary", async () => {
    await seedPost("multi-post", OWNER_A, "Voyages");
    const resolver = new FakeResolver({
      "Nobu Dubai": [resolved()],
      "Louvre Abu Dhabi": [resolved({ providerPlaceId: "geo-louvre", displayName: "Louvre Abu Dhabi", city: "Abu Dhabi", country: "United Arab Emirates", countryCode: "AE", providerResultType: "amenity" })],
    });

    await analysis.analyzeCandidateBatchRecord({
      ownerId: OWNER_A,
      record: await freshRecord(OWNER_A, "multi-post", [
        candidate({ confidence: 0.95 }),
        candidate({ name: "Louvre Abu Dhabi", city: "Abu Dhabi", confidence: 0.8 }),
      ]),
      resolver,
      commit: true,
    });

    expect(await prisma.place.count({ where: { ownerId: OWNER_A } })).toBe(2);
    expect(await prisma.postPlace.count({ where: { ownerId: OWNER_A } })).toBe(2);
    expect(await prisma.postPlace.count({ where: { ownerId: OWNER_A, isPrimary: true } })).toBe(1);
  });

  it("deduplicates the same place mentioned twice in one post", async () => {
    await seedPost("dup-post", OWNER_A, "Voyages");
    const resolver = new FakeResolver({ "Nobu Dubai": [resolved()] });

    await analysis.analyzeCandidateBatchRecord({
      ownerId: OWNER_A,
      record: await freshRecord(OWNER_A, "dup-post", [
        candidate({ evidence: [{ type: "CAPTION", excerpt: "Nobu again" }] }),
        candidate({ evidence: [{ type: "HASHTAG", excerpt: "#nobu" }] }),
      ]),
      resolver,
      commit: true,
    });

    expect(await prisma.place.count({ where: { ownerId: OWNER_A } })).toBe(1);
    expect(await prisma.postPlace.count({ where: { ownerId: OWNER_A } })).toBe(1);
  });

  it("cancels non-terminal jobs when the post left an eligible theme", async () => {
    await seedPost("stale-post", OWNER_A, "Voyages");
    const record = await freshRecord(OWNER_A, "stale-post", [candidate()]);
    const job = await jobs.createMetadataAnalysisJob({ ownerId: OWNER_A, postId: "stale-post" });
    await prisma.post.update({ where: { id: "stale-post" }, data: { mainTheme: "Cuisine" } });
    const resolver = new FakeResolver({ "Nobu Dubai": [resolved()] });

    await expect(
      analysis.analyzeCandidateBatchRecord({ ownerId: OWNER_A, record, resolver, commit: true }),
    ).rejects.toMatchObject({ code: "POST_NOT_PLACES_ELIGIBLE" });

    const refreshed = await prisma.placeAnalysisJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(refreshed.status).toBe("CANCELLED");
    expect(await prisma.place.count({ where: { ownerId: OWNER_A } })).toBe(0);
  });

  it("never overwrites a user-confirmed link", async () => {
    await seedPost("confirmed-post", OWNER_A, "Voyages");
    const place = await prisma.place.create({
      data: {
        ownerId: OWNER_A,
        displayName: "Nobu Dubai",
        normalizedName: "nobu dubai",
        provider: "geoapify",
        providerPlaceId: "geo-nobu",
        latitude: 25.13,
        longitude: 55.11,
        precision: "EXACT",
        confidence: 1,
      },
    });
    await prisma.postPlace.create({
      data: { ownerId: OWNER_A, postId: "confirmed-post", placeId: place.id, isPrimary: true, isUserConfirmed: true, precision: "EXACT", confidence: 1 },
    });

    const resolver = new FakeResolver({ "Nobu Dubai": [resolved({ providerRank: 0.5 })] });
    await analysis.analyzeCandidateBatchRecord({
      ownerId: OWNER_A,
      record: await freshRecord(OWNER_A, "confirmed-post", [candidate({ confidence: 0.6 })]),
      resolver,
      commit: true,
    });

    const link = await prisma.postPlace.findFirstOrThrow({ where: { ownerId: OWNER_A } });
    expect(link.isUserConfirmed).toBe(true);
    expect(link.confidence).toBe(1);
    expect(link.isPrimary).toBe(true);
  });

  it("supersedes only the previous automatic approximate primary when an exact primary is persisted", async () => {
    for (const [postId, confirmed] of [
      ["upgrade-auto-post", false],
      ["upgrade-confirmed-post", true],
    ] as const) {
      await seedPost(postId, OWNER_A, "Voyages");
      const oldPlace = await prisma.place.create({
        data: {
          ownerId: OWNER_A,
          displayName: "Dubai",
          normalizedName: "dubai",
          provider: "geoapify",
          providerPlaceId: `geo-old-${postId}`,
          city: "Dubai",
          latitude: 25.2,
          longitude: 55.3,
          precision: "APPROXIMATE",
          confidence: 0.7,
          approximationRadiusMeters: 10_000,
        },
      });
      await prisma.postPlace.create({
        data: {
          ownerId: OWNER_A,
          postId,
          placeId: oldPlace.id,
          isPrimary: true,
          isUserConfirmed: confirmed,
          precision: "APPROXIMATE",
          confidence: 0.7,
        },
      });

      await analysis.analyzeCandidateBatchRecord({
        ownerId: OWNER_A,
        record: await freshRecord(OWNER_A, postId, [candidate()]),
        resolver: new FakeResolver({
          "Nobu Dubai": [resolved({ providerPlaceId: `geo-exact-${postId}` })],
        }),
        commit: true,
      });
    }

    const automaticLinks = await prisma.postPlace.findMany({
      where: { ownerId: OWNER_A, postId: "upgrade-auto-post" },
      orderBy: { precision: "asc" },
    });
    expect(automaticLinks).toHaveLength(1);
    expect(automaticLinks[0]).toMatchObject({
      precision: "EXACT",
      isPrimary: true,
      isUserConfirmed: false,
    });

    const confirmedLinks = await prisma.postPlace.findMany({
      where: { ownerId: OWNER_A, postId: "upgrade-confirmed-post" },
    });
    expect(confirmedLinks).toHaveLength(2);
    expect(confirmedLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          precision: "APPROXIMATE",
          isPrimary: true,
          isUserConfirmed: true,
        }),
        expect.objectContaining({
          precision: "EXACT",
          isPrimary: false,
          isUserConfirmed: false,
        }),
      ]),
    );
    expect(await prisma.place.count({ where: { ownerId: OWNER_A } })).toBe(4);
  });

  it("rolls back and marks the job FAILED on a provider failure", async () => {
    await seedPost("fail-post", OWNER_A, "Voyages");
    const record = await freshRecord(OWNER_A, "fail-post", [candidate()]);
    const resolver = new FakeResolver({}, Object.assign(new Error("GEOAPIFY_UNAVAILABLE"), { code: "GEOAPIFY_UNAVAILABLE" }));

    await expect(
      analysis.analyzeCandidateBatchRecord({ ownerId: OWNER_A, record, resolver, commit: true }),
    ).rejects.toThrow();

    expect(await prisma.place.count({ where: { ownerId: OWNER_A } })).toBe(0);
    const job = await prisma.placeAnalysisJob.findFirstOrThrow({ where: { ownerId: OWNER_A } });
    expect(job.status).toBe("FAILED");
    expect(job.errorCode).toBe("GEOAPIFY_UNAVAILABLE");
  });

  it("isolates analysis by owner", async () => {
    await seedPost("owned-post", OWNER_A, "Voyages");
    const record = await freshRecord(OWNER_A, "owned-post", [candidate()]);
    const resolver = new FakeResolver({ "Nobu Dubai": [resolved()] });

    await expect(
      analysis.analyzeCandidateBatchRecord({ ownerId: OWNER_B, record, resolver, commit: true }),
    ).rejects.toMatchObject({ code: "POST_NOT_FOUND" });
    expect(await prisma.place.count({ where: { ownerId: OWNER_B } })).toBe(0);
  });

  it("writes nothing in dry-run mode", async () => {
    await seedPost("dry-post", OWNER_A, "Voyages");
    const resolver = new FakeResolver({ "Nobu Dubai": [resolved()] });

    const result = await analysis.analyzeCandidateBatchRecord({
      ownerId: OWNER_A,
      record: await freshRecord(OWNER_A, "dry-post", [candidate()]),
      resolver,
      commit: false,
    });

    expect(result.status).toBe("SKIPPED_DRY_RUN");
    expect(result.placesPersisted).toBe(1);
    expect(await prisma.place.count({ where: { ownerId: OWNER_A } })).toBe(0);
    expect(await prisma.placeAnalysisJob.count({ where: { ownerId: OWNER_A } })).toBe(0);
  });

  it("is idempotent when committed twice", async () => {
    await seedPost("idem-post", OWNER_A, "Voyages");
    const resolver = new FakeResolver({ "Nobu Dubai": [resolved()] });
    const record = await freshRecord(OWNER_A, "idem-post", [candidate()]);

    await analysis.analyzeCandidateBatchRecord({ ownerId: OWNER_A, record, resolver, commit: true });
    await analysis.analyzeCandidateBatchRecord({ ownerId: OWNER_A, record, resolver, commit: true });

    expect(await prisma.place.count({ where: { ownerId: OWNER_A } })).toBe(1);
    expect(await prisma.postPlace.count({ where: { ownerId: OWNER_A } })).toBe(1);
    expect(await prisma.placeAnalysisJob.count({ where: { ownerId: OWNER_A } })).toBe(1);
    // Evidence is rebuilt, not duplicated: one CAPTION + one PROVIDER_MATCH.
    expect(await prisma.placeEvidence.count({ where: { ownerId: OWNER_A } })).toBe(2);
  });
});

let postCounter = 0;

async function seedPost(id: string, ownerId: string, mainTheme: string): Promise<void> {
  postCounter += 1;
  await prisma.post.create({
    data: {
      id,
      ownerId,
      postUrl: `https://instagram.com/p/PA${postCounter}`,
      thumbnailUrl: "https://example.com/t.jpg",
      authorUsername: "alice",
      authorSortKey: "alice",
      caption: "A trip",
      searchText: "alice trip",
      contentType: "IMAGE",
      mainTheme,
    },
  });
}

async function resetDatabase(): Promise<void> {
  const owners = { ownerId: { in: [OWNER_A, OWNER_B] } };
  await prisma.post.deleteMany({ where: owners });
  await prisma.place.deleteMany({ where: owners });
}
