import type { PoolClientLike, PoolLike } from "../db/contracts.js";
import { executeTx, type ExecuteTxOptions } from "../db/retry.js";
import type { CreateSeatInput, Reservation, ReserveInput, Seat } from "./types.js";

const reservationColumns = `
  operation_id AS "operationId",
  seat_id AS "seatId",
  user_id AS "userId",
  created_at AS "createdAt"`;

export class SeatOccupiedError extends Error {
  constructor(readonly seatId: string) {
    super("The seat is already reserved");
    this.name = "SeatOccupiedError";
  }
}

export class ReservationNotFoundError extends Error {
  constructor(readonly resource: "seat" | "reservation", readonly id: string) {
    super(`${resource === "seat" ? "Seat" : "Reservation"} not found`);
    this.name = "ReservationNotFoundError";
  }
}

async function withClient<Result>(
  pool: PoolLike,
  operation: (client: PoolClientLike) => Promise<Result>,
): Promise<Result> {
  const client = await pool.connect();
  try {
    return await operation(client);
  } finally {
    client.release();
  }
}

export class ReservationService {
  constructor(
    private readonly pool: PoolLike,
    private readonly retryOptions: ExecuteTxOptions = {},
  ) {}

  async createSeat(input: CreateSeatInput): Promise<Seat> {
    return withClient(this.pool, async (client) => {
      const result = await client.query<Seat>(
        `INSERT INTO seats (id, label)
         VALUES ($1, $2)
         RETURNING id, label, reserved_by AS "reservedBy", created_at AS "createdAt"`,
        [input.id, input.label],
      );
      return result.rows[0] as Seat;
    });
  }

  async reserve(input: ReserveInput): Promise<Reservation> {
    return executeTx(
      this.pool,
      async (client) => {
        const existing = await client.query<Reservation>(
          `SELECT ${reservationColumns}
           FROM reservations
           WHERE operation_id = $1`,
          [input.operationId],
        );
        if (existing.rows[0] !== undefined) {
          return existing.rows[0];
        }

        const seatResult = await client.query<Pick<Seat, "id" | "label" | "reservedBy">>(
          `SELECT id, label, reserved_by AS "reservedBy"
           FROM seats
           WHERE id = $1
           FOR UPDATE`,
          [input.seatId],
        );
        const seat = seatResult.rows[0];
        if (seat === undefined) {
          throw new ReservationNotFoundError("seat", input.seatId);
        }
        if (seat.reservedBy !== null) {
          throw new SeatOccupiedError(input.seatId);
        }

        const inserted = await client.query<Reservation>(
          `INSERT INTO reservations (operation_id, seat_id, user_id)
           VALUES ($1, $2, $3)
           RETURNING ${reservationColumns}`,
          [input.operationId, input.seatId, input.userId],
        );
        await client.query(
          `UPDATE seats
           SET reserved_by = $1
           WHERE id = $2`,
          [input.userId, input.seatId],
        );

        return inserted.rows[0] as Reservation;
      },
      this.retryOptions,
    );
  }

  async get(operationId: string): Promise<Reservation> {
    return withClient(this.pool, async (client) => {
      const result = await client.query<Reservation>(
        `SELECT ${reservationColumns}
         FROM reservations
         WHERE operation_id = $1`,
        [operationId],
      );
      const reservation = result.rows[0];
      if (reservation === undefined) {
        throw new ReservationNotFoundError("reservation", operationId);
      }
      return reservation;
    });
  }
}
