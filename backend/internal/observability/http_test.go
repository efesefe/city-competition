package observability

import "testing"

func TestRouteGroup(t *testing.T) {
	cases := map[string]string{
		"/healthz":                 "system",
		"/metrics":                 "system",
		"/v1/auth/otp/request":     "auth",
		"/v1/support":              "support",
		"/v1/credits/balance":      "credits",
		"/v1/admin/derbies":        "admin",
		"/v1/account/erasure-request": "account",
		"/v1/charges":              "payments",
		"/unknown":                 "other",
	}
	for path, want := range cases {
		if got := RouteGroup(path); got != want {
			t.Fatalf("RouteGroup(%q)=%q want %q", path, got, want)
		}
	}
}
