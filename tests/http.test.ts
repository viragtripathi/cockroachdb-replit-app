import request from "supertest";
import { beforeEach, describe, expect, test, vi, type Mock } from "vitest";

import { AmbiguousResultError } from "../src/db/errors.js";
import { createApp, type ReservationServiceLike } from "../src/http/app.js";
import { ReservationNotFoundError, SeatOccupiedError } from "../src/reservations/service.js";

const seatId = "20000000-0000-4000-8000-000000000002";
const operationId = "10000000-0000-4000-8000-000000000001";
const userId = "30000000-0000-4000-8000-000000000003";
const createdAt = new Date("2026-09-22T12:00:00.000Z");

const seat = { id: seatId, label: "A-1", reservedBy: null, createdAt };
const reservation = { operationId, seatId, userId, createdAt };

describe("HTTP API", () => {
  let service: ReservationServiceLike;
  let healthCheck: Mock<() => Promise<void>>;

  beforeEach(() => {
    service = {
      createSeat: vi.fn(async () => seat),
      reserve: vi.fn(async () => reservation),
      get: vi.fn(async () => reservation),
    };
    healthCheck = vi.fn(async () => undefined);
  });

  test("reports database-backed health", async () => {
    const response = await request(createApp({ service, healthCheck })).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(healthCheck).toHaveBeenCalledOnce();
  });

  test("returns 503 when the database health check fails", async () => {
    healthCheck.mockRejectedValue(new Error("connection includes a secret"));

    const response = await request(createApp({ service, healthCheck })).get("/health");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "service_unavailable" });
    expect(response.text).not.toContain("secret");
  });

  test("creates a seat from valid input", async () => {
    const response = await request(createApp({ service, healthCheck }))
      .post("/seats")
      .send({ id: seatId, label: "A-1" });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ ...seat, createdAt: createdAt.toISOString() });
    expect(service.createSeat).toHaveBeenCalledWith({ id: seatId, label: "A-1" });
  });

  test("rejects invalid seat input", async () => {
    const response = await request(createApp({ service, healthCheck }))
      .post("/seats")
      .send({ id: "not-a-uuid", label: "" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "invalid_request" });
    expect(service.createSeat).not.toHaveBeenCalled();
  });

  test("creates and idempotently repeats a reservation", async () => {
    const app = createApp({ service, healthCheck });
    const body = { operationId, seatId, userId };

    const first = await request(app).post("/reservations").send(body);
    const repeated = await request(app).post("/reservations").send(body);

    expect(first.status).toBe(201);
    expect(repeated.status).toBe(201);
    expect(repeated.body).toEqual(first.body);
    expect(service.reserve).toHaveBeenCalledTimes(2);
  });

  test("maps an occupied seat to conflict", async () => {
    vi.mocked(service.reserve).mockRejectedValue(new SeatOccupiedError(seatId));

    const response = await request(createApp({ service, healthCheck }))
      .post("/reservations")
      .send({ operationId, seatId, userId });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "seat_occupied" });
  });

  test("maps an unknown reservation to not found", async () => {
    vi.mocked(service.get).mockRejectedValue(
      new ReservationNotFoundError("reservation", operationId),
    );

    const response = await request(createApp({ service, healthCheck })).get(
      `/reservations/${operationId}`,
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "not_found" });
  });

  test("tells the caller to reconcile an ambiguous commit by operation ID", async () => {
    vi.mocked(service.reserve).mockRejectedValue(
      new AmbiguousResultError(Object.assign(new Error("driver details"), { code: "40003" })),
    );

    const response = await request(createApp({ service, healthCheck }))
      .post("/reservations")
      .send({ operationId, seatId, userId });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: "ambiguous_result",
      operationId,
      reconcileAt: `/reservations/${operationId}`,
    });
    expect(response.text).not.toContain("driver details");
  });

  test("sanitizes unexpected errors", async () => {
    vi.mocked(service.createSeat).mockRejectedValue(
      new Error("sensitive driver details for private-host"),
    );

    const response = await request(createApp({ service, healthCheck }))
      .post("/seats")
      .send({ id: seatId, label: "A-1" });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "internal_error" });
    expect(response.text).not.toContain("sensitive driver details");
    expect(response.text).not.toContain("private-host");
  });
});
