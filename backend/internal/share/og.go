package share

import (
	"fmt"
	"net/http"
	"strings"
)

// SharePage handles GET /share/{public_id} with Open Graph meta tags for crawlers.
func (h *Handler) SharePage(w http.ResponseWriter, r *http.Request) {
	publicID := strings.TrimSpace(r.PathValue("public_id"))
	if publicID == "" {
		http.NotFound(w, r)
		return
	}
	a, err := h.Store.GetByPublicID(r.Context(), publicID)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	view := ToPublicView(a)
	scheme := "https"
	if r.TLS == nil {
		scheme = "http"
	}
	host := r.Host
	if host == "" {
		host = "localhost"
	}
	base := scheme + "://" + host
	ogImage := base + "/share/" + view.PublicID + "/og.png"
	pageURL := base + "/share/" + view.PublicID
	appLink := base + view.DeepLink

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = fmt.Fprintf(w, `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8"/>
<title>%s</title>
<meta property="og:title" content="%s"/>
<meta property="og:description" content="%s"/>
<meta property="og:image" content="%s"/>
<meta property="og:url" content="%s"/>
<meta property="og:type" content="website"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="%s"/>
<meta name="twitter:image" content="%s"/>
</head>
<body>
<main>
<h1>%s</h1>
<p>%s</p>
<p><a href="%s">Uygulamada aç</a></p>
</main>
</body>
</html>`,
		htmlEscape(view.Title),
		htmlEscape(view.Title),
		htmlEscape(view.Description),
		htmlEscape(ogImage),
		htmlEscape(pageURL),
		htmlEscape(view.Title),
		htmlEscape(ogImage),
		htmlEscape(view.Title),
		htmlEscape(view.Description),
		htmlEscape(appLink),
	)
}

// OGImage handles GET /share/{public_id}/og.png (SVG card).
func (h *Handler) OGImage(w http.ResponseWriter, r *http.Request) {
	publicID := strings.TrimSpace(r.PathValue("public_id"))
	if publicID == "" {
		http.NotFound(w, r)
		return
	}
	a, err := h.Store.GetByPublicID(r.Context(), publicID)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	view := ToPublicView(a)
	w.Header().Set("Content-Type", "image/svg+xml")
	_, _ = fmt.Fprintf(w, `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
<rect width="100%%" height="100%%" fill="#0f2e28"/>
<text x="60" y="200" fill="#f4e8c1" font-size="64" font-family="Georgia, serif">%s</text>
<text x="60" y="300" fill="#c4a35a" font-size="36" font-family="system-ui, sans-serif">%s</text>
<text x="60" y="560" fill="#8a9e96" font-size="28" font-family="system-ui, sans-serif">City Competition</text>
</svg>`, htmlEscape(view.Title), htmlEscape(view.Description))
}

func htmlEscape(s string) string {
	r := strings.NewReplacer(
		`&`, "&amp;",
		`<`, "&lt;",
		`>`, "&gt;",
		`"`, "&quot;",
	)
	return r.Replace(s)
}
