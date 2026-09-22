import { z } from "zod";

const uuid = z.uuid();

export const createSeatSchema = z.object({
  id: uuid,
  label: z.string().trim().min(1).max(100),
});

export const reserveSchema = z.object({
  operationId: uuid,
  seatId: uuid,
  userId: uuid,
});

export const operationParamsSchema = z.object({
  operationId: uuid,
});
