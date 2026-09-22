param([string]$AdminEmail = "admin@careline.local")
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Push-Location $root
function Run-Checked([scriptblock]$Command) { & $Command; if ($LASTEXITCODE -ne 0) { throw "Command failed ($LASTEXITCODE)." } }
function New-LocalSecret {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes); return [Convert]::ToBase64String($bytes) } finally { $rng.Dispose() }
}
try {
    Get-Command dotnet, docker -ErrorAction Stop | Out-Null
    if (!(Test-Path .env)) { Set-Content .env ("POSTGRES_PASSWORD=" + (New-LocalSecret)) -Encoding ascii }
    $line = Get-Content .env | Where-Object { $_ -match '^POSTGRES_PASSWORD=' } | Select-Object -First 1
    if (!$line) { throw "POSTGRES_PASSWORD is missing from .env." }
    $dbPassword = $line.Substring('POSTGRES_PASSWORD='.Length)
    if ($dbPassword -match '[;\r\n]') { throw "Use a base64 or alphanumeric local database password." }
    Run-Checked { docker compose up -d --wait }
    $api = 'src/Appointments.Api'
    Run-Checked { dotnet user-secrets set 'ConnectionStrings:Appointments' "Host=localhost;Port=55432;Database=appointments_dev;Username=careline_app;Password=$dbPassword" --project $api }
    # Preserve the initial bootstrap password on repeated setup runs.
    $credentialsFile = '.local-admin.json'
    if (Test-Path $credentialsFile) { $credentials = Get-Content $credentialsFile -Raw | ConvertFrom-Json }
    else {
        $credentials = @{ Email = $AdminEmail; Password = (New-LocalSecret) }
        $credentials | ConvertTo-Json | Set-Content $credentialsFile -Encoding utf8
    }
    Run-Checked { dotnet user-secrets set 'Bootstrap:Email' $credentials.Email --project $api }
    Run-Checked { dotnet user-secrets set 'Bootstrap:Password' $credentials.Password --project $api }
    Run-Checked { dotnet restore Appointments.sln }
    Write-Host 'Database is ready. Open Appointments.sln, select Careline - API and Web, and press F5.'
    Write-Host 'Your initial administrator credentials are in .local-admin.json (ignored by Git).'
    Write-Host 'After first sign-in, change the password, remove the Bootstrap user-secrets, and delete that local credentials file.'
} finally { Pop-Location }
