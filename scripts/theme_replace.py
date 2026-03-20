import os

directory = r"\\wsl.localhost\Ubuntu-22.04\home\hash\my-aproject\frontend\app"

replacements = [
    ("#0A0F1E", "#000000"),
    ("#0a0f1e", "#000000"),
    ("#6366F1", "#ff1a1a"),
    ("#6366f1", "#ff1a1a"),
    ("#111828", "#0a0a0a"),
    ("#818CF8", "#ff4d4d"),
    ("#818cf8", "#ff4d4d"),
    ("indigo-500", "red-600"),
    ("indigo-400", "red-500"),
    ("indigo-300", "red-400"),
    ("indigo-950", "red-950"),
    ("indigo", "red"),
]

def replace_in_file(filepath):
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
        orig = content
        for old, new in replacements:
            content = content.replace(old, new)
        if content != orig:
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(content)
            print("Updated", filepath)
    except Exception as e:
        print("Error", filepath, e)

for root, dirs, files in os.walk(directory):
    for filename in files:
        if filename.endswith(".tsx") or filename.endswith(".css"):
            filepath = os.path.join(root, filename)
            replace_in_file(filepath)
