#!/usr/bin/env bash
# Operator-only bootstrap. Never run from the runtime deployment workflow.
# First create/provision the application RG with a privileged human identity.
# REVIEWER_IDS is a comma-separated list of real GitHub numeric user/team IDs.
set -euo pipefail

: "${REPO:?Set the repository owner/name}" "${REVIEWER_IDS:?Set required reviewer IDs}"
: "${AZURE_RESOURCE_GROUP:?Set the already-provisioned application resource group}"
: "${AZURE_CONTAINER_REGISTRY_NAME:?Set the existing application registry name}"
: "${WEB_APP_NAME:?Set the existing web app name}"
: "${AZURE_ENV_NAME:?Set the existing azd environment name}"
GH_ENV="${GH_ENV:-production}"
[ "$GH_ENV" = production ] || { echo "deploy.yml admits only the production environment" >&2; exit 2; }
REVIEWER_TYPE="${REVIEWER_TYPE:-User}"
IDENTITY="${IDENTITY:-id-my-feeds-runtime-deploy}"
LOCATION="${LOCATION:-canadacentral}"
export REVIEWER_IDS REVIEWER_TYPE
# Validate and construct admission rules before performing any cloud writes.
environment_config=$(python3 - <<'PY'
import json, os
ids = os.environ["REVIEWER_IDS"].split(",")
kind = os.environ["REVIEWER_TYPE"]
if kind not in {"User", "Team"} or not 1 <= len(ids) <= 6 or any(not i.isdecimal() or int(i) < 1 for i in ids):
    raise SystemExit("Provide 1-6 numeric reviewer IDs and User or Team reviewer type")
print(json.dumps({
    "wait_timer": 0, "prevent_self_review": True,
    "reviewers": [{"type": kind, "id": int(i)} for i in ids],
    "deployment_branch_policy": {"protected_branches": False, "custom_branch_policies": True}
}))
PY
)
# Do not overwrite an existing ruleset/status-check policy with weaker defaults.
if [ "$(gh api "repos/$REPO/branches/main" --jq '.protected')" != true ]; then
  echo "Protect main with reviewed pull requests before bootstrapping (infra/main-branch-protection.json is an initial template)." >&2
  exit 2
fi
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)
SCOPE="/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$AZURE_RESOURCE_GROUP"
az group show --name "$AZURE_RESOURCE_GROUP" --output none
az identity create -g "$AZURE_RESOURCE_GROUP" -n "$IDENTITY" -l "$LOCATION" -o none
CLIENT_ID=$(az identity show -g "$AZURE_RESOURCE_GROUP" -n "$IDENTITY" --query clientId -o tsv)
PRINCIPAL_ID=$(az identity show -g "$AZURE_RESOURCE_GROUP" -n "$IDENTITY" --query principalId -o tsv)

# A new identity intentionally does not reuse the legacy subscription-privileged identity.
az identity federated-credential create -g "$AZURE_RESOURCE_GROUP" --identity-name "$IDENTITY" \
  -n github-"$GH_ENV" --issuer https://token.actions.githubusercontent.com \
  --subject "repo:$REPO:environment:$GH_ENV" --audiences api://AzureADTokenExchange -o none

export SCOPE SUBSCRIPTION_ID AZURE_RESOURCE_GROUP
role=$(python3 - <<'PY'
import json, os, uuid
scope = os.environ["SCOPE"]
print(json.dumps({
    "Name": "my-feeds-runtime-deploy-" + os.environ["AZURE_RESOURCE_GROUP"],
    "Id": str(uuid.uuid5(uuid.NAMESPACE_URL, scope + "/my-feeds-runtime-deploy")),
    "IsCustom": True, "Description": "Build ACR images and update App Service container configuration; no provisioning or IAM.",
    "Actions": [
        "Microsoft.Web/sites/read", "Microsoft.Web/sites/config/read", "Microsoft.Web/sites/config/write",
        "Microsoft.ContainerRegistry/registries/read",
        "Microsoft.ContainerRegistry/registries/listBuildSourceUploadUrl/action",
        "Microsoft.ContainerRegistry/registries/scheduleRun/action",
        "Microsoft.ContainerRegistry/registries/runs/read",
        "Microsoft.ContainerRegistry/registries/runs/listLogSasUrl/action",
        "Microsoft.ContainerRegistry/registries/pull/read"
    ], "NotActions": [], "DataActions": [], "NotDataActions": [],
    "AssignableScopes": [scope]
}))
PY
)
ROLE_NAME="my-feeds-runtime-deploy-$AZURE_RESOURCE_GROUP"
if [ "$(az role definition list --name "$ROLE_NAME" --query 'length(@)' -o tsv)" = 0 ]; then
  az role definition create --role-definition "$role" -o none
else
  az role definition update --role-definition "$role" -o none
fi
az role assignment create --assignee-object-id "$PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal --role "$ROLE_NAME" --scope "$SCOPE" -o none

printf '%s' "$environment_config" | gh api -X PUT "repos/$REPO/environments/$GH_ENV" --input - >/dev/null
# Reconcile policies: remove stale patterns that would admit other branches.
gh api --paginate "repos/$REPO/environments/$GH_ENV/deployment-branch-policies" \
  --jq '.branch_policies[].id' | while read -r policy; do
    gh api -X DELETE "repos/$REPO/environments/$GH_ENV/deployment-branch-policies/$policy" >/dev/null
  done
gh api -X POST "repos/$REPO/environments/$GH_ENV/deployment-branch-policies" \
  -f name=main -f type=branch >/dev/null

setvar() { gh variable set "$1" --env "$GH_ENV" --repo "$REPO" --body "$2"; }
setvar AZURE_CLIENT_ID "$CLIENT_ID"
setvar AZURE_TENANT_ID "$TENANT_ID"
setvar AZURE_SUBSCRIPTION_ID "$SUBSCRIPTION_ID"
setvar AZURE_ENV_NAME "$AZURE_ENV_NAME"
setvar AZURE_LOCATION "$LOCATION"
setvar AZURE_RESOURCE_GROUP "$AZURE_RESOURCE_GROUP"
setvar AZURE_CONTAINER_REGISTRY_NAME "$AZURE_CONTAINER_REGISTRY_NAME"
setvar WEB_APP_NAME "$WEB_APP_NAME"
echo "Runtime deployment configured. Operator must remove legacy subscription IAM/OIDC grants and environment application secrets."
