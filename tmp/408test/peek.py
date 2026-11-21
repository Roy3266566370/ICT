import re, sys
path = sys.argv[1]
needle = sys.argv[2]
span = int(sys.argv[3]) if len(sys.argv) > 3 else 1200
src = open(path, encoding='utf8').read()
i = src.find(needle)
print(src[max(0, i - 200):i + span] if i >= 0 else 'NOT FOUND: ' + needle)
