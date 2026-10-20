#!/usr/bin/env bash
# One-time setup for .github/workflows/deploy.yml. Needs `az login` (Owner on the
# subscription) and `gh auth login` (admin on the repo).
#   - user-assigned identity + GitHub OIDC federated credential (no stored Azure secrets)
#   - Contributor + Role Based Access Control Administrator on the subscription
#     (main.bicep creates role assignments)
#   - GitHub environment "production" with variables and placeholder/generated secrets
#   - Entra app registration for Microsoft sign-in (redirect URI + client secret)
#   - matching local azd environment, so `azd up` and the workflow share the same values
set -euo pipefail

REPO="${REPO:-martins-vds/my-feeds}"
GH_ENV="${GH_ENV:-production}"
AZD_ENV_NAME="${AZD_ENV_NAME:-my-feeds-prod}"
LOCATION=canadacentral
CICD_RG="${CICD_RG:-rg-my-feeds-cicd}"
IDENTITY="${IDENTITY:-id-my-feeds-github}"
APP_REG="${APP_REG:-my-feeds-microsoft-login}"

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
azd env select "$AZD_ENV_NAME" 2>/dev/null || azd env new "$AZD_ENV_NAME" --subscription "$SUBSCRIPTION_ID" --location "$LOCATION"

# Reuse values already in the azd env so re-running this script doesn't rotate them.
# azd prints "key not found" to stdout, so only echo on success. "placeholder" counts as unset.
existing() { local v; v=$(azd env get-value "$1" -e "$AZD_ENV_NAME" 2>/dev/null) && [ "$v" != placeholder ] && echo "$v" || true; }

# setvar/setsecret NAME VALUE [AZD_NAME]: azd name defaults to NAME.
setvar() { gh variable set "$1" --env "$GH_ENV" --repo "$REPO" --body "$2"; azd env set "${3:-$1}" "$2" -e "$AZD_ENV_NAME"; }
setsecret() { gh secret set "$1" --env "$GH_ENV" --repo "$REPO" --body "$2"; azd env set "${3:-$1}" "$2" -e "$AZD_ENV_NAME"; }

setvar AZURE_CLIENT_ID "$CLIENT_ID"
setvar AZURE_TENANT_ID "$TENANT_ID"
setvar AZURE_SUBSCRIPTION_ID "$SUBSCRIPTION_ID"
setvar AZURE_ENV_NAME "$AZD_ENV_NAME"
setvar AZURE_LOCATION "$LOCATION"
setvar APP_PORT 8000
setvar ALLOWED_IPS "$(curl -fsS https://api.ipify.org)"

# GitHub reserves the GITHUB_ prefix, hence OAUTH_GITHUB_*.
setvar OAUTH_GITHUB_CLIENT_ID placeholder GITHUB_CLIENT_ID
setvar GOOGLE_CLIENT_ID placeholder
setsecret OAUTH_GITHUB_CLIENT_SECRET placeholder GITHUB_CLIENT_SECRET
setsecret GOOGLE_CLIENT_SECRET placeholder

# Pinned web app name, so the redirect URI is known before the first deploy.
WEB_APP_NAME=$(existing WEB_APP_NAME); WEB_APP_NAME=${WEB_APP_NAME:-app-my-feeds-$(openssl rand -hex 4)}
setvar WEB_APP_NAME "$WEB_APP_NAME"

# Microsoft sign-in. The backend uses the /common endpoint: work/school + personal accounts.
REDIRECT_URI="https://$WEB_APP_NAME.azurewebsites.net/api/auth/microsoft/callback"
# Local docker compose dev backend (OAUTH_REDIRECT_BASE_URL in docker-compose.override.yml).
DEV_REDIRECT_URI="http://localhost:${BACKEND_PORT:-5000}/api/auth/microsoft/callback"
MS_APP_ID=$(az ad app list --display-name "$APP_REG" --query "[0].appId" -o tsv)
if [ -z "$MS_APP_ID" ]; then
  MS_APP_ID=$(az ad app create --display-name "$APP_REG" \
    --sign-in-audience AzureADandPersonalMicrosoftAccount \
    --web-redirect-uris "$REDIRECT_URI" "$DEV_REDIRECT_URI" --query appId -o tsv)
else
  az ad app update --id "$MS_APP_ID" --web-redirect-uris "$REDIRECT_URI" "$DEV_REDIRECT_URI"
fi
setvar MICROSOFT_CLIENT_ID "$MS_APP_ID"
# Only mint a client secret once; re-runs keep the existing one.
MS_SECRET=$(existing MICROSOFT_CLIENT_SECRET)
if [ -z "$MS_SECRET" ]; then
  MS_SECRET=$(az ad app credential reset --id "$MS_APP_ID" --append \
    --display-name my-feeds --years 2 --query password -o tsv)
fi
setsecret MICROSOFT_CLIENT_SECRET "$MS_SECRET"

# Stable across runs: regenerating would rotate the DB password and log everyone out.
# Hex + "Aa" satisfies Postgres complexity (upper, lower, digit) and stays URL-safe.
PG=$(existing POSTGRES_PASSWORD); setsecret POSTGRES_PASSWORD "${PG:-$(openssl rand -hex 24)Aa}"
SK=$(existing SECRET_KEY); setsecret SECRET_KEY "${SK:-$(openssl rand -hex 32)}"

echo "Done. Update placeholders in https://github.com/$REPO/settings/environments, then run the 'Deploy to Azure' workflow."
