import re

with open("apps/api/internal/repositories/user_repository.go", "r") as f:
    content = f.read()

# Replace " / 100" with "" but only in lines that don't contain "recoveryRate" or "monthlyGrowth"
lines = content.split('\n')
new_lines = []
for line in lines:
    if "recoveryRate" in line or "monthlyGrowth" in line:
        new_lines.append(line)
    elif " / 100" in line:
        # if it's something like float64(amount) / 100, we just want float64(amount)
        # if it's amount / 100, we want amount
        new_line = re.sub(r'\s*/\s*100', '', line)
        new_lines.append(new_line)
    elif "* 100" in line:
        new_line = re.sub(r'\s*\*\s*100', '', line)
        new_lines.append(new_line)
    else:
        new_lines.append(line)

with open("apps/api/internal/repositories/user_repository.go", "w") as f:
    f.write('\n'.join(new_lines))

print("Fixed user_repository.go")
