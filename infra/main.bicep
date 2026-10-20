targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the azd environment; used to derive resource names.')
param environmentName string

@description('All resources deploy to Canada Central.')
@allowed(['canadacentral'])
param location string = 'canadacentral'

@description('Comma-separated IPv4 addresses allowed to reach the web app and Postgres, e.g. "1.2.3.4,5.6.7.8". Empty = no public access.')
param allowedIps string = ''

@description('Port the container listens on (PORT for the app, WEBSITES_PORT for App Service).')
param appPort int = 8000

@secure()
@metadata({ azd: { type: 'generate', config: { length: 32, noSpecial: true } } })
param postgresPassword string

@secure()
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
var appName = 'app-web-${token}'
var ips = filter(map(split(allowedIps, ','), ip => trim(ip)), ip => !empty(ip))
var privateDnsZoneNames = [
  'privatelink.blob.${environment().suffixes.storage}'
  'privatelink.postgres.database.azure.com'
]

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module vnet 'br/public:avm/res/network/virtual-network:0.10.2' = {
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

module dnsZones 'br/public:avm/res/network/private-dns-zone:0.8.1' = [
  for zone in privateDnsZoneNames: {
    scope: rg
    params: {
      name: zone
      tags: tags
      virtualNetworkLinks: [{ virtualNetworkResourceId: vnet.outputs.resourceId }]
    }
  }
]

module identity 'br/public:avm/res/managed-identity/user-assigned-identity:0.6.0' = {
  scope: rg
  params: {
    name: 'id-${token}'
    location: location
    tags: tags
  }
}

module registry 'br/public:avm/res/container-registry/registry:0.13.1' = {
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
    roleAssignments: [
      {
        principalId: identity.outputs.principalId
        principalType: 'ServicePrincipal'
        roleDefinitionIdOrName: 'AcrPull'
      }
    ]
  }
}

module storage 'br/public:avm/res/storage/storage-account:0.33.1' = {
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

module postgres 'br/public:avm/res/db-for-postgre-sql/flexible-server:0.16.1' = {
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
    firewallRules: [for (ip, i) in ips: { name: 'allowed-${i}', startIpAddress: ip, endIpAddress: ip }]
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

module plan 'br/public:avm/res/web/serverfarm:0.7.0' = {
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

module web 'br/public:avm/res/web/site:0.24.0' = {
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
    outboundVnetRouting: { allTraffic: true }
    publicNetworkAccess: 'Enabled'
    siteConfig: {
      ipSecurityRestrictionsDefaultAction: 'Deny'
      ipSecurityRestrictions: [for (ip, i) in ips: { name: 'allowed-${i}', ipAddress: '${ip}/32', action: 'Allow', priority: 100 + i }]
      scmIpSecurityRestrictionsUseMain: true
      // Placeholder until `azd deploy` pushes the real image.
      linuxFxVersion: 'DOCKER|mcr.microsoft.com/appsvc/staticsite:latest'
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
          WEBSITES_PORT: string(appPort)
          PORT: string(appPort)
          WEBSITES_ENABLE_APP_SERVICE_STORAGE: 'false'
          ENVIRONMENT: 'production'
          DEBUG: 'false'
          DATABASE_URL: 'postgresql+asyncpg://${postgresUser}:${postgresPassword}@${postgres.outputs.fqdn!}:5432/${postgresDb}?ssl=require'
          SECRET_KEY: secretKey
          OAUTH_REDIRECT_BASE_URL: publicUrl
          FRONTEND_URL: publicUrl
          AUDIO_CACHE_PROVIDER: 'azure_blob'
          AZURE_BLOB_SERVICE_URL: storage.outputs.primaryBlobEndpoint
          AZURE_BLOB_CONTAINER_NAME: 'audio-cache'
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

output AZURE_RESOURCE_GROUP string = rg.name
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = registry.outputs.loginServer
output SERVICE_WEB_NAME string = web.outputs.name
output SERVICE_WEB_URI string = publicUrl
