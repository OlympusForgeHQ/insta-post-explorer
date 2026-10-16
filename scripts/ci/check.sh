#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"

initial_state="$(git status --porcelain)"

git diff --check
while IFS= read -r script; do
    [ -z "$script" ] || bash -n "$script"
done < <(git ls-files '*.sh')

npm run lint
npm run typecheck
npm run worker:typecheck
npm run worker:test
npm run worker:test:postgres
npm test -- media-identity-postgres.test.ts
npm run worker:smoke
npm run worker:test -- container-contract.test.ts
worker_node_image=public.ecr.aws/docker/library/node:24-bookworm-slim
if [ "${GITHUB_ACTIONS:-false}" = true ]; then
    # Keep registry recovery separate from build failures and bound each download.
    worker_node_image=mirror.gcr.io/library/node:24-bookworm-slim
    if ! timeout --kill-after=10s 120s docker pull "$worker_node_image"; then
        echo '::warning::Node image cache unavailable; trying the official Docker Hub image.' >&2
        worker_node_image=docker.io/library/node:24-bookworm-slim
        timeout --kill-after=10s 120s docker pull "$worker_node_image"
    fi
fi
docker build --build-arg "NODE_IMAGE=$worker_node_image" -f services/worker/Dockerfile -t insta-post-explorer-worker:ci .
npm test
npm run build

final_state="$(git status --porcelain)"
if [ "$initial_state" != "$final_state" ]; then
    echo '::error::CI validation modified repository state' >&2
    git status --short
    exit 1
fi

echo 'Insta Post Explorer validation completed successfully.'
