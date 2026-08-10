package migrate

import (
	"errors"
	"fmt"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	_ "github.com/golang-migrate/migrate/v4/source/file"
)

// Up applies payments-only migrations. Never touches the game schema.
func Up(databaseURL, migrationsPath string) error {
	dsn := rewriteScheme(databaseURL)
	m, err := migrate.New("file://"+migrationsPath, dsn)
	if err != nil {
		return fmt.Errorf("create payments migrator: %w", err)
	}
	defer m.Close()
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("payments migrate up: %w", err)
	}
	return nil
}

func rewriteScheme(databaseURL string) string {
	const from = "postgres://"
	const to = "pgx5://"
	if len(databaseURL) >= len(from) && databaseURL[:len(from)] == from {
		return to + databaseURL[len(from):]
	}
	const fromPQ = "postgresql://"
	if len(databaseURL) >= len(fromPQ) && databaseURL[:len(fromPQ)] == fromPQ {
		return to + databaseURL[len(fromPQ):]
	}
	return databaseURL
}
