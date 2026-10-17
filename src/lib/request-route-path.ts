import type { FastifyRequest } from "fastify";

/** Judge authorization by the route selected by Fastify, never the raw URL. */
export function requestRoutePath(request: Pick<FastifyRequest, "routeOptions">): string {
    const route = request.routeOptions?.url;
    return typeof route === "string" && route.startsWith("/") ? route : "";
}
