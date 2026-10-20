#!/usr/bin/env bash
# One-time setup for .github/workflows/deploy.yml. Needs `az login` (Owner on the
# subscription) and `gh auth login` (admin on the repo).
#   - user-assigned identity + GitHub OIDC federated credential (no stored Azure secrets)
#   - Contributor + Role Based Access Control Administrator on the subscription
#     (main.bicep creates role assignments)
#   - GitHub environment "production" with variables and placeholder/generated secrets
set -euo pipefail

REPO="${REPO:-martins-vds/my-feeds}"
GH_ENV="${GH_ENV:-production}"
AZD_ENV_NAME="${AZD_ENV_NAME:-my-feeds-prod}"
LOCATION=canadacentral
CICD_RG="${CICD_RG:-rg-my-feeds-cicd}"
IDENTITY="${IDENTITY:-id-my-feeds-github}"

SUBSCRIPTION_ID=$(az account show --query id -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)

az group create -n "$CICD_RG" -l "$LOCATION" -o none
az identity create -g "$CICD_RG" -n "$IDENTITY" -l "$LOCATION" -o none
CLIENT_ID=$(az identity show -g "$CICD_RG" -n "$IDENTITY" --query clientId -o tsv)
PRINCIPAL_ID=$(az identity show -g "$CICD_RG" -n "$IDENTITY" --query principalId -o tsv)

az identity federated-credential create -g "$CICD_RG" --identity-name "$IDENTITY" \
  -n github-"$GH_ENV" \
  --issuer https://token.actions.githubusercontent.com \
  --subject "repo:$REPO:environment:$GH_ENV" \
  --audiences api://AzureADTokenExchange -o none

for role in Contributor "Role Based Access Control Administrator"; do
  az role assignment create --assignee-object-id "$PRINCIPAL_ID" --assignee-principal-type ServicePrincipal \
    --role "$role" --scope "/subscriptions/$SUBSCRIPTION_ID" -o none
done

gh api -X PUT "repos/$REPO/environments/$GH_ENV" >/dev/null

setvar() { gh variable set "$1" --env "$GH_ENV" --repo "$REPO" --body "$2"; }
setsecret() { gh secret set "$1" --env "$GH_ENV" --repo "$REPO" --body "$2"; }

setvar AZURE_CLIENT_ID "$CLIENT_ID"
setvar AZURE_TENANT_ID "$TENANT_ID"
setvar AZURE_SUBSCRIPTION_ID "$SUBSCRIPTION_ID"
setvar AZURE_ENV_NAME "$AZD_ENV_NAME"
setvar AZURE_LOCATION "$LOCATION"
setvar APP_PORT 8000
setvar ALLOWED_IPS "$(curl -fsS https://api.ipify.org)"

# GitHub reserves the GITHUB_ prefix, hence OAUTH_GITHUB_*.
setvar OAUTH_GITHUB_CLIENT_ID placeholder
setvar GOOGLE_CLIENT_ID placeholder
setvar MICROSOFT_CLIENT_ID placeholder
setsecret OAUTH_GITHUB_CLIENT_SECRET placeholder
setsecret GOOGLE_CLIENT_SECRET placeholder
setsecret MICROSOFT_CLIENT_SECRET placeholder

# Stable across runs: regenerating would rotate the DB password and log everyone out.
# Hex + "Aa" satisfies Postgres complexity (upper, lower, digit) and stays URL-safe.
setsecret POSTGRES_PASSWORD "$(openssl rand -hex 24)Aa"
setsecret SECRET_KEY "$(openssl rand -hex 32)"

echo "Done. Update placeholders in https://github.com/$REPO/settings/environments, then run the 'Deploy to Azure' workflow."
