import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.recognize import build_problem
p = build_problem("设F(x)=∫_x^{x~2} t dt，求F'(x)（）")
print('upper:', repr(p['model'].get('upper_expression')))
print('lower:', repr(p['model'].get('lower_expression')))
print('expr:', repr(p['model'].get('expression')))
