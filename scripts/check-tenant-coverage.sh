#!/usr/bin/env bash
# =============================================================================
# scripts/check-tenant-coverage.sh
# =============================================================================
# CI check: Ensures every Mongoose model with a 'hospital' field
# also has the multiTenancyPlugin applied.
#
# Usage:
#   bash scripts/check-tenant-coverage.sh
#
# Add to package.json scripts:
#   "audit:tenant": "bash scripts/check-tenant-coverage.sh"
#
# Add to CI pipeline:
#   - run: npm run audit:tenant
# =============================================================================

set -e

BACKEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MISSING=0

# Known intentional exceptions (models that should NOT have the plugin)
EXCEPTIONS=(
  "Auth/Models/OTP.ts"           # Ephemeral auth tokens — not hospital-scoped
  "Auth/Models/SuperAdmin.ts"    # Global entity by design
  "Hospital/Models/Hospital.ts"  # IS the tenant itself
  "Patient/Models/PatientHospitalMap.ts"  # Cross-tenant mapping table
  "Emergency/Models/EmergencyRequest.ts"  # Multi-hospital by design
  "Admin/Models/AuditLog.ts"     # Global audit table — intentionally unscoped
  "Notification/Models/Announcement.ts"  # hospital is optional (null=global); controller filters
)

echo ""
echo "🔍 Multi-Tenancy Plugin Coverage Check"
echo "======================================="
echo "Scanning: $BACKEND_DIR"
echo ""

is_exception() {
  local file="$1"
  for exc in "${EXCEPTIONS[@]}"; do
    if [[ "$file" == *"$exc" ]]; then
      return 0
    fi
  done
  return 1
}

while IFS= read -r filepath; do
  # Skip index files
  [[ "$(basename "$filepath")" == "index.ts" ]] && continue

  # Check if file has a hospital field definition
  HAS_HOSPITAL=$(grep -c '"hospital"\|hospital:' "$filepath" 2>/dev/null || true)

  if [[ "$HAS_HOSPITAL" -gt "0" ]]; then
    # Check if it also has the plugin
    HAS_PLUGIN=$(grep -c "multiTenancyPlugin" "$filepath" 2>/dev/null || true)

    if [[ "$HAS_PLUGIN" -eq "0" ]]; then
      # Check if it's in the exceptions list
      if is_exception "$filepath"; then
        echo "  ⚪ EXCEPTION (intentional): $filepath"
        continue
      fi

      echo "  ❌ MISSING PLUGIN: $filepath"
      MISSING=$((MISSING + 1))
    else
      echo "  ✅ Protected: $filepath"
    fi
  fi
done < <(find "$BACKEND_DIR" -path "*/node_modules" -prune -o \
         -name "*.ts" -path "*/Models/*" -print | sort)

echo ""
echo "======================================="

if [[ "$MISSING" -gt "0" ]]; then
  echo "❌ FAILED: $MISSING model(s) have a 'hospital' field but are missing multiTenancyPlugin!"
  echo ""
  echo "Fix: Add the following to each flagged model:"
  echo "  import multiTenancyPlugin from '../../middleware/tenantPlugin.js';"
  echo "  yourSchema.plugin(multiTenancyPlugin);"
  echo ""
  exit 1
else
  echo "✅ PASSED: All hospital-scoped models have multiTenancyPlugin coverage!"
  echo ""
  exit 0
fi
