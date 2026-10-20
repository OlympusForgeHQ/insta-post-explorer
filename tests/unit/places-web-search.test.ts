// @vitest-environment node
import {afterEach, expect, it, vi} from 'vitest';
import type {PlaceResolutionInput} from '@/server/places/resolvers/types';
vi.mock('server-only', () => ({}));
import {OpenRouterPlaceAddressResearch} from '@/server/places/resolvers/web-search';

const input: PlaceResolutionInput = {
  candidate: {name: 'Example Bakery', address: null, city: 'New York', country: 'United States',
    region: null, category: 'patisserie', confidence: .8,
    evidence: [{type: 'CAPTION', excerpt: 'Private original caption'}]},
  sourceTheme: 'Restaurant',
};
type Claim = {name: string; address: string; city: string; country: string; postalCode: string | null; sourceUrl: string; quote: string};
type Citation = {type: string; url_citation: {url: string; title: string; content: string; start_index: number; end_index: number}};
function evidence(url: string, address = '1414 2nd Ave') {
  const quote = `Example Bakery is at ${address}, New York, NY 10021.`;
  const claim: Claim = {name: 'Example Bakery', address, city: 'New York', country: 'United States', postalCode: '10021', sourceUrl: url, quote};
  const citation: Citation = {type: 'url_citation', url_citation: {url, title: 'Example Bakery in New York', content: quote, start_index: 0, end_index: 0}};
  return {claim, citation};
}
function fixture() {
  return [evidence('https://cityeditorial.com/bakery'), evidence('https://localjournal.org/review', '1414 Second Avenue')];
}
function payload(rows = fixture()) {
  return {choices: [{finish_reason: 'stop', message: {
    content: JSON.stringify({businesses: rows.map(row => row.claim)}), annotations: rows.map(row => row.citation),
  }}]};
}
function client(value: unknown, config: Partial<ConstructorParameters<typeof OpenRouterPlaceAddressResearch>[0]> = {}) {
  return new OpenRouterPlaceAddressResearch({apiKey: 'test-secret', model: 'example/model',
    fetchImpl: async () => Response.json(value), ...config});
}
afterEach(() => vi.useRealTimers());

it('returns only corroborated textual addresses and sends only public candidate fields after reserving the request', async () => {
  const order: string[] = [];
  let request: RequestInit | undefined;
  const resolver = client(payload(), {
    reserveRequest: async () => {order.push('reserved');},
    fetchImpl: async (url, init) => {
      expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
      order.push('requested'); request = init;
      return Response.json(payload());
    },
  });
  const [result] = await resolver.search(input);
  expect(result).toMatchObject({name: 'Example Bakery', streetAddress: '1414 2nd Ave',
    city: 'New York', country: 'United States', postalCode: '10021',
    sources: fixture().map(row => ({url: row.claim.sourceUrl, excerpt: row.claim.quote, title: row.citation.url_citation.title}))});
  expect(Number.isNaN(Date.parse(result.researchedAt))).toBe(false);
  expect(order).toEqual(['reserved', 'requested']);
  expect(request?.redirect).toBe('error');
  const body = JSON.parse(request!.body as string);
  expect(body).toMatchObject({model: 'example/model', max_tokens: 3072, reasoning: {enabled: false},
    response_format: {type: 'json_object'}, plugins: [{id: 'web', engine: 'exa', max_results: 5}]});
  expect(body.messages[1].content).toBe(JSON.stringify({name: 'Example Bakery', city: 'New York', country: 'United States'}));
  expect(request!.body).not.toContain('Private original caption');
  expect(result).not.toHaveProperty('latitude');
});

it('anchors the complete name in the provider title and the address with postcode in one literal fragment', async () => {
  const rows = fixture();
  for (const row of rows) {
    row.claim.quote = `${row.claim.address}, NY 10021`;
    row.citation.url_citation.content = `An unrelated introduction\n[...]\n${row.claim.quote}\n[...]\nMore text`;
  }
  expect(await client(payload(rows)).search(input)).toHaveLength(1);
});

it('requires a city anchor for the address group while allowing a second independent name-and-street source', async () => {
  const rows = fixture();
  rows[1].claim.postalCode = null;
  rows[1].claim.quote = `Example Bakery is at ${rows[1].claim.address}.`;
  rows[1].citation.url_citation.title = 'Example Bakery opens';
  rows[1].citation.url_citation.content = rows[1].claim.quote;
  expect(await client(payload(rows)).search(input)).toHaveLength(1);
  rows[0].claim.postalCode = null;
  rows[0].claim.quote = `Example Bakery is at ${rows[0].claim.address}.`;
  rows[0].citation.url_citation.title = 'Example Bakery';
  rows[0].citation.url_citation.content = rows[0].claim.quote;
  await expect(client(payload(rows)).search(input)).rejects.toThrow('WEB_SEARCH_INCOMPLETE_EVIDENCE');
});

it('does not treat narrative after a completed address sentence as contradictory locality components', async () => {
  const rows = fixture();
  rows[1].claim.postalCode = null;
  rows[1].claim.quote = `Example Bakery is at ${rows[1].claim.address}.`;
  rows[1].citation.url_citation.content = `${rows[1].claim.quote} Then, one year later, a new shop opened.`;
  expect(await client(payload(rows)).search(input)).toHaveLength(1);
});

it('keeps an earlier narrative year separate from the literal street number', async () => {
  const rows = [evidence('https://cityeditorial.com/bakery', '35 Cedar Street'), evidence('https://localjournal.org/review', '35 Cedar St')];
  rows[1].claim.quote = 'In 2023, the family reopened Example Bakery in New York at 35 Cedar St.';
  rows[1].claim.postalCode = null;
  rows[1].citation.url_citation.content = rows[1].claim.quote;
  expect(await client(payload(rows)).search(input)).toHaveLength(1);
});

it('allows the closed New York alias NYC in a citation title while keeping the full street in one fragment', async () => {
  const rows = fixture();
  rows[1].claim.quote = 'Example Bakery is at 1414 Second Avenue.';
  rows[1].claim.postalCode = null;
  rows[1].citation.url_citation.content = rows[1].claim.quote;
  rows[1].citation.url_citation.title = 'Exploring NYC: Example Bakery';
  expect(await client(payload(rows)).search(input)).toHaveLength(1);
  rows[0].claim.postalCode = null;
  rows[0].claim.quote = `Example Bakery is at ${rows[0].claim.address}.`;
  rows[0].citation.url_citation.content = rows[0].claim.quote;
  rows[0].citation.url_citation.title = 'Example Bakery';
  rows[1].citation.url_citation.title = 'Exploring NY: Example Bakery';
  await expect(client(payload(rows)).search(input)).rejects.toThrow('WEB_SEARCH_INCOMPLETE_EVIDENCE');
});

it('makes at most one reserved follow-up for a public address that lacks a second source', async () => {
  const requests: RequestInit[] = [];
  let reserved = 0;
  const rows = fixture();
  const resolver = client(null, {reserveRequest: async () => {reserved++;},
    fetchImpl: async (_url, init) => {
      requests.push(init!);
      return Response.json(payload([rows[requests.length - 1]]));
    }});
  expect(await resolver.search(input)).toHaveLength(1);
  expect(reserved).toBe(2);
  expect(requests).toHaveLength(2);
  expect(JSON.parse(JSON.parse(requests[1].body as string).messages[1].content)).toEqual({
    name: 'Example Bakery', city: 'New York', country: 'United States', addresses: ['1414 2nd Ave'],
  });
});

it('uses an unselected citation to corroborate an already anchored address without trusting an invented model quote', async () => {
  const rows = fixture();
  const response = payload(rows);
  response.choices[0].message.content = JSON.stringify({businesses: [rows[0].claim]});
  let calls = 0;
  const result = await client(response, {fetchImpl: async () => {calls++; return Response.json(response);}}).search(input);
  expect(result[0].sources.map(source => source.url)).toEqual(rows.map(row => row.claim.sourceUrl));
  expect(result[0].sources[1].excerpt).toBe(rows[1].citation.url_citation.content);
  expect(calls).toBe(1);
  response.choices[0].message.content = JSON.stringify({businesses: [{...rows[0].claim, quote: 'Invented quotation'}]});
  await expect(client(response).search(input)).rejects.toThrow('WEB_SEARCH_INCOMPLETE_EVIDENCE');
});

it('rejects a contradictory postcode in an additional citation omitted by the model', async () => {
  const rows = fixture();
  rows[1].citation.url_citation.content = rows[1].citation.url_citation.content.replace('10021', '11221');
  const response = payload(rows);
  response.choices[0].message.content = JSON.stringify({businesses: [rows[0].claim]});
  await expect(client(response).search(input)).rejects.toThrow('WEB_SEARCH_INCOMPLETE_EVIDENCE');
});

it('rejects conflicting local postal codes regardless of claim order or nullable model postal fields', async () => {
  for (const reverse of [false, true]) {
    for (const omitBoth of [false, true]) {
      const rows = fixture();
      rows[1].claim.postalCode = null;
      rows[1].claim.quote = rows[1].claim.quote.replace('10021', '11221');
      rows[1].citation.url_citation.content = rows[1].claim.quote;
      if (omitBoth) rows[0].claim.postalCode = null;
      if (reverse) rows.reverse();
      await expect(client(payload(rows)).search(input)).rejects.toThrow('WEB_SEARCH_INCOMPLETE_EVIDENCE');
    }
  }
});

it('cannot reduce a known multiple-site hint to one researched branch and never sends hint coordinates', async () => {
  let calls = 0;
  const resolver = client(null, {fetchImpl: async (_url, init) => {
    calls++;
    expect(init!.body).not.toContain('latitude');
    expect(init!.body).not.toContain('longitude');
    if (calls === 2) {
      const message = JSON.parse(init!.body as string).messages[1].content;
      expect(message).toMatch(/^Find other current locations excluding known addresses/u);
      expect(message).toContain('1414 2nd Ave');
    }
    return Response.json(payload());
  }});
  await expect(resolver.search({...input, minimumSites: 2, proximity: {latitude: 40.7, longitude: -74}}))
    .rejects.toThrow('WEB_SEARCH_INCOMPLETE_EVIDENCE');
  expect(calls).toBe(2);
});

it.each([
  'invented quote', 'different URL', 'street split across fragments', 'city split across fragments',
  'ellipsis split', 'missing name', 'wrong house number', 'name suffix', 'wrong city', 'wrong country',
  'quote omits address', 'contradictory locality', 'contradictory country after city',
] as const)('rejects incomplete or misattributed evidence: %s', async kind => {
  const rows = fixture();
  for (const row of rows) {
    if (kind === 'invented quote') row.claim.quote = 'A generated claim that never appeared in the source';
    if (kind === 'different URL') row.claim.sourceUrl += '?invented=true';
    if (kind === 'street split across fragments') {
      row.claim.quote = '1414';
      row.citation.url_citation.content = 'Example Bakery, New York 1414 [...] 2nd Ave';
    }
    if (kind === 'city split across fragments' || kind === 'ellipsis split') {
      row.claim.postalCode = null;
      row.citation.url_citation.title = 'Example Bakery';
      row.claim.quote = `Example Bakery at ${row.claim.address}`;
      row.citation.url_citation.content = `${row.claim.quote}${kind === 'ellipsis split' ? '\n...\n' : ' [...] '}New York`;
    }
    if (kind === 'missing name') {
      row.citation.url_citation.title = 'Other Bakery';
      row.claim.quote = `${row.claim.address}, New York, NY 10021`;
      row.citation.url_citation.content = row.claim.quote;
    }
    if (kind === 'wrong house number') row.claim.address = '1415 2nd Ave';
    if (kind === 'name suffix') row.claim.name = 'Example Bakery Annex';
    if (kind === 'wrong city') row.claim.city = 'Newark';
    if (kind === 'wrong country') row.claim.country = 'Canada';
    if (kind === 'quote omits address') {
      row.claim.quote = 'Example Bakery review.';
      row.citation.url_citation.content += ` ${row.claim.quote}`;
    }
    if (kind === 'contradictory locality') {
      row.claim.postalCode = null;
      row.claim.quote = `Example Bakery is at ${row.claim.address}, Newark, United States.`;
      row.citation.url_citation.content = row.claim.quote;
    }
    if (kind === 'contradictory country after city') {
      row.claim.postalCode = null;
      row.claim.quote = `Example Bakery is at ${row.claim.address}, New York, Canada.`;
      row.citation.url_citation.content = row.claim.quote;
    }
  }
  await expect(client(payload(rows)).search(input)).rejects.toThrow('WEB_SEARCH_INCOMPLETE_EVIDENCE');
});

it.each([
  ['https://cityeditorial.com/one', 'https://food.cityeditorial.com/two'],
  ['https://news.editorial.co.uk/one', 'https://food.editorial.co.uk/two'],
  ['https://maps.apple.com/a', 'https://cityeditorial.com/one'],
  ['https://exa.ai/library/place/a', 'https://cityeditorial.com/one'],
  ['https://www.bing.com/maps/one', 'https://www.openstreetmap.org/node/123'],
  ['http://127.0.0.1/a', 'https://cityeditorial.com/one'],
  ['https://user:password@editorial.com/a', 'https://cityeditorial.com/one'],
])('does not treat duplicate ownership domains, maps or unsafe URLs as independent sources (%s)', async (first, second) => {
  const rows = [evidence(first), evidence(second)];
  await expect(client(payload(rows)).search(input)).rejects.toThrow('WEB_SEARCH_INCOMPLETE_EVIDENCE');
});

it('preserves multiple fully corroborated branches and rejects the entire result when another proposed branch lacks proof', async () => {
  const rows = [...fixture(), evidence('https://cityeditorial.com/other', '35 Cedar St')];
  await expect(client(payload(rows)).search(input)).rejects.toThrow('WEB_SEARCH_INCOMPLETE_EVIDENCE');
  rows.push(evidence('https://localjournal.org/other', '35 Cedar Street'));
  expect((await client(payload(rows)).search(input)).map(row => row.streetAddress)).toEqual(['1414 2nd Ave', '35 Cedar St']);
});

it('rejects unsupported postcodes and conflicting postcodes for the same address', async () => {
  for (const mode of ['unsupported', 'conflict']) {
    const rows = fixture();
    rows[1].claim.postalCode = '10022';
    if (mode === 'conflict') {
      rows[1].claim.quote = rows[1].claim.quote.replace('10021', '10022');
      rows[1].citation.url_citation.content = rows[1].claim.quote;
    }
    await expect(client(payload(rows)).search(input)).rejects.toThrow('WEB_SEARCH_INCOMPLETE_EVIDENCE');
  }
});

it('does not publish an unsupported postcode from a discarded claim even when two other sources establish the street', async () => {
  const rows = fixture();
  for (const row of rows) row.claim.postalCode = null;
  const invented = evidence('https://anotherpublication.com/bakery');
  invented.claim.postalCode = '10022';
  rows.push(invented);
  const result = await client(payload(rows)).search(input);
  expect(result[0].postalCode).toBeNull();
});

it('rejects malformed, truncated and uncited output without retrying', async () => {
  const variants = [
    {...payload(), choices: [{...payload().choices[0], finish_reason: 'length'}]},
    {...payload(), choices: [{finish_reason: 'stop', message: {content: null, annotations: []}}]},
    {...payload(), choices: [{finish_reason: 'stop', message: {content: '{"businesses":[],"extra":true}', annotations: []}}]},
    {...payload(), choices: [{finish_reason: 'stop', message: {content: '```json\n{"businesses":[]}\n```', annotations: []}}]},
  ];
  for (const value of variants) {
    let calls = 0;
    await expect(client(value, {fetchImpl: async () => {calls++; return Response.json(value);}}).search(input))
      .rejects.toThrow('WEB_SEARCH_INVALID_RESPONSE');
    expect(calls).toBe(1);
  }
  const missing = payload();
  missing.choices[0].message.annotations = [];
  await expect(client(missing).search(input)).rejects.toThrow('WEB_SEARCH_INCOMPLETE_EVIDENCE');
});

it('bounds the response stream and rejects HTTP errors without a second request', async () => {
  for (const response of [new Response('x'.repeat(512 * 1024 + 1)), new Response('', {status: 429})]) {
    let calls = 0;
    await expect(client(null, {fetchImpl: async () => {calls++; return response;}}).search(input))
      .rejects.toThrow(/WEB_SEARCH_(INVALID_RESPONSE|HTTP_429)/);
    expect(calls).toBe(1);
  }
});

it('applies a 20 second request deadline to both connection and response body', async () => {
  vi.useFakeTimers();
  for (const phase of ['connection', 'body']) {
    const resolver = client(null, {fetchImpl: async () => phase === 'connection'
      ? new Promise<Response>(() => {})
      : new Response(new ReadableStream({start() {}}))});
    const result = resolver.search(input);
    const assertion = expect(result).rejects.toThrow('WEB_SEARCH_UNAVAILABLE');
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
  }
});

it('keeps the combined reservation and research deadline within 45 seconds', async () => {
  vi.useFakeTimers();
  const resolver = client(payload(), {reserveRequest: () => new Promise<void>(() => {})});
  const result = resolver.search(input);
  const assertion = expect(result).rejects.toThrow('WEB_SEARCH_UNAVAILABLE');
  await vi.advanceTimersByTimeAsync(45_000);
  await assertion;
});

it('does not send a request without full public geography or when the budget reservation fails', async () => {
  let calls = 0;
  const resolver = client(payload(), {fetchImpl: async () => {calls++; return Response.json(payload());}});
  expect(await resolver.search({...input, candidate: {...input.candidate, country: null}})).toEqual([]);
  expect(await resolver.search({...input, candidate: {...input.candidate, name: null}})).toEqual([]);
  const denied = client(payload(), {reserveRequest: async () => {throw Error('BUDGET_EXHAUSTED');},
    fetchImpl: async () => {calls++; return Response.json(payload());}});
  await expect(denied.search(input)).rejects.toThrow('BUDGET_EXHAUSTED');
  expect(calls).toBe(0);
});
