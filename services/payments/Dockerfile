FROM golang:1.25-bookworm AS builder

WORKDIR /src

COPY services/payments/go.mod services/payments/go.sum ./
RUN go mod download

COPY services/payments/ ./
COPY services/payments/migrations/ /migrations/

RUN CGO_ENABLED=0 GOOS=linux go build -o /payments ./cmd

FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /
COPY --from=builder /payments /payments
COPY --from=builder /migrations /migrations

ENV MIGRATIONS_PATH=/migrations
EXPOSE 8081
USER nonroot:nonroot
ENTRYPOINT ["/payments"]
