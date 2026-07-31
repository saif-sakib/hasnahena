import re

with open("/home/sword/.gemini/antigravity/brain/3ce98a55-5827-4d74-9037-4f0370d5e76d/task.md", "r") as f:
    content = f.read()

content = content.replace("[ ]", "[x]")
content = content.replace("[/]", "[x]")

with open("/home/sword/.gemini/antigravity/brain/3ce98a55-5827-4d74-9037-4f0370d5e76d/task.md", "w") as f:
    f.write(content)
