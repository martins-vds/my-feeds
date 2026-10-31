// Provision only as a privileged operator into an existing application RG.
// The runtime GitHub identity cannot run this deployment or grant any roles.
targetScope = 'resourceGroup'

@minLength(1)
@maxLength(64)
@description('Name of the azd environment; used to derive resource names.')
param environmentName string

@description('All resources deploy to Canada Central.')
@allowed(['canadacentral'])
param location string = 'canadacentral'

@description('Comma-separated IPv4 addresses allowed to reach the web app and Postgres, e.g. "1.2.3.4,5.6.7.8". Empty = no public access.')
param allowedIps string = ''

@description('Web app name (global *.azurewebsites.net). setup-github.sh pins it so the OAuth redirect URI is known before deploy.')
param webAppName string = ''

@description('Whether the web app already exists (azd: SERVICE_WEB_RESOURCE_EXISTS). When true, provision keeps its current image.')
param webExists bool = false

@description('Image for a new web app (azd: SERVICE_WEB_IMAGE_NAME). Empty = placeholder until `azd deploy`.')
param webImageName string = ''

@description('Port the container listens on (PORT for the app, WEBSITES_PORT for App Service).')
param appPort int = 8000

@secure()
@minLength(32)
@metadata({ azd: { type: 'generate', config: { length: 32, noSpecial: true } } })
param postgresPassword string

@secure()
@minLength(32)
@metadata({ azd: { type: 'generate', config: { length: 48, noSpecial: true } } })
param postgresRuntimePassword string

@description('Explicit consent to send feed/post text to an external TTS service.')
param allowExternalTts bool = false

@description('Explicit consent to load remote HTTPS feed images in the browser.')
param allowExternalImages bool = false

@secure()
@minLength(32)
@metadata({ azd: { type: 'generate', config: { length: 64, noSpecial: true } } })
param secretKey string

param githubClientId string = ''
@secure()
param githubClientSecret string = ''
param googleClientId string = ''
@secure()
param googleClientSecret string = ''
param microsoftClientId string = ''
@secure()
param microsoftClientSecret string = ''

var tags = { 'azd-env-name': environmentName }
var token = uniqueString(subscription().id, environmentName, location)
var postgresUser = 'myfeeds'
var postgresDb = 'myfeeds'
var appName = empty(webAppName) ? 'app-web-${token}' : webAppName
var ips = filter(map(split(allowedIps, ','), ip => trim(ip)), ip => !empty(ip))
var privateDnsZoneNames = [
  'privatelink.blob.${environment().suffixes.storage}'
  'privatelink.postgres.database.azure.com'
]

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' existing = {
  scope: subscription()
  name: resourceGroup().name
}

module vnet 'br/public:avm/res/network/virtual-network@sha256:2a4a65287d09a8e6676f7ccb1f6e717d533806a60300242a22e63bfe06f23d8d' = {
  scope: rg
  params: {
    name: 'vnet-${token}'
    location: location
    tags: tags
    addressPrefixes: ['10.0.0.0/16']
    subnets: [
      {
        name: 'app'
        addressPrefix: '10.0.1.0/24'
        delegation: 'Microsoft.Web/serverFarms'
      }
      {
        name: 'private-endpoints'
        addressPrefix: '10.0.2.0/24'
      }
    ]
  }
}

module dnsZones 'br/public:avm/res/network/private-dns-zone@sha256:9c8f06307e46c2684fed62086a854b7d69c50bde157c984f5b367002f1509a2b' = [
  for zone in privateDnsZoneNames: {
    scope: rg
    params: {
      name: zone
      tags: tags
      virtualNetworkLinks: [{ virtualNetworkResourceId: vnet.outputs.resourceId }]
    }
  }
]

module identity 'br/public:avm/res/managed-identity/user-assigned-identity@sha256:af3108d4973ce5252f08442e2e97b1fc6c67e19a7143ea58ba21ac1a58dc807e' = {
  scope: rg
  params: {
    name: 'id-${token}'
    location: location
    tags: tags
  }
}

module registry 'br/public:avm/res/container-registry/registry@sha256:2ee6ba8e32e9392ed7a5c0eee39910ce5222c35d4c463b087d0f6928139789bd' = {
  scope: rg
  params: {
    name: 'cr${token}'
    location: location
    tags: tags
    // Public by design: Basic SKU can't use private endpoints and ACR quick builds need
    // a reachable registry. Entra-only access (no admin user, no anonymous pull).
    acrSku: 'Basic'
    acrAdminUserEnabled: false
    anonymousPullEnabled: false
    // App Service pulls with a managed-identity token scoped to ARM; the module
    // defaults this to 'disabled', which makes the pull fail with Unauthorized.
    azureADAuthenticationAsArmPolicyStatus: 'enabled'
    roleAssignments: [
      {
        principalId: identity.outputs.principalId
        principalType: 'ServicePrincipal'
        roleDefinitionIdOrName: 'AcrPull'
      }
    ]
  }
}

module storage 'br/public:avm/res/storage/storage-account@sha256:0e40cd4f7db68aa9e2ae237afc884fde8b1f000364025136f26d03a5eafecff0' = {
  scope: rg
  params: {
    name: 'st${token}'
    location: location
    tags: tags
    skuName: 'Standard_LRS'
    allowSharedKeyAccess: false
    publicNetworkAccess: 'Disabled'
    networkAcls: { defaultAction: 'Deny', bypass: 'None' }
    privateEndpoints: [
      {
        service: 'blob'
        subnetResourceId: vnet.outputs.subnetResourceIds[1]
        privateDnsZoneGroup: {
          privateDnsZoneGroupConfigs: [{ privateDnsZoneResourceId: dnsZones[0].outputs.resourceId }]
        }
      }
    ]
    blobServices: {
      containers: [{ name: 'audio-cache' }]
    }
    roleAssignments: [
      {
        principalId: identity.outputs.principalId
        principalType: 'ServicePrincipal'
        roleDefinitionIdOrName: 'Storage Blob Data Contributor'
      }
    ]
  }
}

module postgres 'br/public:avm/res/db-for-postgre-sql/flexible-server@sha256:103d7adba0b4c233ea861172dbbec8d6cc4c1235e97576e95fbd7f9a0d5eab0c' = {
  scope: rg
  params: {
    name: 'psql-${token}'
    location: location
    tags: tags
    skuName: 'Standard_B1ms'
    tier: 'Burstable'
    availabilityZone: -1
    version: '16'
    // Free tier for Azure free accounts: B1ms + 32 GB, 750 h/month for 12 months.
    storageSizeGB: 32
    highAvailability: 'Disabled'
    geoRedundantBackup: 'Disabled'
    administratorLogin: postgresUser
    administratorLoginPassword: postgresPassword
    authConfig: { activeDirectoryAuth: 'Disabled', passwordAuth: 'Enabled' }
    // App reaches Postgres via the private endpoint; the public endpoint only admits allowedIps.
    publicNetworkAccess: empty(ips) ? 'Disabled' : 'Enabled'
    privateEndpoints: [
      {
        subnetResourceId: vnet.outputs.subnetResourceIds[1]
        privateDnsZoneGroup: {
          privateDnsZoneGroupConfigs: [{ privateDnsZoneResourceId: dnsZones[1].outputs.resourceId }]
        }
      }
    ]
    databases: [{ name: postgresDb }]
  }
}

// Outside the AVM module: it writes child resources in parallel and Postgres rejects
// concurrent operations (ServerIsBusy). These run after it, one at a time.
module postgresFirewall 'postgres-firewall.bicep' = {
  scope: rg
  params: {
    serverName: postgres.outputs.name
    ips: ips
  }
}

module logs 'br/public:avm/res/operational-insights/workspace@sha256:2d18e9aff611d162e9a1f32f8a430fc46c81ee1791816bbe9b3860a7f392d651' = {
  scope: rg
  params: {
    name: 'log-${token}'
    location: location
    tags: tags
    dataRetention: 30
  }
}

// ponytail: public ingestion/query endpoints; full isolation needs an Azure Monitor Private Link Scope.
module appInsights 'br/public:avm/res/insights/component@sha256:ab732413f1131a8915500e3b9ec12e21964b015cf7dfcdf9ce5c8ed95deba8b3' = {
  scope: rg
  params: {
    name: 'appi-${token}'
    location: location
    tags: tags
    workspaceResourceId: logs.outputs.resourceId
  }
}

var speechName = 'spch-${token}'

// Public endpoint, Entra ID only: the app reaches it over App Service's outbound IPs (no VNet egress).
module speech 'br/public:avm/res/cognitive-services/account@sha256:1c384785004d3d4bd691df087149447034122bbbf93264fecf674aa6fb430008' = if (allowExternalTts) {
  scope: rg
  params: {
    name: speechName
    location: location
    tags: tags
    kind: 'SpeechServices'
    sku: 'S0'
    customSubDomainName: speechName
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
    roleAssignments: [
      {
        principalId: identity.outputs.principalId
        principalType: 'ServicePrincipal'
        roleDefinitionIdOrName: 'Cognitive Services Speech User'
      }
    ]
  }
}

module plan 'br/public:avm/res/web/serverfarm@sha256:20641da5c1419054dad080a6b92ea3fd0f0ed04719aee34ec5ca8707c5c048f8' = {
  scope: rg
  params: {
    name: 'plan-${token}'
    location: location
    tags: tags
    kind: 'linux'
    skuName: 'B1'
    skuCapacity: 1
    zoneRedundant: false
  }
}

module web 'br/public:avm/res/web/site@sha256:7d528404c437967a069a1635f46c550063a182d6bdb9e193edfa457edeb8b617' = {
  scope: rg
  params: {
    name: appName
    location: location
    tags: union(tags, { 'azd-service-name': 'web' })
    kind: 'app,linux,container'
    serverFarmResourceId: plan.outputs.resourceId
    httpsOnly: true
    managedIdentities: { userAssignedResourceIds: [identity.outputs.resourceId] }
    virtualNetworkSubnetResourceId: vnet.outputs.subnetResourceIds[0]
    // Only private-IP traffic (Postgres/Blob private endpoints) goes through the VNet; internet
    // egress (ACR pull, Entra, feeds, OAuth, App Insights) uses App Service's outbound IPs.
    // ponytail: route-all needs a NAT gateway (~US$35/mo) — the VNet has no internet egress.
    outboundVnetRouting: { allTraffic: false, imagePullTraffic: false }
    publicNetworkAccess: 'Enabled'
    siteConfig: {
      ipSecurityRestrictionsDefaultAction: 'Deny'
      ipSecurityRestrictions: [for (ip, i) in ips: { name: 'allowed-${i}', ipAddress: '${ip}/32', action: 'Allow', priority: 100 + i }]
      scmIpSecurityRestrictionsUseMain: true
      linuxFxVersion: linuxFxVersion
      acrUseManagedIdentityCreds: true
      acrUserManagedIdentityID: identity.outputs.clientId
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
    }
    configs: [
      {
        name: 'appsettings'
        properties: {
          APPLICATIONINSIGHTS_CONNECTION_STRING: appInsights.outputs.connectionString
          OTEL_SERVICE_NAME: 'my-feeds-web'
          WEBSITES_PORT: string(appPort)
          PORT: string(appPort)
          WEBSITES_ENABLE_APP_SERVICE_STORAGE: 'false'
          ENVIRONMENT: 'production'
          DEBUG: 'false'
          DATABASE_URL: 'postgresql+asyncpg://myfeeds_runtime:${postgresRuntimePassword}@${postgres.outputs.fqdn!}:5432/${postgresDb}?ssl=require'
          SECRET_KEY: secretKey
          OAUTH_REDIRECT_BASE_URL: publicUrl
          FRONTEND_URL: publicUrl
          AUDIO_CACHE_PROVIDER: 'azure_blob'
          AUDIO_CACHE_DIR: '/var/cache/my-feeds/audio'
          AZURE_BLOB_SERVICE_URL: storage.outputs.primaryBlobEndpoint
          AZURE_BLOB_CONTAINER_NAME: 'audio-cache'
          TTS_PROVIDER: 'azure'
          EXTERNAL_TTS_ENABLED: string(allowExternalTts)
          ALLOW_EXTERNAL_IMAGES: string(allowExternalImages)
          AZURE_SPEECH_ENDPOINT: allowExternalTts ? speech!.outputs.endpoint : ''
          AZURE_CLIENT_ID: identity.outputs.clientId
          GITHUB_CLIENT_ID: githubClientId
          GITHUB_CLIENT_SECRET: githubClientSecret
          GOOGLE_CLIENT_ID: googleClientId
          GOOGLE_CLIENT_SECRET: googleClientSecret
          MICROSOFT_CLIENT_ID: microsoftClientId
          MICROSOFT_CLIENT_SECRET: microsoftClientSecret
        }
      }
    ]
  }
}

var publicUrl = 'https://${appName}.azurewebsites.net'

// Re-provisioning must not reset the app to the placeholder image: reuse the running image.
resource existingWebConfig 'Microsoft.Web/sites/config@2024-04-01' existing = if (webExists) {
  scope: rg
  name: '${appName}/web'
}
var placeholderImage = 'DOCKER|mcr.microsoft.com/appsvc/staticsite@sha256:366d05990d9ed872b74da05477605f4ac6f6a5671dda2b2135a1059f710b63ef'
var linuxFxVersion = webExists
  ? existingWebConfig!.properties.linuxFxVersion
  : (empty(webImageName) ? placeholderImage : 'DOCKER|${webImageName}')

output AZURE_RESOURCE_GROUP string = rg.name
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = registry.outputs.loginServer
output AZURE_CONTAINER_REGISTRY_NAME string = registry.outputs.name
output AZURE_POSTGRES_FQDN string = postgres.outputs.fqdn!
output AZURE_POSTGRES_ADMIN_USER string = postgresUser
output WEB_APP_NAME string = web.outputs.name
output SERVICE_WEB_NAME string = web.outputs.name
output SERVICE_WEB_URI string = publicUrl
output SERVICE_WEB_RESOURCE_EXISTS bool = true
output SERVICE_WEB_IMAGE_NAME string = replace(linuxFxVersion, 'DOCKER|', '')
