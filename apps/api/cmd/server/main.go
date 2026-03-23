package main

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	cfg "hasnahena/apps/api/internal/config"
	handlers "hasnahena/apps/api/internal/handlers"
	appmw "hasnahena/apps/api/internal/middleware"
	repositories "hasnahena/apps/api/internal/repositories"
	services "hasnahena/apps/api/internal/services"
	"hasnahena/apps/api/internal/utils"
)

func main() {
	config := cfg.Load()
	if config.DatabaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	dbPool, err := pgxpool.New(ctx, config.DatabaseURL)
	if err != nil {
		log.Fatalf("failed to connect db: %v", err)
	}
	defer dbPool.Close()

	userRepo := repositories.NewUserRepository(dbPool)
	authService := services.NewAuthService(userRepo, config.JWTSecret, config.JWTExpiry)
	authHandler := handlers.NewAuthHandler(authService)
	dashboardHandler := handlers.NewDashboardHandler(authService, userRepo)

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(appmw.Logging)
	r.Use(appmw.CORS(config.CORSOrigins))

	r.Get("/v1/health", func(w http.ResponseWriter, r *http.Request) {
		utils.Success(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	r.Route("/v1", func(v1 chi.Router) {
		v1.Route("/auth", func(auth chi.Router) {
			auth.Post("/login", authHandler.Login)
		})
		v1.Route("/dashboard", func(dashboard chi.Router) {
			dashboard.Get("/member", dashboardHandler.MemberDashboard)
			dashboard.Get("/notifications", dashboardHandler.Notifications)
			dashboard.Get("/member/deposits", dashboardHandler.MemberDeposits)
			dashboard.Get("/member/transactions", dashboardHandler.MemberTransactions)
			dashboard.Get("/member/loans", dashboardHandler.MemberLoans)
			dashboard.Get("/member/profile", dashboardHandler.MemberProfile)
			dashboard.Get("/worker", dashboardHandler.WorkerDashboard)
			dashboard.Get("/worker/members", dashboardHandler.WorkerMembers)
			dashboard.Get("/admin", dashboardHandler.AdminDashboard)
			dashboard.Get("/admin/members", dashboardHandler.AdminMembers)
			dashboard.Get("/admin/workers", dashboardHandler.AdminWorkers)
		})
	})

	addr := ":" + config.Port
	log.Printf("API server running on %s", addr)
	if err := http.ListenAndServe(addr, r); err != nil {
		log.Fatal(err)
	}
}
