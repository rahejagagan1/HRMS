$files = Get-ChildItem -Path "d:\nb_dashboard\src\app\dashboard\hr" -Filter "page.tsx" -Recurse
foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    $newContent = $content -replace 'space-y-0 -mx-6 -mt-6', 'space-y-0'
    if ($content -ne $newContent) {
        Set-Content -Path $file.FullName -Value $newContent -NoNewline
        Write-Output "Fixed: $($file.FullName)"
    }
}
Write-Output "Done"
