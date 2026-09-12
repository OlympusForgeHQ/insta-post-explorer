import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RefreshPostsButton, RefreshPostsControl, useRefreshPosts } from "@/features/library/components/refresh-posts-button";

const CHANNEL = "INSTA_POST_EXPLORER_SYNC_V2";

function dispatchExtensionMessage(data: Record<string, unknown>) {
  const event = new MessageEvent("message", {
    data,
    origin: window.location.origin,
  });
  Object.defineProperty(event, "source", { value: window });
  window.dispatchEvent(event);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const regressionRequestId = "00000000-0000-4000-8000-000000000003";
function activeExtension(task: Record<string, unknown>) {
  dispatchExtensionMessage({channel: CHANNEL, type: "STATE", requestId: regressionRequestId,
    payload: {extensionId: "extension-1", ok: true, task}});
}
async function startRegressionRun() {
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(regressionRequestId);
  act(() => dispatchExtensionMessage({channel: CHANNEL, type: "EXTENSION_READY", payload: {extensionId: "extension-1", version: "4.2.8"}}));
  fireEvent.click(screen.getByText("Actualiser les posts"));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  act(() => {
    dispatchExtensionMessage({channel: CHANNEL, type: "START_RESULT", requestId: regressionRequestId,
      payload: {extensionId: "extension-1", ok: true}});
    activeExtension({status: "running", progressVersion: 0, stats: {synced: 0}});
  });
}
function regressionApi() {
  let jobStatus = "RUNNING";
  let rejectHeartbeat = false;
  let failTerminalRead = false;
  let statusOnRejection = "COMPLETED";
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    calls.push(url);
    if (url === "/api/sync/session") return Response.json({jobId: "job-regression", token: "test-token", apiBaseUrl: window.location.origin,
      knownExternalIds: [], knownPostCodes: [], expiresInSeconds: 86_400}, {status: 201});
    if (url === "/api/sync/heartbeat") {
      if (rejectHeartbeat) {jobStatus = statusOnRejection; return Response.json({}, {status: 401});}
      return Response.json({ok: true});
    }
    if (url === "/api/sync/complete") return Response.json({ok: true});
    if (url === "/api/sync/jobs/job-regression") {
      if (jobStatus === "COMPLETED" && failTerminalRead) {failTerminalRead = false; return Response.json({}, {status: 503});}
      return Response.json({id: "job-regression", status: jobStatus, collected: jobStatus === "COMPLETED" ? 3 : 0,
        heartbeatAt: "2026-07-28T12:00:00.000Z"});
    }
    throw new Error("Unexpected sync request");
  });
  vi.stubGlobal("fetch", fetchMock);
  return {calls, rejectLease() {rejectHeartbeat = true; statusOnRejection = "RUNNING";}, complete() {jobStatus = "COMPLETED";}, raceCompletion(transientRead: boolean) {rejectHeartbeat = true; failTerminalRead = transientRead;}};
}
function PersistentMenuController({visible, onCompleted}: {visible: boolean; onCompleted: () => void}) {
  const controller = useRefreshPosts(onCompleted);
  return <DropdownMenu.Root open={visible}>
    <DropdownMenu.Trigger>Administration</DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content><RefreshPostsControl controller={controller} menuItem /></DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>;
}

describe("RefreshPostsButton", () => {
  it("keeps the controller alive while the Radix menu closes and onCompleted changes", async () => {
    vi.useFakeTimers();
    const api = regressionApi(); const firstCallback = vi.fn(); const latestCallback = vi.fn();
    const view = render(<PersistentMenuController visible onCompleted={() => firstCallback()} />);
    await startRegressionRun();
    view.rerender(<PersistentMenuController visible={false} onCompleted={() => latestCallback()} />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await act(async () => {await vi.advanceTimersByTimeAsync(32_000);});
    expect(api.calls).toContain("/api/sync/heartbeat");
    api.complete();
    await act(async () => {await vi.advanceTimersByTimeAsync(2_000);});
    expect(latestCallback).toHaveBeenCalledTimes(1);
    expect(firstCallback).not.toHaveBeenCalled();
    expect(api.calls).not.toContain("/api/sync/complete");
  });

  it("renews through a planned Instagram pause and detects a stall only after its resume deadline", async () => {
    vi.useFakeTimers();
    const api = regressionApi(); render(<RefreshPostsButton onCompleted={vi.fn()} />);
    await startRegressionRun();
    act(() => activeExtension({status: "paused", resumeAt: new Date(Date.now() + 600_000).toISOString(),
      pausedReason: {note: "Limite temporaire Instagram"}, progressVersion: 1, stats: {synced: 0}}));
    await act(async () => {await vi.advanceTimersByTimeAsync(660_000);});
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Reprise automatique");
    expect(api.calls.filter(url => url === "/api/sync/heartbeat").length).toBeGreaterThan(15);
    expect(api.calls).not.toContain("/api/sync/complete");
    await act(async () => {await vi.advanceTimersByTimeAsync(32_000);});
    expect(screen.getByRole("alert")).toHaveTextContent("La synchronisation ne répond plus");
    expect(api.calls).toContain("/api/sync/complete");
  });

  it.each([false, true])("confirms a completed job when heartbeat rejection races completion (transient read: %s)", async (transientRead) => {
    vi.useFakeTimers(); const api = regressionApi(); const onCompleted = vi.fn();
    render(<RefreshPostsButton onCompleted={onCompleted} />);
    await startRegressionRun(); api.raceCompletion(transientRead);
    await act(async () => {await vi.advanceTimersByTimeAsync(34_000);});
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("3 synchronisés")).toBeVisible();
    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(api.calls).not.toContain("/api/sync/complete");
  });

  it("reports a rejected lease when the authoritative re-read confirms a nonterminal job", async () => {
    vi.useFakeTimers(); const api = regressionApi(); const onCompleted = vi.fn();
    render(<RefreshPostsButton onCompleted={onCompleted} />);
    await startRegressionRun(); api.rejectLease();
    await act(async () => {await vi.advanceTimersByTimeAsync(32_000);});
    expect(screen.getByRole("alert")).toHaveTextContent("La session de synchronisation a expiré");
    expect(onCompleted).not.toHaveBeenCalled();
    expect(api.calls).toContain("/api/sync/complete");
  });

  it.each(["invalid-date", "beyond-token"])("rejects an unbounded planned pause (%s)", async (resumeAt) => {
    vi.useFakeTimers(); const api = regressionApi();
    render(<RefreshPostsButton onCompleted={vi.fn()} />);
    await startRegressionRun();
    act(() => activeExtension({status: "paused", resumeAt: resumeAt === "beyond-token" ? new Date(Date.now() + 86_400_001).toISOString() : resumeAt}));
    expect(screen.getByRole("alert")).toHaveTextContent("La pause dépasse la durée de cette session");
    expect(api.calls).toContain("/api/sync/complete");
  });

  it("explains a server-side conflict without starting a second extension run", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "SYNC_IN_PROGRESS" }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<RefreshPostsButton onCompleted={() => {}} />);
    dispatchExtensionMessage({ channel: CHANNEL, type: "EXTENSION_READY", payload: { extensionId: "extension-1", version: "4.2.8" } });
    fireEvent.click(screen.getByRole("button", { name: "Actualiser les posts" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Une synchronisation est déjà en cours");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("settles from the server job when the terminal extension message is lost", async () => {
    const onCompleted = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "job-1",
        token: "test-token",
        apiBaseUrl: window.location.origin,
        knownExternalIds: [],
        knownPostCodes: [],
      }), { status: 201, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "job-1",
        status: "COMPLETED",
        collected: 2,
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");

    render(<RefreshPostsButton onCompleted={onCompleted} />);
    dispatchExtensionMessage({
      channel: CHANNEL,
      type: "EXTENSION_READY",
      payload: { extensionId: "extension-1", version: "4.2.4" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Actualiser les posts" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/sync/jobs/job-1", expect.objectContaining({
        cache: "no-store",
      }));
    });
    expect(await screen.findByText("2 synchronisés")).toBeVisible();

    dispatchExtensionMessage({
      channel: CHANNEL,
      type: "STATE",
      requestId: "00000000-0000-4000-8000-000000000001",
      payload: {
        extensionId: "extension-1",
        ok: true,
        task: { status: "completed", stats: { synced: 2 } },
      },
    });
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it("times out repeated running snapshots that make no task progress", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "job-stalled",
        token: "test-token",
        apiBaseUrl: window.location.origin,
        knownExternalIds: [],
        knownPostCodes: [],
      }), { status: 201, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValue(new Response(JSON.stringify({
        id: "job-stalled",
        status: "RUNNING",
        heartbeatAt: "2026-07-28T12:00:00.000Z",
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000002");

    render(<RefreshPostsButton onCompleted={vi.fn()} />);
    dispatchExtensionMessage({
      channel: CHANNEL,
      type: "EXTENSION_READY",
      payload: { extensionId: "extension-1", version: "4.2.6" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Actualiser les posts" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const runningSnapshot = (progressVersion: number) => ({
      channel: CHANNEL,
      type: "STATE",
      requestId: "00000000-0000-4000-8000-000000000002",
      payload: {
        extensionId: "extension-1",
        ok: true,
        task: {
          status: "running",
          processedCount: 0,
          progressVersion,
          stats: { synced: 0 },
        },
      },
    });
    dispatchExtensionMessage({
      channel: CHANNEL,
      type: "START_RESULT",
      requestId: "00000000-0000-4000-8000-000000000002",
      payload: { extensionId: "extension-1", ok: true },
    });
    dispatchExtensionMessage(runningSnapshot(0));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      dispatchExtensionMessage(runningSnapshot(1));
      await vi.advanceTimersByTimeAsync(30_000);
      dispatchExtensionMessage(runningSnapshot(1));
      await vi.advanceTimersByTimeAsync(30_000);
      dispatchExtensionMessage(runningSnapshot(1));
      await vi.advanceTimersByTimeAsync(40_000);
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/sync/heartbeat", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/sync/complete", expect.objectContaining({ body: expect.stringContaining("MANUAL_SYNC_INTERRUPTED") }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "La synchronisation ne répond plus. Rechargez la page puis réessayez.",
    );
  });
});
