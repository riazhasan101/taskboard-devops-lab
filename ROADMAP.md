# Practice roadmap: Docker → CI → Kubernetes → Helm → Argo CD → HA → Autoscaling → Backup

Pace: ~1 phase per 3-5 evenings, about 6-8 weeks total. Every phase has a **Done when** line;
do not move on until you can do it **without copy-pasting from this file**. The "Break it" drills are the real learning.

Target skill: take modules built by other engineers and turn them into one reliable, observable, recoverable product.

---

## Phase 0 — Tools (half a day)
Install: docker, kind, kubectl, helm, k6, argocd CLI (optional), k9s (very useful), git, a GitHub account.
On Windows: follow WINDOWS.md (WSL2 + Docker Desktop, memory cap).
**Done when:** `docker version`, `kind version`, `kubectl version --client`, `helm version` all work.

## Phase 1 — Containers and Compose (2-3 days)
Learn: multi-stage builds, non-root user, `.dockerignore`, healthchecks, env-based config, layers/caching.
Do:
1. `docker compose up --build`, open :8080, add tasks.
2. Read both Dockerfiles; shrink or change something and compare `docker images` sizes.
3. `docker compose exec postgres psql -U app taskboard` and look at the data.
Break it: stop `redis` (app must still work, UI shows "n/a"); stop `postgres` (see `/readyz` go 503, then recover).
**Done when:** you can explain why `/healthz` must not check the DB but `/readyz` should.

## Phase 2 — CI with GitHub Actions (3-4 days)
Learn: pipelines as code, caching, registry, image tags = git SHA (never `latest`), vulnerability scanning.
Do:
1. Push repo to GitHub; open a PR and watch `test`, `chart-lint`, `build` run.
2. Merge to main: images land in GHCR (`ghcr.io/<you>/taskboard-devops-lab-backend:<sha>`). Make packages public (or create an imagePullSecret).
3. Read the `bump-staging` job: CI does not deploy, it edits a tag in git.
Break it: add a deliberately vulnerable old base image and see Trivy fail the build; break a unit test.
**Done when:** a merge to main produces two scanned, SHA-tagged images and a commit changing `values-staging.yaml`.
Mapping to your role: this pipeline is the "shared CI template" you will give every engineer.

## Phase 3 — Kubernetes fundamentals (1 week)
Learn: Pod, Deployment, ReplicaSet, Service, Ingress, ConfigMap/Secret, probes, requests/limits, namespaces, rolling update, `kubectl describe/logs/exec/port-forward`.
Do:
1. `./scripts/bootstrap-cluster.sh` (kind with 2 workers, ingress, metrics-server, CNPG, Argo CD).
2. Before Helm, deploy by hand once: `kubectl create ns lab`, apply `infra/redis.yaml`, write a plain Deployment+Service for the backend (copy from `helm template` output later).
3. `kubectl scale`, `kubectl rollout status/undo`, `kubectl top pods`.
Break it: wrong image tag (ImagePullBackOff), failing readiness probe (pod never Ready), memory limit too low (OOMKilled), bad Secret key (CreateContainerConfigError). Diagnose each using only `describe` and `logs`.
**Done when:** you can diagnose those four failures in under 2 minutes each.

## Phase 4 — Helm (4-5 days)
Learn: values layering, templates, helpers, `helm template`, `lint`, `upgrade --install`, `history`, `rollback`.
Do:
1. Read `helm/taskboard` top to bottom. `helm template t helm/taskboard -f helm/taskboard/values-staging.yaml | less`.
2. Install the infra first (see phase 6 for Postgres), then `helm upgrade --install taskboard helm/taskboard -n taskboard-staging -f helm/taskboard/values-staging.yaml --set image.tag=<sha>`.
3. Open http://taskboard-staging.localtest.me (resolves to 127.0.0.1; kind maps ports 80/443).
4. Add a new value (e.g. `backend.extraEnv`) and a template that uses it.
Break it: `helm upgrade` with a bad value, then `helm rollback`. Notice what Helm rolls back and what it does not (PVC data).
**Done when:** you can add a new module to the chart (Deployment+Service+probes+resources) in under 30 minutes. That is your "onboard an engineer's module" skill.

## Phase 5 — GitOps with Argo CD (1 week)
Learn: desired state in git, sync/prune/self-heal, health status, drift, manual vs auto sync, environments.
Do:
1. Put the repo on GitHub, fix `repoURL`, `kubectl apply -n argocd -f argocd/staging.yaml`. Port-forward the UI (see script output).
2. Merge a code change → CI builds → CI bumps tag → Argo syncs → watch the rolling update (UI shows the pod name changing at the top of the page).
3. Apply `argocd/prod.yaml` and promote by hand: copy the tested tag into `values-prod.yaml` via PR, then press Sync.
4. Roll back by `git revert`, not by clicking in the UI.
Break it: `kubectl edit deploy` something in staging and watch self-heal revert it; create a bad manifest and watch the app go Degraded.
**Done when:** you never run `helm upgrade` or `kubectl apply` for the app again. Everything goes through git.

## Phase 6 — High availability (1-1.5 weeks)
Learn: replicas, anti-affinity/topology spread, PodDisruptionBudgets, graceful shutdown, failover, single points of failure.
Do:
1. Postgres HA: `kubectl apply -n taskboard-staging -f infra/postgres-cnpg.yaml` (or let Argo do it). Check `kubectl get cluster,pods` shows 1 primary + 1 replica on different nodes (set `instances: 3` and use the 3-worker kind config when your laptop has headroom).
2. `kubectl get pods -o wide`: confirm backend/frontend replicas are spread across the workers.
3. Redis: keep the single replica but prove the app survives it. Stretch goal: replace with a Redis Sentinel/operator setup.
Break it (do all of these while `watch curl` or k6 hits the site):
- delete a backend pod → no failed requests?
- `kubectl delete pod <postgres primary>` → how long until failover? does the app reconnect?
- `kubectl drain <worker> --ignore-daemonsets --delete-emptydir-data` → PDB should keep the app up; drain a second worker and see the PDB block you.
- stop a whole kind worker container (`docker stop`) and watch rescheduling.
- roll out a new version while k6 is running → zero errors expected (check `maxUnavailable: 0` + readiness + `SHUTDOWN_DELAY_MS`).
**Done when:** you can state, for each component, what happens when it dies, how long recovery takes, and what the user sees. Write that table down; it is a deliverable in a real job.

## Phase 7 — Autoscaling (4-5 days)
Learn: HPA (CPU/memory), requests vs limits, scale-up/down behavior, why requests matter, cluster autoscaler (concept), KEDA (stretch).
Do:
1. `kubectl get hpa -w -n taskboard-staging`, `kubectl top pods`.
2. `k6 run -e BASE=http://taskboard-staging.localtest.me loadtest/k6.js` and watch replicas climb, then decay after the 60s stabilization window.
3. Tune `targetCPUUtilizationPercentage`, requests, and the `behavior` block; compare p95 latency each time.
Break it: remove CPU requests (HPA shows `<unknown>`); set `maxReplicas` too low and watch latency climb; set a tiny CPU limit and observe throttling.
Stretch: scale on a custom metric (requests/sec from Prometheus) using KEDA or prometheus-adapter. Note: kind can't add nodes automatically; study the Cluster Autoscaler/Karpenter on paper or on a cloud trial.
**Done when:** you can show a graph where load goes up, pods go up, latency stays flat.

## Phase 8 — Backup and disaster recovery (1 week)
Learn: RPO/RTO, logical vs physical backups, PITR, restore testing. A backup you never restored is not a backup.
Do:
1. Logical: the chart's CronJob dumps to a PVC. Trigger now: `kubectl create job --from=cronjob/taskboard-pgdump manual-1 -n taskboard-staging`; check the file.
2. Restore drill: add tasks, take a backup, delete rows, run `./scripts/restore-pgdump.sh taskboard-staging`, confirm the data is back.
3. Physical/PITR: MinIO + CNPG `ScheduledBackup`; run an on-demand `Backup`, then bootstrap a **new** cluster from it (`bootstrap.recovery`) and check the data.
4. Kubernetes-level: install Velero (stretch) and back up the namespace.
Break it: delete the whole namespace, then rebuild the product from git + backups only. Time it.
**Done when:** you have a written runbook with measured RTO and a tested restore command.

## Phase 9 — Observability and security (1 week)
- Install kube-prometheus-stack (Helm). Scrape `/metrics` (add a ServiceMonitor); build a dashboard: request rate, p95 latency, error rate, pods, HPA replicas. Alert on: pod crash-looping, 5xx rate, Postgres replica lag, backup job failed.
- Logs: Loki + Promtail/Alloy; query by pod. The API already logs JSON.
- Secrets: replace the plain-text MinIO secret with Sealed Secrets or External Secrets.
- NetworkPolicies: default-deny, then allow frontend→backend, backend→postgres/redis only.
- Pod Security (restricted), image scanning in CI (done), and a registry pull secret.
**Done when:** you get a Slack/email alert within 2 minutes of killing the backend.

## Phase 10 — Game day and your "platform contract" (ongoing)
1. Have a friend (or a script) break things at random while you only use dashboards and runbooks.
2. Turn what you learned into the standard every engineer follows: Dockerfile template, `/healthz` `/readyz` `/metrics`, env-only config, JSON logs, semver tags, resource requests, README + port. This repo's `backend/` is the reference module.
3. Add a second and third "module" (e.g. a worker that consumes a Redis queue, or an MQTT-to-Postgres ingest service for your IoT work) and onboard them through the same chart. That is the real job.

---

## Weekly checklist
- [ ] Phase done criteria met without notes
- [ ] One failure drill written up (what broke, how I noticed, how I fixed it)
- [ ] Everything changed via git

## Command cheat sheet
```bash
kubectl get pods -o wide -w
kubectl describe pod <p> ; kubectl logs <p> --previous
kubectl rollout status deploy/taskboard-backend ; kubectl rollout undo deploy/taskboard-backend
kubectl get hpa,pdb,cluster -n taskboard-staging
kubectl drain <node> --ignore-daemonsets --delete-emptydir-data ; kubectl uncordon <node>
helm template t helm/taskboard -f helm/taskboard/values-staging.yaml
helm lint helm/taskboard ; helm history taskboard -n taskboard-staging
argocd app list ; argocd app diff taskboard-prod
```
