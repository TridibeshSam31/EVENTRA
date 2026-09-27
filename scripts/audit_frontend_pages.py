import glob
import re

print("=== AUDIT OF ALL APPS/WEB PAGES ===")
for f in sorted(glob.glob("apps/web/app/**/page.tsx", recursive=True)):
    with open(f, "r", encoding="utf-8", errors="ignore") as fp:
        content = fp.read()
    apis = set(re.findall(r"from ['\"]([^'\"]*(?:api|mockData|stores|hooks)[^'\"]*)['\"]", content))
    has_mock = "mock" in content.lower()
    has_dummy = "dummy" in content.lower() or "sample" in content.lower()
    # Check for hardcoded inline data arrays
    inline_data = bool(re.search(r"const\s+[A-Za-z0-9_]*(?:MOCK|DUMMY|SAMPLE|INITIAL_|FALLBACK_)[A-Za-z0-9_]*\s*=", content, re.IGNORECASE))
    print(f"\nFile: {f}")
    print(f"  Lines: {len(content.splitlines())}")
    print(f"  Imports: {list(apis)}")
    print(f"  Has 'mock' string: {has_mock} | Has 'dummy/sample': {has_dummy} | Has hardcoded const: {inline_data}")
