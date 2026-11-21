p = r'E:\代码\ICT\frontend\src\living\blockRegistry.ts'
src = open(p, encoding='utf-8').read()
lines = src.splitlines(keepends=True)
target = '/[\\s\\\\\\u0000-\\u001f\\u007f]/'
# 目标是 TS 源码字面量: /[\s\\\u0000-\u001f\u007f]/
for i, line in enumerate(lines):
    if 'parsed.username' in line:
        indent = line[:len(line) - len(line.lstrip())]
        lines[i] = indent + '|| parsed.username || parsed.password || ' + target + '.test(url) || url.length > 2000) throw new Error();\n'
open(p, 'w', encoding='utf-8', newline='').write(''.join(lines))
for line in ''.join(lines).splitlines():
    if 'parsed.username' in line:
        print(repr(line))
