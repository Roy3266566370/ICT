import re
t = "设F(x)=∫_x^{x^2} t dt，求F'(x)（）"
match = re.search(
    r'F\s*\(\s*([A-Za-z])\s*\)\s*=\s*∫\s*_\s*\{?([^\s{}^]+)\}?'
    r'\s*\^\s*\{?([^\s{}d]+?)\}?\s*(.+?)\s*d\s*([A-Za-z])(?![A-Za-z])',
    t, flags=re.I | re.S,
)
print('match:', match.groups() if match else None)
