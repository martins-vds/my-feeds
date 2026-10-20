param serverName string
param ips array

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' existing = {
  name: serverName
}

@batchSize(1)
resource rules 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = [
  for (ip, i) in ips: {
    parent: server
    name: 'allowed-${i}'
    properties: { startIpAddress: ip, endIpAddress: ip }
  }
]
