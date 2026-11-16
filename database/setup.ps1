# Crea la base de datos sgim, ejecuta los scripts y guarda la conexion en backend/.env
# Uso:  & .\database\setup.ps1
$ErrorActionPreference = 'Stop'
$psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
$root = Split-Path -Parent $PSScriptRoot

$secure = Read-Host 'Contrasena del usuario postgres' -AsSecureString
$plain  = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
$env:PGPASSWORD = $plain
$env:PGCLIENTENCODING = 'UTF8'

$existe = & $psql -U postgres -h localhost -tAc "SELECT 1 FROM pg_database WHERE datname='sgim'"
if ($LASTEXITCODE -ne 0) { throw 'No se pudo conectar a PostgreSQL. Revisa la contrasena.' }

if ($existe -eq '1') {
    $resp = Read-Host 'La base sgim ya existe. Borrarla y crearla de nuevo? (s/n)'
    if ($resp -ne 's') { Write-Host 'Cancelado.'; exit 0 }
    & $psql -U postgres -h localhost -c 'DROP DATABASE sgim' | Out-Null
}

& $psql -U postgres -h localhost -c "CREATE DATABASE sgim ENCODING 'UTF8'" | Out-Null
& $psql -U postgres -h localhost -d sgim -v ON_ERROR_STOP=1 -q -f "$root\database\01_schema.sql"
if ($LASTEXITCODE -ne 0) { throw 'Error en 01_schema.sql' }
& $psql -U postgres -h localhost -d sgim -v ON_ERROR_STOP=1 -q -f "$root\database\02_seed.sql"
if ($LASTEXITCODE -ne 0) { throw 'Error en 02_seed.sql' }
Get-ChildItem "$root\database" -Filter '*_migracion*.sql' | Sort-Object Name | ForEach-Object {
    & $psql -U postgres -h localhost -d sgim -v ON_ERROR_STOP=1 -q -f $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "Error en $($_.Name)" }
}

New-Item -ItemType Directory -Force "$root\backend" | Out-Null
$enc = [Uri]::EscapeDataString($plain)
$lines = @(
    "DATABASE_URL=postgres://postgres:$enc@localhost:5432/sgim",
    "PORT=3000",
    "JWT_SECRET=$([guid]::NewGuid().ToString('N'))$([guid]::NewGuid().ToString('N'))"
)
Set-Content -Path "$root\backend\.env" -Value $lines -Encoding ascii

Write-Host ''
Write-Host 'Base de datos sgim creada correctamente.' -ForegroundColor Green
& $psql -U postgres -h localhost -d sgim -tAc "SELECT 'Tablas: ' || count(*) FROM information_schema.tables WHERE table_schema='sgim' AND table_type='BASE TABLE'"
Remove-Item Env:PGPASSWORD
