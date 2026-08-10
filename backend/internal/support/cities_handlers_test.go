package support_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/support"
)

func TestCreateByRegion_UnknownRegion_Returns404(t *testing.T) {
	sessions, _, token := setupSession(t)
	h := &support.Handler{
		Service: &support.Service{
			Provinces: &fakeProvinces{codes: map[string]bool{"34": true}},
		},
	}

	mux := http.NewServeMux()
	mux.Handle("POST /v1/region/{il_code}/support", auth.RequireSession(sessions, nil, http.HandlerFunc(h.CreateByRegion)))

	for _, il := range []string{"99", "00", "ab", "not-a-city"} {
		t.Run(il, func(t *testing.T) {
			body, _ := json.Marshal(map[string]any{"credits": 5})
			req := httptest.NewRequest(http.MethodPost, "/v1/region/"+il+"/support", bytes.NewReader(body))
			req.Header.Set("Authorization", "Bearer "+token)
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)

			if rec.Code != http.StatusNotFound {
				t.Fatalf("status=%d want 404 body=%s", rec.Code, rec.Body.String())
			}
			var errBody map[string]string
			if err := json.NewDecoder(rec.Body).Decode(&errBody); err != nil {
				t.Fatal(err)
			}
			if errBody["error"] != support.ErrUnknownRegion.Error() {
				t.Fatalf("error=%q want unknown_region", errBody["error"])
			}
		})
	}
}

func TestCreateByRegion_InvalidCredits_Returns400(t *testing.T) {
	sessions, _, token := setupSession(t)
	h := &support.Handler{
		Service: &support.Service{
			Provinces: &fakeProvinces{codes: map[string]bool{"34": true}},
		},
	}

	mux := http.NewServeMux()
	mux.Handle("POST /v1/region/{il_code}/support", auth.RequireSession(sessions, nil, http.HandlerFunc(h.CreateByRegion)))

	body, _ := json.Marshal(map[string]any{"credits": 0})
	req := httptest.NewRequest(http.MethodPost, "/v1/region/34/support", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want 400 body=%s", rec.Code, rec.Body.String())
	}
}

func TestListCities_RequiresSession(t *testing.T) {
	h := &support.Handler{Cities: &support.CityStore{}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/cities", h.ListCities)

	req := httptest.NewRequest(http.MethodGet, "/v1/cities", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want 401", rec.Code)
	}
}
