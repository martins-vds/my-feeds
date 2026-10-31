#!/usr/bin/env bash
set -euo pipefail
: "${FEDERATED_TOKEN:?}" "${AZURE_CLIENT_ID:?}" "${AZURE_TENANT_ID:?}"
: "${AZURE_SUBSCRIPTION_ID:?}" "${AZURE_RESOURCE_GROUP:?}"
: "${AZURE_ENV_NAME:?}" "${AZURE_LOCATION:?}"
: "${AZURE_CONTAINER_REGISTRY_NAME:?}" "${WEB_APP_NAME:?}" "${GITHUB_SHA:?}"
[[ "$GITHUB_SHA" =~ ^[a-f0-9]{40}$ ]] || { echo "Invalid source revision" >&2; exit 2; }
ALLOW_EXTERNAL_IMAGES="${ALLOW_EXTERNAL_IMAGES:-false}"
[[ "$ALLOW_EXTERNAL_IMAGES" = false || "$ALLOW_EXTERNAL_IMAGES" = true ]] || {
  echo "ALLOW_EXTERNAL_IMAGES must be true or false" >&2; exit 2;
}

az login --service-principal --username "$AZURE_CLIENT_ID" \
  --tenant "$AZURE_TENANT_ID" --federated-token "$FEDERATED_TOKEN" --output none
unset FEDERATED_TOKEN
az account set --subscription "$AZURE_SUBSCRIPTION_ID"
registry=$(az acr show --name "$AZURE_CONTAINER_REGISTRY_NAME" \
  --resource-group "$AZURE_RESOURCE_GROUP" --query loginServer --output tsv)
azd auth login --client-id "$AZURE_CLIENT_ID" --tenant-id "$AZURE_TENANT_ID" \
  --federated-credential-provider github --no-prompt
azd env new "$AZURE_ENV_NAME" --subscription "$AZURE_SUBSCRIPTION_ID" \
  --location "$AZURE_LOCATION" --no-prompt
azd env set AZURE_RESOURCE_GROUP "$AZURE_RESOURCE_GROUP" --no-prompt
azd env set AZURE_CONTAINER_REGISTRY_ENDPOINT "$registry" --no-prompt
azd env set SERVICE_WEB_NAME "$WEB_APP_NAME" --no-prompt
azd env set AZD_DEPLOY_WEB_SLOT_NAME production --no-prompt
azd env set ALLOW_EXTERNAL_IMAGES "$ALLOW_EXTERNAL_IMAGES" --no-prompt
# azure.yaml owns the Dockerfile, remote build and build arguments.
azd publish web --to "$registry/my-feeds:$GITHUB_SHA" --no-prompt
digest=$(az acr repository show --name "$AZURE_CONTAINER_REGISTRY_NAME" \
  --image "my-feeds:$GITHUB_SHA" --query digest --output tsv)
[[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo "Invalid built image digest" >&2; exit 2; }
export RUNTIME_IMAGE="$registry/my-feeds@$digest"
# Reuse the remote image without rebuilding or deploying a mutable tag.
azd deploy web --from-package "$RUNTIME_IMAGE" --no-prompt
azd auth logout
az logout
