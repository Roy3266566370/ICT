import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs import advanced_calc_text as adv
t = '求参数曲线x=cos t,y=sin t在0≤t≤2π上的弧长（）'
print('pair:', adv._parametric_pair(t))
print('bounds:', adv._interval_bounds(t, 't'))
print('arc:', adv._arc_length(t, {}, {}))
