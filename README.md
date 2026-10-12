# Taskboard – DevOps practice lab

Small app whose only job is to be something real to deploy.
React (Vite, served by nginx) → Node/Express API → Postgres + Redis (cache-aside).

```
backend/    Express API: /api/tasks CRUD, /api/info (which pod answered), /api/burn (CPU for HPA),
            /healthz /readyz /metrics, JSON logs, graceful shutdown, Dockerfile, tests
frontend/   React UI + nginx (proxies /api to BACKEND_URL), Dockerfile
docker-compose.yml          phase 1: everything locally
.github/workflows/ci.yml    test -> chart lint -> build -> Trivy scan -> push to GHCR -> bump staging tag in git
helm/taskboard/             chart: backend+HPA+PDB, frontend, ingress, pg_dump backup CronJob; values-{staging,prod}.yaml
infra/                      redis, HA Postgres (CloudNativePG, 2 instances), MinIO (S3 for PG backups)
argocd/                     Application manifests: staging (auto-sync) and prod (manual sync)
scripts/                    kind cluster (1 control-plane + 2 workers; 3-worker variant), bootstrap, restore drill
loadtest/k6.js              traffic to trigger autoscaling
ROADMAP.md                  the practice plan  <-- start here
WINDOWS.md                  Windows 11 + WSL2 + Docker Desktop setup for a 16 GB laptop
```

## Quick start
```bash
docker compose up --build          # http://localhost:8080
cd backend && npm ci && npm test   # unit tests (no DB needed)
```
Then follow ROADMAP.md. Before pushing: replace `your-gh-user` in `helm/taskboard/values.yaml` and `argocd/*.yaml`.

## Honest notes
- Written as a lab, not production: lab secrets are plain text (MinIO), single ingress, no NetworkPolicies yet (roadmap phase 9).
- Monorepo here for simplicity. In your real setup, keep module repos separate from a deploy (GitOps) repo.
