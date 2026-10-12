#!/usr/bin/env bash
# Local practice cluster: kind + ingress-nginx + metrics-server + CloudNativePG + Argo CD.
# Needs: docker, kind, kubectl, helm.
# Usage: ./scripts/bootstrap-cluster.sh [scripts/kind-config-3workers.yaml]
set -euo pipefail
cd "$(dirname "$0")/.."

kind create cluster --name taskboard --config "${1:-scripts/kind-config.yaml}"

# Ingress (kind flavour)
kubectl apply -f https://kind.sigs.k8s.io/examples/ingress/deploy-ingress-nginx.yaml
kubectl -n ingress-nginx wait --for=condition=ready pod -l app.kubernetes.io/component=controller --timeout=180s

# metrics-server (needed by HPA / kubectl top). kind kubelets use self-signed certs.
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
kubectl -n kube-system patch deploy metrics-server --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'

# CloudNativePG operator (HA Postgres)
helm repo add cnpg https://cloudnative-pg.github.io/charts
helm repo update
helm upgrade --install cnpg cnpg/cloudnative-pg -n cnpg-system --create-namespace

# Argo CD
kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -n argocd --server-side -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

echo
echo "Argo CD admin password:"
echo "  kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d; echo"
echo "UI:  kubectl -n argocd port-forward svc/argocd-server 8443:443   ->  https://localhost:8443  (user: admin)"
