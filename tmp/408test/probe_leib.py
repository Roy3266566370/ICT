import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs import advanced_calc_text as adv
t = "设F(x)=∫_x^{x^2} t dt，求F'(x)（）"
print('integral_function:', adv._integral_function(t, {}, {}))
print('advanced:', adv.build_advanced_calc_from_text(t, {}, {}))
