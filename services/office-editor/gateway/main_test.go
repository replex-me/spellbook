package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

func TestBrowserAssetPath(t *testing.T) {
	tests := []struct {
		name    string
		path    string
		rel     string
		version string
		ok      bool
	}{
		{name: "versioned", path: "/browser/abc123/bundle.js", rel: "bundle.js", version: "abc123", ok: true},
		{name: "nested", path: "/browser/abc123/images/icon.svg", rel: "images/icon.svg", version: "abc123", ok: true},
		{name: "admin dist", path: "/browser/dist/admin/admin.html", rel: "admin/admin.html", version: "dist", ok: true},
		{name: "outside", path: "/hosting/discovery", ok: false},
		{name: "traversal", path: "/browser/hash/../../etc/passwd", ok: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			rel, version, ok := browserAssetPath(test.path)
			if rel != test.rel || version != test.version || ok != test.ok {
				t.Fatalf("got (%q, %q, %v), want (%q, %q, %v)", rel, version, ok, test.rel, test.version, test.ok)
			}
		})
	}
}

func TestContainmentRequiresSandboxAndSeccomp(t *testing.T) {
	state := &containmentState{}
	state.observe("newchild?adms_contained=ok&adms_seccomp=none")
	secure, insecure := state.status()
	if secure || insecure {
		t.Fatalf("seccomp-less kit must not make the gateway ready")
	}
	state.observe("newchild?adms_seccomp=ok&adms_contained=ok")
	secure, insecure = state.status()
	if !secure || insecure {
		t.Fatalf("contained kit with seccomp should be accepted")
	}
	state.observe("newchild?adms_seccomp=ok&adms_contained=uncontained")
	secure, insecure = state.status()
	if secure || !insecure {
		t.Fatalf("an uncontained kit must fail closed")
	}
}

func TestRunHealthcheckRequiresOK(t *testing.T) {
	ready := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusOK)
	}))
	defer ready.Close()
	if err := runHealthcheck(ready.URL); err != nil {
		t.Fatalf("expected ready endpoint to pass: %v", err)
	}

	notReady := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		http.Error(response, "starting", http.StatusServiceUnavailable)
	}))
	defer notReady.Close()
	if err := runHealthcheck(notReady.URL); err == nil {
		t.Fatal("expected non-200 endpoint to fail")
	}
}

func TestStaticGatewayUsesPrecompressedAssetAndProxiesDynamicHTML(t *testing.T) {
	assetRoot := t.TempDir()
	if err := os.WriteFile(filepath.Join(assetRoot, "bundle.js"), []byte("uncompressed"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(assetRoot, "bundle.js.gz"), []byte("compressed"), 0o644); err != nil {
		t.Fatal(err)
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("X-Upstream", "true")
		_, _ = io.WriteString(response, "upstream")
	}))
	defer upstream.Close()
	upstreamURL, _ := http.NewRequest(http.MethodGet, upstream.URL, nil)
	proxy := httputilProxyForTest(t, upstreamURL.URL)
	gateway := &gateway{
		assetRoot:    assetRoot,
		assetVersion: "test-release",
		upstream:     proxy,
		containment:  &containmentState{},
	}

	staticRequest := httptest.NewRequest(http.MethodGet, "/browser/hash/bundle.js", nil)
	staticRequest.Header.Set("Accept-Encoding", "gzip")
	staticResponse := httptest.NewRecorder()
	gateway.ServeHTTP(staticResponse, staticRequest)
	if staticResponse.Code != http.StatusOK || staticResponse.Header().Get("Content-Encoding") != "gzip" || staticResponse.Body.String() != "compressed" {
		t.Fatalf("unexpected static response: code=%d encoding=%q body=%q", staticResponse.Code, staticResponse.Header().Get("Content-Encoding"), staticResponse.Body.String())
	}

	dynamicRequest := httptest.NewRequest(http.MethodGet, "/browser/hash/cool.html", nil)
	dynamicResponse := httptest.NewRecorder()
	gateway.ServeHTTP(dynamicResponse, dynamicRequest)
	if dynamicResponse.Header().Get("X-Upstream") != "true" {
		t.Fatalf("cool.html must be preprocessed by Collabora")
	}
}

func httputilProxyForTest(t *testing.T, target *url.URL) *httputil.ReverseProxy {
	t.Helper()
	return httputil.NewSingleHostReverseProxy(target)
}

func TestDynamicAssets(t *testing.T) {
	for _, asset := range []string{
		"cool.html",
		"welcome/welcome.html",
		"l10n/localizations.json",
		"src/app/TaskWorker.js",
		"admin/adminSettings.html",
		"admin-bundle.js",
	} {
		if !isDynamicAsset(asset) {
			t.Fatalf("%s must remain on Collabora's preprocessing path", asset)
		}
	}
}
