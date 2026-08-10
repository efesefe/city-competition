#!/bin/bash
set -euo pipefail
# Create isolated payments database alongside the game DB (PCI process/pool boundary).
# Runs only on first Postgres data volume initialization.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
CREATE DATABASE citycomp_payments;
EOSQL
