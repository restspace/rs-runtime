# Define the file path
$filePath = "C:\dev\rs-runtime\bundled.js"

# Define the mapping of strings to replace
$replacements = @{
    "URL(""./worker-file.ts"", import.meta.url)" = "URL(""./worker-file.ts"", ""https://deno.land/x/denomailer@1.6.0/client/worker/worker.ts"")"
    "URL(""worker.ts"", import.meta.url)" = "URL(""worker.ts"", ""https://jsr.io/@da/bcrypt/1.0.1/src/main.ts"")"
}

# Read the file content
$fileContent = Get-Content -Path $filePath

# Process each line and replace the strings
$fileContent = $fileContent | ForEach-Object {
    $line = $_
    foreach ($key in $replacements.Keys) {
        $line = $line -replace [regex]::Escape($key), $replacements[$key]
    }
    $line
}

# Write the updated content back to the file
Set-Content -Path $filePath -Value $fileContent

Write-Host "Replacements completed."
