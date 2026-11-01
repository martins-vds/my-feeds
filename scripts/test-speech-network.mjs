import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const bicepFile = fileURLToPath(new URL("../infra/main.bicep", import.meta.url));
const compiled = process.platform === "win32"
  ? spawnSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    `& az bicep build --file '${bicepFile.replace(/'/g, "''")}' --stdout; exit $LASTEXITCODE`,
  ], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 })
  : spawnSync("az", ["bicep", "build", "--file", bicepFile, "--stdout"], {
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
  });
assert.equal(compiled.status, 0, compiled.stderr);
const template = JSON.parse(compiled.stdout);
const speech = template.resources.speech;
const parameters = speech.properties.parameters;

test("Speech deploys private-only with resource-hostname Entra authentication", () => {
  assert.equal(speech.condition, "[parameters('allowExternalTts')]");
  assert.equal(parameters.publicNetworkAccess.value, "Disabled");
  assert.equal(parameters.disableLocalAuth.value, true);
  assert.equal(parameters.customSubDomainName.value, "[variables('speechName')]");
  assert.deepEqual(parameters.roleAssignments.value, [{
    principalId: "[reference('identity').outputs.principalId.value]",
    principalType: "ServicePrincipal",
    roleDefinitionIdOrName: "Cognitive Services Speech User",
  }]);
});

test("Speech endpoint connects its account group to the private subnet and linked DNS zone", () => {
  assert.ok(Array.isArray(parameters.privateEndpoints?.value));
  assert.equal(parameters.privateEndpoints.value.length, 1);
  const endpoint = parameters.privateEndpoints.value[0];
  assert.equal(endpoint.service, "account");
  assert.equal(endpoint.subnetResourceId, "[reference('vnet').outputs.subnetResourceIds.value[1]]");
  assert.deepEqual(endpoint.privateDnsZoneGroup, {
    name: "default",
    privateDnsZoneGroupConfigs: [{
      name: "speech",
      privateDnsZoneResourceId: "[reference(format('dnsZones[{0}]', 2)).outputs.resourceId.value]",
    }],
  });
  assert.equal(template.variables.privateDnsZoneNames[2], "privatelink.cognitiveservices.azure.com");
  assert.deepEqual(template.resources.dnsZones.properties.parameters.virtualNetworkLinks.value, [{
    virtualNetworkResourceId: "[reference('vnet').outputs.resourceId.value]",
  }]);
});

test("App Service retains separate delegated integration and split internet routing", () => {
  const web = template.resources.web.properties.parameters;
  assert.equal(web.virtualNetworkSubnetResourceId.value, "[reference('vnet').outputs.subnetResourceIds.value[0]]");
  assert.deepEqual(web.outboundVnetRouting.value, { allTraffic: false, imagePullTraffic: false });
});
