package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"personal-os-server/internal/core"
	"personal-os-server/internal/httpapi"
)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// resolveDist finds the built frontend directory, if present.
func resolveDist() string {
	if v := os.Getenv("POS_DIST_DIR"); v != "" {
		return v
	}
	for _, cand := range []string{"dist", filepath.Join("..", "dist")} {
		if fi, err := os.Stat(filepath.Join(cand, "index.html")); err == nil && !fi.IsDir() {
			abs, _ := filepath.Abs(cand)
			return abs
		}
	}
	return ""
}

func main() {
	dataDir := env("POS_DATA_DIR", filepath.Join("data", "personal-os"))
	addr := env("POS_ADDR", "0.0.0.0:8787")

	app, err := core.NewApp(dataDir)
	if err != nil {
		log.Fatalf("init app: %v", err)
	}
	dist := resolveDist()
	srv := httpapi.New(app, dist)

	httpServer := &http.Server{
		Addr:              addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("personal-os-server listening on http://%s (data=%s dist=%q)", addr, dataDir, dist)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("serve: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	log.Printf("shutting down; sealing vault…")
	if err := app.PrepareExit(); err != nil {
		log.Printf("seal on exit: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
}
