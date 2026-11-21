# Sube a Vercel las variables de entorno del SGIM, leyéndolas de backend/.env y frontend/.env.
# Antes: npx vercel@65.9.0 login   y   npx vercel@65.9.0 link   (en esta carpeta).
# Uso:   powershell -NoProfile -ExecutionPolicy Bypass -File .\vercel-variables.ps1
# - DATABASE_URL: pide la de Neon (no se usa la local).
# - JWT_SECRET y CRON_SECRET: genera unos nuevos para producción; CRON_SECRET se guarda en backend/.env para configurar el cron.
# Ningún valor se muestra en pantalla.
$ErrorActionPreference = 'Stop'
$raiz = $PSScriptRoot
$vercel = 'vercel@65.9.0'

function Leer-Env($archivo) {
    $v = @{}
    foreach ($l in Get-Content $archivo) {
        if ($l -match '^\s*([A-Z_][A-Z0-9_]*)\s*=(.*)$') { $v[$matches[1]] = $matches[2].Trim() }
    }
    return $v
}
function Subir($nombre, $valor) {
    if (-not $valor) { Write-Host "  - $nombre (vacía, se omite)" -ForegroundColor DarkGray; return }
    & npx --yes $vercel env rm $nombre production --yes 2>$null | Out-Null
    $valor | & npx --yes $vercel env add $nombre production | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "No se pudo subir $nombre" }
    Write-Host "  ✔ $nombre" -ForegroundColor Green
}

$back = Leer-Env "$raiz\backend\.env"
$front = Leer-Env "$raiz\frontend\.env"

$seguro = Read-Host 'Pega la cadena de conexión de Neon (DATABASE_URL de producción)' -AsSecureString
$neon = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro))
if ($neon -notmatch '^postgres(ql)?://') { throw 'La cadena debe empezar con postgresql://' }

$jwt = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$cron = $back['CRON_SECRET']
if (-not $cron) {
    $cron = [guid]::NewGuid().ToString('N')
    Add-Content -Path "$raiz\backend\.env" -Value "`r`nCRON_SECRET=$cron" -Encoding ascii
}

Write-Host 'Subiendo variables a Vercel (producción)...'
Subir 'DATABASE_URL' $neon
Subir 'JWT_SECRET' $jwt
Subir 'CRON_SECRET' $cron
foreach ($n in 'WA_TOKEN', 'WA_PHONE_NUMBER_ID', 'WA_VERIFY_TOKEN', 'WA_APP_SECRET', 'WA_APP_ID', 'GEMINI_API_KEY', 'GEMINI_MODELO', 'GEMINI_MODELO_RESPALDO', 'CORREO_USUARIO', 'CORREO_CLAVE_APP') {
    Subir $n $back[$n]
}
Subir 'VITE_WHATSAPP_NUMERO' $front['VITE_WHATSAPP_NUMERO']
Write-Host ''
Write-Host 'Listo. Falta conectar Vercel Blob (Storage) al proyecto y volver a desplegar: npx vercel@65.9.0 --prod' -ForegroundColor Cyan
