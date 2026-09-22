export interface Seat {
  id: string;
  label: string;
  reservedBy: string | null;
  createdAt: Date;
}

export interface Reservation {
  operationId: string;
  seatId: string;
  userId: string;
  createdAt: Date;
}

export interface CreateSeatInput {
  id: string;
  label: string;
}

export interface ReserveInput {
  operationId: string;
  seatId: string;
  userId: string;
}
