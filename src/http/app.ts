import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";

import { AmbiguousResultError } from "../db/errors.js";
import { ReservationNotFoundError, SeatOccupiedError } from "../reservations/service.js";
import type { CreateSeatInput, Reservation, ReserveInput, Seat } from "../reservations/types.js";
import { createSeatSchema, operationParamsSchema, reserveSchema } from "./validation.js";

export interface ReservationServiceLike {
  createSeat(input: CreateSeatInput): Promise<Seat>;
  reserve(input: ReserveInput): Promise<Reservation>;
  get(operationId: string): Promise<Reservation>;
}

export interface AppDependencies {
  service: ReservationServiceLike;
  healthCheck: () => Promise<void>;
}

export function createApp({ service, healthCheck }: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));

  app.get("/health", async (_request, response) => {
    try {
      await healthCheck();
      response.json({ status: "ok" });
    } catch {
      response.status(503).json({ error: "service_unavailable" });
    }
  });

  app.post("/seats", async (request, response) => {
    const input = createSeatSchema.parse(request.body);
    const seat = await service.createSeat(input);
    response.status(201).json(seat);
  });

  app.post("/reservations", async (request, response) => {
    const input = reserveSchema.parse(request.body);
    try {
      const reservation = await service.reserve(input);
      response.status(201).json(reservation);
    } catch (error) {
      if (error instanceof AmbiguousResultError) {
        response.status(503).json({
          error: "ambiguous_result",
          operationId: input.operationId,
          reconcileAt: `/reservations/${input.operationId}`,
        });
        return;
      }
      throw error;
    }
  });

  app.get("/reservations/:operationId", async (request, response) => {
    const { operationId } = operationParamsSchema.parse(request.params);
    response.json(await service.get(operationId));
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof ZodError || (error instanceof SyntaxError && "body" in error)) {
      response.status(400).json({ error: "invalid_request" });
      return;
    }
    if (error instanceof SeatOccupiedError) {
      response.status(409).json({ error: "seat_occupied" });
      return;
    }
    if (error instanceof ReservationNotFoundError) {
      response.status(404).json({ error: "not_found" });
      return;
    }

    response.status(500).json({ error: "internal_error" });
  });

  return app;
}
