#!/usr/bin/env bash
set -euo pipefail
: "${FEDERATED_TOKEN:?}" "${AZURE_CLIENT_ID:?}" "${AZURE_TENANT_ID:?}"
: "${AZURE_SUBSCRIPTION_ID:?}" "${AZURE_RESOURCE_GROUP:?}"
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
az acr build --registry "$AZURE_CONTAINER_REGISTRY_NAME" --resource-group "$AZURE_RESOURCE_GROUP" \
  --image "my-feeds:$GITHUB_SHA" \
  --build-arg "VITE_ALLOW_EXTERNAL_IMAGES=$ALLOW_EXTERNAL_IMAGES" --file Dockerfile .
digest=$(az acr repository show --name "$AZURE_CONTAINER_REGISTRY_NAME" \
  --image "my-feeds:$GITHUB_SHA" --query digest --output tsv)
[[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo "Invalid built image digest" >&2; exit 2; }
export RUNTIME_IMAGE="$registry/my-feeds@$digest"
body=$(python3 -c 'import json,os; print(json.dumps({"properties":{"linuxFxVersion":"DOCKER|"+os.environ["RUNTIME_IMAGE"]}}))')
# PATCH only linuxFxVersion; never provision, list application secrets or change IAM.
az rest --method patch \
  --url "https://management.azure.com/subscriptions/$AZURE_SUBSCRIPTION_ID/resourceGroups/$AZURE_RESOURCE_GROUP/providers/Microsoft.Web/sites/$WEB_APP_NAME/config/web?api-version=2024-04-01" \
  --body "$body" --output none
az logout
