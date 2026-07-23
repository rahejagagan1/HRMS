"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { mutate as globalMutate } from "swr";
import { useSession } from "next-auth/react";

type RealtimeEvent = {
    type: string;
    targetUserId?: number;
    data?: Record<string, unknown>;
    timestamp?: number;
};

type Handler = (event: RealtimeEvent) => void;

type RealtimeContextValue = {
    /** Subscribe to ALL events. Returns an unsubscribe fn. */
    subscribe: (handler: Handler) => () => void;
    /** True once the EventSource has received its `ready` greeting. */
    connected: boolean;
};

const RealtimeContext = createContext<RealtimeContextValue>({
    subscribe: () => () => {},
    connected: false,
});

export function RealtimeProvider({ children }: { children: ReactNode }) {
    const { status } = useSession();
    const handlersRef = useRef(new Set<Handler>());
    const [connected, setConnected] = useState(false);

    useEffect(() => {
        if (status !== "authenticated" || typeof window === "undefined") return;

        const es = new EventSource("/api/events");

        const onReady = () => setConnected(true);
        const onMessage = (msg: MessageEvent) => {
            try {
                const event = JSON.parse(msg.data) as RealtimeEvent;
                handlersRef.current.forEach((h) => {
                    try { h(event); } catch (err) { console.error("[realtime] handler threw:", err); }
                });
            } catch {
                // Ignore malformed payloads — heartbeats are comment lines and
                // never reach onmessage anyway.
            }
        };
        const onError = () => {
            // EventSource auto-reconnects (browser respects the `retry:` hint).
            // We just flag the UI as disconnected until the next `ready` event.
            setConnected(false);
        };

        es.addEventListener("ready", onReady);
        es.addEventListener("message", onMessage);
        es.addEventListener("error", onError);

        return () => {
            es.removeEventListener("ready", onReady);
            es.removeEventListener("message", onMessage);
            es.removeEventListener("error", onError);
            es.close();
            setConnected(false);
        };
    }, [status]);

    const subscribe = useCallback((handler: Handler) => {
        handlersRef.current.add(handler);
        return () => { handlersRef.current.delete(handler); };
    }, []);

    return (
        <RealtimeContext.Provider value={{ subscribe, connected }}>
            {children}
        </RealtimeContext.Provider>
    );
}

/** Subscribe to a single event type. */
export function useRealtimeEvent(type: string, handler: Handler) {
    const { subscribe } = useContext(RealtimeContext);
    useEffect(() => {
        return subscribe((event) => {
            if (event.type === type) handler(event);
        });
    }, [type, handler, subscribe]);
}

/**
 * The 90% case: when an event of `type` arrives, revalidate one or more SWR
 * keys. `keys` may be a string, array of strings, or a function that derives
 * keys from the event payload.
 *
 *   useRealtimeMutate("user.role.changed", (e) => `/api/users/${e.data?.userId}`);
 *   useRealtimeMutate("leave.approved",    ["/api/hr/inbox", "/api/hr/approvals/summary"]);
 */
export function useRealtimeMutate(
    type: string,
    keys: string | string[] | ((event: RealtimeEvent) => string | string[] | null | undefined),
) {
    useRealtimeEvent(type, (event) => {
        const resolved = typeof keys === "function" ? keys(event) : keys;
        if (!resolved) return;
        const list = Array.isArray(resolved) ? resolved : [resolved];
        list.forEach((key) => globalMutate(key));
    });
}

export function useRealtimeStatus() {
    return useContext(RealtimeContext).connected;
}
