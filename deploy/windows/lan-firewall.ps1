# Windows Firewall rule for Mehran Planner LAN access (run in an ELEVATED PowerShell).
#   .\deploy\windows\lan-firewall.ps1 -LanIp 192.168.1.20 -Subnet 192.168.1.0/24 [-SetPrivateProfile]
# Allows only TCP <Port> to the host LAN IP from the trusted subnet, on the Private
# profile. Nothing else (NPM admin 81, PostgreSQL, API, ClamAV) is opened.
# -SetPrivateProfile switches the LAN interface from Public to Private (do this only
# on your own trusted network). Re-running replaces this script's own rule only.
param(
  [Parameter(Mandatory)][ipaddress]$LanIp,
  [Parameter(Mandatory)][ValidatePattern('^\d{1,3}(\.\d{1,3}){3}/(1[6-9]|2\d|3[0-2])$')][string]$Subnet,
  [int]$Port = 443,
  [switch]$SetPrivateProfile
)
$ErrorActionPreference = 'Stop'
$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this script in an elevated (Administrator) PowerShell.'
}
$address = Get-NetIPAddress -AddressFamily IPv4 -IPAddress $LanIp.IPAddressToString
$netProfile = Get-NetConnectionProfile -InterfaceIndex $address.InterfaceIndex
if ($netProfile.NetworkCategory -ne 'Private') {
  if (-not $SetPrivateProfile) {
    throw "Interface '$($netProfile.InterfaceAlias)' is $($netProfile.NetworkCategory). Re-run with -SetPrivateProfile on your trusted home network."
  }
  Set-NetConnectionProfile -InterfaceIndex $address.InterfaceIndex -NetworkCategory Private
}
$name = 'Mehran Planner HTTPS (LAN only)'
Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Protocol TCP `
  -LocalAddress $LanIp.IPAddressToString -LocalPort $Port -RemoteAddress $Subnet `
  -Profile Private -Description 'Mehran Planner via Nginx Proxy Manager; trusted subnet only.' | Out-Null
Get-NetFirewallRule -DisplayName $name | ForEach-Object {
  '{0}: TCP {1} -> {2} from {3} (profile {4})' -f $_.DisplayName,
  ($_ | Get-NetFirewallPortFilter).LocalPort, $LanIp, ($_ | Get-NetFirewallAddressFilter).RemoteAddress, $_.Profile
}
