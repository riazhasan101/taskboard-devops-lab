# Windows 11 setup (16 GB RAM, 4 cores) — kind + Docker Desktop + WSL2

Run everything from a **WSL2 Ubuntu** terminal, not PowerShell. The scripts are bash and Docker is much faster there.

## 1. One-time install
1. Enable WSL2 (PowerShell as admin): `wsl --install -d Ubuntu`, reboot, create the Linux user.
2. Install **Docker Desktop**, then Settings → General → "Use the WSL 2 based engine", and Settings → Resources → WSL integration → enable for Ubuntu.
3. Inside Ubuntu, install the CLIs: `kubectl`, `kind`, `helm`, `k6`, `git`, (optional) `k9s`, `argocd`.
   Use each project's official install page; they are all single binaries.
4. Keep the repo **inside the Linux filesystem** (`~/taskboard-devops-lab`), not under `/mnt/c/...`. File I/O on /mnt/c is very slow.

## 2. Cap WSL2 memory (important on 16 GB)
Create `C:\Users\<you>\.wslconfig`:
```
[wsl2]
memory=10GB
processors=6
swap=4GB
```
Then `wsl --shutdown` and restart Docker Desktop. This leaves ~6 GB for Windows, browser and editor.

## 3. Daily workflow
```bash
./scripts/bootstrap-cluster.sh          # first time only (2 workers)
docker stop $(docker ps -q --filter name=taskboard)    # pause the cluster when you stop for the day
docker start $(docker ps -aq --filter name=taskboard)  # resume it
kind delete cluster --name taskboard    # throw it away and start clean (good for restore drills)
```
Rough RAM budget (estimates, check with `docker stats`): cluster nodes ~3 GB, Argo CD ~1 GB, Postgres x2 ~0.7 GB, app + ingress + metrics ~1 GB.
That fits in 10 GB. The monitoring stack (Phase 9) adds ~2 GB, so install it only then and remove it afterwards.

## 4. Gotchas
- **Ports 80/443** may already be used on Windows (IIS, Skype, other web servers). If `bootstrap-cluster.sh` fails on port mapping, change `hostPort` to 8081/8443 in `scripts/kind-config.yaml` and browse `http://taskboard-staging.localtest.me:8081`.
- `*.localtest.me` resolves to 127.0.0.1 via public DNS, so no hosts-file edit is needed (needs internet once).
- Close heavy apps (many Chrome tabs, Android emulator) before running the k6 load test; the laptop has 4 cores and k6 competes with the cluster. Start with 20 virtual users, not 60.
- Slow first start: image pulls for Argo CD, CNPG, ingress take several minutes on the first run.
- If the cluster feels slow, run `docker stats --no-stream` to see which pod eats memory, and `kubectl top nodes`.
- Apps you do not need in a given phase (Argo CD in Phase 3-4, CNPG before Phase 6) can be scaled to zero or installed later.
