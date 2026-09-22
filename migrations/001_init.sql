CREATE TABLE IF NOT EXISTS seats (
  id UUID PRIMARY KEY,
  label STRING NOT NULL UNIQUE,
  reserved_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reservations (
  operation_id UUID PRIMARY KEY,
  seat_id UUID NOT NULL REFERENCES seats (id),
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT one_reservation_per_seat UNIQUE (seat_id)
);
