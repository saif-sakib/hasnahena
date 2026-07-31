import os
import re

files_to_fix = [
    "apps/web/app/[locale]/dashboard/admin/donations/page.tsx",
    "apps/web/app/[locale]/dashboard/admin/members/[id]/page.tsx",
    "apps/web/app/[locale]/dashboard/member/deposits/page.tsx",
    "apps/web/app/[locale]/dashboard/member/loans/page.tsx",
    "apps/web/app/[locale]/dashboard/member/profile/page.tsx",
    "apps/web/app/[locale]/dashboard/worker/deposits/page.tsx",
    "apps/web/app/[locale]/dashboard/worker/loans/page.tsx"
]

for file_path in files_to_fix:
    if not os.path.exists(file_path):
        continue
    with open(file_path, "r") as f:
        content = f.read()

    # Rename maxPaymentPaisa to maxPaymentVal
    content = content.replace("maxPaymentPaisa", "maxPaymentVal")
    
    # Fix the weird spacing like Math.round(parsed ) to Math.round(parsed)
    content = content.replace("Math.round(parsed )", "Math.round(parsed)")
    content = content.replace("Math.round(selectedLoanForPayment.remainingAmount )", "Math.round(selectedLoanForPayment.remainingAmount)")

    with open(file_path, "w") as f:
        f.write(content)
    print(f"Fixed spacing in {file_path}")

