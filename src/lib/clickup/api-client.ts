import { delay } from "@/lib/utils";

const CLICKUP_API_BASE = "https://api.clickup.com/api/v2";
// 650 ms between calls → ~92 req/min, safely under ClickUp's 100 req/min
// limit on Free/Unlimited plans. Business+ plans allow 1000 req/min.
const RATE_LIMIT_DELAY = 650;

// Retry policy:
//  - 429 (rate-limited)     → honor Retry-After header, else exponential backoff; retry forever.
//  - 5xx (server error)     → exponential backoff, up to MAX_SERVER_RETRIES.
//  - network/fetch failures → exponential backoff, up to MAX_NETWORK_RETRIES.
// The sync should never "give up" because of a transient problem; it must either
// succeed with correct data or raise an error that the caller can handle per-task.
const MAX_SERVER_RETRIES = 6;      // covers ~1 + 2 + 4 + 8 + 16 + 32 = 63 s of backoff
const MAX_NETWORK_RETRIES = 6;
const MAX_BACKOFF_MS = 60_000;

let lastCallTime = 0;

function backoffMs(attempt: number): number {
    return Math.min(MAX_BACKOFF_MS, 1000 * Math.pow(2, attempt));
}

function isRetriableNetworkError(err: unknown): boolean {
    // Node fetch surfaces socket/DNS/TLS issues as TypeError("fetch failed") with a .cause.
    const msg = (err as Error)?.message || "";
    const code = (err as any)?.cause?.code || (err as any)?.code || "";
    return (
        msg.includes("fetch failed") ||
        msg.includes("network") ||
        code === "ECONNRESET" ||
        code === "ECONNREFUSED" ||
        code === "ETIMEDOUT" ||
        code === "EAI_AGAIN" ||
        code === "ENOTFOUND" ||
        code === "ERR_SOCKET_CONNECTION_TIMEOUT" ||
        code === "UND_ERR_SOCKET" ||
        code === "UND_ERR_CONNECT_TIMEOUT"
    );
}

export async function clickupApi<T = any>(
    endpoint: string,
    options?: RequestInit,
): Promise<T> {
    const token = process.env.CLICKUP_API_TOKEN;
    if (!token) {
        throw new Error("CLICKUP_API_TOKEN environment variable is not set");
    }

    // Global rate limiter: 650 ms minimum between every call made by this process.
    const now = Date.now();
    const timeSinceLastCall = now - lastCallTime;
    if (timeSinceLastCall < RATE_LIMIT_DELAY) {
        await delay(RATE_LIMIT_DELAY - timeSinceLastCall);
    }
    lastCallTime = Date.now();

    const url = `${CLICKUP_API_BASE}${endpoint}`;

    let serverAttempt = 0;
    let networkAttempt = 0;
    let rateLimitAttempt = 0;

    while (true) {
        let response: Response;

        try {
            response = await fetch(url, {
                ...options,
                headers: {
                    Authorization: token,
                    "Content-Type": "application/json",
                    ...options?.headers,
                },
            });
        } catch (err) {
            if (isRetriableNetworkError(err) && networkAttempt < MAX_NETWORK_RETRIES) {
                const wait = backoffMs(networkAttempt);
                networkAttempt++;
                console.warn(
                    `[ClickUp] network error on ${endpoint}: ${(err as Error).message} — retry ${networkAttempt}/${MAX_NETWORK_RETRIES} in ${wait}ms`
                );
                await delay(wait);
                // Refresh rate-limit token window before retry.
                lastCallTime = Date.now();
                continue;
            }
            throw err;
        }

        // 429 — rate limited. Respect Retry-After, else exponential backoff.
        // We never give up on 429: by contract, any 429 is transient and eventually
        // clears. Logging each retry makes repeated hits visible.
        if (response.status === 429) {
            const retryAfterHeader = response.headers.get("Retry-After");
            let waitMs: number;
            if (retryAfterHeader) {
                const asNum = parseInt(retryAfterHeader, 10);
                waitMs = Number.isFinite(asNum) ? asNum * 1000 : 60_000;
            } else {
                waitMs = backoffMs(rateLimitAttempt);
            }
            rateLimitAttempt++;
            console.warn(
                `[ClickUp] 429 rate-limited on ${endpoint} — wait ${Math.round(waitMs / 1000)}s (attempt ${rateLimitAttempt})`
            );
            await delay(waitMs);
            lastCallTime = Date.now();
            continue;
        }

        // 5xx — server-side hiccup. Retry with backoff, bounded.
        if (response.status >= 500 && response.status < 600) {
            if (serverAttempt < MAX_SERVER_RETRIES) {
                const wait = backoffMs(serverAttempt);
                serverAttempt++;
                console.warn(
                    `[ClickUp] ${response.status} on ${endpoint} — retry ${serverAttempt}/${MAX_SERVER_RETRIES} in ${wait}ms`
                );
                await delay(wait);
                lastCallTime = Date.now();
                continue;
            }
        }

        if (!response.ok) {
            const errorBody = await response.text().catch(() => "No body");
            throw new Error(
                `ClickUp API error: ${response.status} ${response.statusText} - ${errorBody}`
            );
        }

        return response.json();
    }
}

export const WORKSPACE_ID = "9016734871";

export const TARGET_SPACE_IDS = [
    "90165582699", // New Production Line (PRIMARY)
    "90162701586", // Production (SECONDARY)
    "90165681655", // NB Media HQ (TERTIARY)
    "90166303898", // New Production 3D Documentry (QUATERNARY)
];
