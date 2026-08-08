FROM golang:1.22-bookworm AS builder

WORKDIR /src

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ ./
COPY migrations/ /migrations/

RUN CGO_ENABLED=0 GOOS=linux go build -o /api ./cmd/api

FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /
COPY --from=builder /api /api
COPY --from=builder /migrations /migrations

ENV MIGRATIONS_PATH=/migrations
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/api"]
