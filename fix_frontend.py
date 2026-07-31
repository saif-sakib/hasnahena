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

    # Rename parseAmountToPaisa to parseAmount
    content = content.replace("parseAmountToPaisa", "parseAmount")
    
    # Remove * 100 in Math.round(parsed * 100) or amountPaisa calculations
    content = re.sub(r'Math\.round\(([^)]+)\s*\*\s*100\)', r'Math.round(\1)', content)
    
    # Change amountPaisa to amountTaka or just amountVal
    content = content.replace("amountPaisa", "amountVal")
    
    # Remove * 100 in conditional checks like: member.currentDeposit * 100
    content = re.sub(r'([A-Za-z0-9_\.]+)\s*\*\s*100', r'\1', content)

    with open(file_path, "w") as f:
        f.write(content)
    print(f"Fixed {file_path}")

