#!/usr/bin/env bash
# Restore drill for the logical (pg_dump) backup. Usage: ./scripts/restore-pgdump.sh <namespace> [backup-file-name]
# Starts a throwaway pod that mounts the backup PVC and loads the dump into the live DB.
set -euo pipefail
NS=${1:?namespace}
FILE=${2:-}
kubectl -n "$NS" run pg-restore --rm -i --restart=Never --image=postgres:17-alpine \
  --overrides='{
    "spec": {
      "containers": [{
        "name": "pg-restore", "image": "postgres:17-alpine", "stdin": true,
        "command": ["sh","-c","f=${FILE:-$(ls -1t /backups/*.sql.gz | head -1)}; echo restoring $f; gunzip -c $f | psql \"$DATABASE_URL\""],
        "env": [{"name":"FILE","value":"'"$FILE"'"},{"name":"DATABASE_URL","valueFrom":{"secretKeyRef":{"name":"taskboard-pg-app","key":"uri"}}}],
        "volumeMounts": [{"name":"b","mountPath":"/backups"}]
      }],
      "volumes": [{"name":"b","persistentVolumeClaim":{"claimName":"taskboard-backups"}}]
    }
  }'
