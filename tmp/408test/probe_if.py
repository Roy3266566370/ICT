import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.recognize import build_problem
p = build_problem("设F(x)=∫_x^{x~2} t dt，求F'(x)（）")
print(list(p['model'].keys()))
print(str(p['model'].get('conditions'))[:250])
