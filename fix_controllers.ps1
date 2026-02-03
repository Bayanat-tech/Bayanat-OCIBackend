# Fix all HR controller imports and usages
$files = @(
  'src/controllers/Attendance/dashboard.controller.ts',
  'src/controllers/Attendance/Employee.controller.ts',
  'src/controllers/HR/designation_hr.controller.ts',
  'src/controllers/HR/formaldesignation_hr.controller.ts',
  'src/controllers/HR/grade_hr.controller.ts',
  'src/controllers/HR/hr_employee.controller.ts',
  'src/controllers/HR/hr_kpiName.controller.ts',
  'src/controllers/HR/hr_kpiOperationController.ts',
  'src/controllers/HR/hr_pay_component.controller.ts',
  'src/controllers/HR/hr_section.controller.ts'
)

foreach ($file in $files) {
  $content = Get-Content -Path $file -Raw
  
  # Replace import: AppDataSource -> getRepository
  $content = $content -replace "import\s*{\s*AppDataSource", "import { getRepository"
  
  # Replace: AppDataSource.getRepository( -> getRepository(
  $content = $content -replace "AppDataSource\.getRepository\s*\(", "getRepository("
  
  # Keep AppDataSource if it's still needed (for oracleDb)
  if ($content -match "oracleDb") {
    $content = $content -replace "import\s*{\s*getRepository", "import { AppDataSource, getRepository"
  }
  
  Set-Content -Path $file -Value $content
  Write-Host "Fixed: $file"
}
