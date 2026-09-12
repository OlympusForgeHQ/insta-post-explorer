import { AuthConfigurationError } from "@/auth/config";
import {
  requireSyncAutomationKey,
  SyncAutomationUnauthorizedError,
  SyncAutomationUnavailableError,
} from "@/auth/sync-automation";
import { externalApiError, externalApiErrorResponse, externalApiJson } from "@/contracts/api/error";
import { createSyncSession } from "@/server/create-sync-session";
import { SyncAdmissionError } from "@/server/sync-runs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const authorization = requireSyncAutomationKey(request);
    const session = await createSyncSession({
      ownerId: authorization.ownerId,
      apiBaseUrl: authorization.apiBaseUrl,
      automationKeyId: authorization.keyId,
    });
    return externalApiJson(session, { status: 201 });
  } catch (error) {
    if (error instanceof SyncAdmissionError) {
      return externalApiError(error.code, "Synchronization cannot start now", 409);
    }
    if (error instanceof SyncAutomationUnauthorizedError) {
      return externalApiError("UNAUTHORIZED", "Invalid or missing sync credential", 401);
    }
    if (error instanceof SyncAutomationUnavailableError || error instanceof AuthConfigurationError) {
      return externalApiError("SERVICE_UNAVAILABLE", "Automatic sync is unavailable", 503);
    }
    return externalApiErrorResponse(error);
  }
}
