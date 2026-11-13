
/* ================================================================
   万象概念站 —— 活对象流通系统
   三个真实可玩的对象：矩阵变换 / 梯度下降 / 交换律对比 / 函数曲线
   ================================================================ */

/* ---------- 工具 ---------- */
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const SVGNS='http://www.w3.org/2000/svg';
function el(tag,attrs={},parent){const e=document.createElementNS(SVGNS,tag);for(const k in attrs)e.setAttribute(k,attrs[k]);if(parent)parent.appendChild(e);return e}
const fmt=(v,d=2)=>{const s=(+v).toFixed(d);return s.replace(/\.?0+$/,'')||'0'};
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
function toast(msg,ms=2400){const t=document.createElement('div');t.className='toast';t.innerHTML='<span class="tk">◉</span>'+msg;$('#toasts').appendChild(t);setTimeout(()=>{t.style.opacity=0;t.style.transition='opacity .3s';setTimeout(()=>t.remove(),320)},ms)}
function closeModal(id){$('#'+id).classList.remove('on')}

/* ---------- 路由 ---------- */
const views={space:'#/space',doc:'#/doc',canvas:'#/canvas',share:'#/share',library:'#/library'};
function route(){
  const h=location.hash||'#/space';
  const v=Object.keys(views).find(k=>views[k]===h)||'space';
  $$('.view').forEach(s=>s.classList.toggle('on',s.dataset.view===v));
  $$('.nav a').forEach(a=>a.classList.toggle('on',a.dataset.nav===v));
  if(v==='share')renderShare();
  if(v==='canvas')requestAnimationFrame(()=>requestAnimationFrame(redrawWires));
}
window.addEventListener('hashchange',route);

/* ================================================================
   对象工厂 1：矩阵变换（旗舰对象——可拖列向量、可改矩阵、实时读数）
   ================================================================ */
function MatrixPlay(mount,opt={}){
  const M=Object.assign({a:1,b:0,c:0,d:1},opt.params);
  const W=640,H=380,CX=300,CY=190,S=44,RN=5;  // 视窗/中心/比例/显示半径
  const wrap=document.createElement('div');wrap.className='objwrap';wrap.style.position='relative';
  wrap.innerHTML=`<svg class="objsvg" viewBox="0 0 ${W} ${H}"></svg>
    <div class="opanel">
      <div class="grp"><div class="gt">矩阵 A（也可直接拖图上列向量）</div>
        <div class="matgrid">
          <input data-k="a" value="${M.a}"><input data-k="b" value="${M.b}">
          <input data-k="c" value="${M.c}"><input data-k="d" value="${M.d}">
        </div>
        <div class="presets" style="margin-top:8px">
          <button data-p="I">单位</button><button data-p="rot">旋转90°</button>
          <button data-p="shear">剪切</button><button data-p="stretch">拉伸×2</button>
          <button data-p="proj">投影</button><button data-p="sing">奇异</button>
        </div>
      </div>
      <div class="grp"><div class="gt">实时读数</div><div class="readouts">
        <div class="ro"><span>det A</span><b data-r="det"></b></div>
        <div class="ro"><span>tr A</span><b data-r="tr"></b></div>
        <div class="ro"><span>rank</span><b data-r="rk"></b></div>
        <div class="ro"><span>面积倍率</span><b data-r="area"></b></div>
        <div class="ro" style="grid-column:1/3"><span>特征值</span><b data-r="eig" style="font-size:11px"></b></div>
        <div class="ro" style="grid-column:1/3"><span>解读</span><span data-r="say" style="font-size:11px;color:var(--ink-500)"></span></div>
      </div></div>
      ${opt.aiHand?`<button class="btn sm" data-ai style="border-color:var(--coral);color:var(--coral-ink)">✦ 让 AI 演给我看</button>`:''}
    </div>
    <div class="aihand">AI</div>`;
  mount.appendChild(wrap);
  const svg=$('svg',wrap);
  const px=(x,y)=>[CX+x*S,CY-y*S];
  // 原始网格（浅）
  for(let k=-RN;k<=RN;k++){
    el('line',{x1:px(k,-RN)[0],y1:px(k,-RN)[1],x2:px(k,RN)[0],y2:px(k,RN)[1],stroke:'#EDE7DA','stroke-width':1},svg);
    el('line',{x1:px(-RN,k)[0],y1:px(-RN,k)[1],x2:px(RN,k)[0],y2:px(RN,k)[1],stroke:'#EDE7DA','stroke-width':1},svg);
  }
  el('line',{x1:0,y1:CY,x2:W,y2:CY,stroke:'#D5CCB9','stroke-width':1.2},svg);
  el('line',{x1:CX,y1:0,x2:CX,y2:H,stroke:'#D5CCB9','stroke-width':1.2},svg);
  const latG=el('g',{stroke:'#C9C4F5','stroke-width':1,opacity:.85},svg);
  const ghostC=el('circle',{r:S,fill:'none',stroke:'#C7BFAE','stroke-dasharray':'4 4','stroke-width':1},svg);
  ghostC.setAttribute('cx',CX);ghostC.setAttribute('cy',CY);
  const ell=el('path',{fill:'rgba(79,70,229,.06)',stroke:'#4F46E5','stroke-width':1.6},svg);
  const eigG=el('g',{stroke:'#B8431F','stroke-width':1,'stroke-dasharray':'5 4',opacity:.8},svg);
  const v1=el('g',{},svg),v2=el('g',{},svg);
  function arrow(g,x,y,color,label){
    g.innerHTML='';const[ex,ey]=px(x,y);
    const ang=Math.atan2(CY-y*S-(CY),0)||Math.atan2(-(y),x);
    el('line',{x1:CX,y1:CY,x2:ex,y2:ey,stroke:color,'stroke-width':2.4,'stroke-linecap':'round'},g);
    const a=Math.atan2(ey-CY,ex-CX),hl=10;
    el('path',{d:`M${ex},${ey} L${ex-hl*Math.cos(a-.42)},${ey-hl*Math.sin(a-.42)} L${ex-hl*Math.cos(a+.42)},${ey-hl*Math.sin(a+.42)} Z`,fill:color},g);
    const t=el('text',{x:ex+8*Math.cos(a),y:ey-10,fill:color,'font-size':12,'font-weight':700,'font-family':'var(--mono)'},g);
    t.textContent=label;
    const h=el('circle',{cx:ex,cy:ey,r:9,fill:'#fff',stroke:color,'stroke-width':2.4,class:'draghandle'},g);
    return h;
  }
  function draw(){
    latG.innerHTML='';eigG.innerHTML='';
    const{a,b,c,d}=M;
    // 变换后晶格：竖线 x=k → 过 M·(k,t)
    for(let k=-RN;k<=RN;k++){
      const p1=px(a*k+b*-RN,c*k+d*-RN),p2=px(a*k+b*RN,c*k+d*RN);
      const p3=px(a*-RN+b*k,c*-RN+d*k),p4=px(a*RN+b*k,c*RN+d*k);
      el('line',{x1:p1[0],y1:p1[1],x2:p2[0],y2:p2[1]},latG);
      el('line',{x1:p3[0],y1:p3[1],x2:p4[0],y2:p4[1]},latG);
    }
    // 单位圆 → 椭圆
    let dPath='';
    for(let i=0;i<=64;i++){const t=i/64*2*Math.PI,x=a*Math.cos(t)+b*Math.sin(t),y=c*Math.cos(t)+d*Math.sin(t),p=px(x,y);
      dPath+=(i?'L':'M')+fmt(p[0],1)+','+fmt(p[1],1);}
    ell.setAttribute('d',dPath+'Z');
    // 特征方向
    const tr=a+d,det=a*d-b*c,disc=tr*tr-4*det;
    if(disc>1e-9){
      const sq=Math.sqrt(disc);
      for(const l of[(tr+sq)/2,(tr-sq)/2]){
        let vx,vy;
        if(Math.abs(b)>1e-9){vx=b;vy=l-a}else if(Math.abs(c)>1e-9){vx=l-d;vy=c}
        else{vx=(Math.abs(l-a)<1e-9)?1:0;vy=vx?0:1;if(!vx&&Math.abs(l-d)<1e-9){vx=0;vy=1}else if(!vx){vx=0;vy=1}}
        const n=Math.hypot(vx,vy)||1;vx/=n;vy/=n;
        el('line',{x1:px(-vx*RN,-vy*RN)[0],y1:px(-vx*RN,-vy*RN)[1],x2:px(vx*RN,vy*RN)[0],y2:px(vx*RN,vy*RN)[1]},eigG);
      }
    }
    h1=arrow(v1,a,c,'#4F46E5','i′');h2=arrow(v2,b,d,'#B8431F','j′');
    bindDrag(h1,'a','c');bindDrag(h2,'b','d');
    // 读数
    const rank=(Math.abs(det)>1e-9)?2:((a||b||c||d)?1:0);
    const eigTxt=disc>=0?`λ₁=${fmt((tr+Math.sqrt(Math.max(disc,0)))/2)}  λ₂=${fmt((tr-Math.sqrt(Math.max(disc,0)))/2)}`:'一对共轭复特征值（旋转成分）';
    const say=Math.abs(det)<1e-9?('压扁成'+(rank?'一条线':'一个点')+'，丢维度'):
      Math.abs(det)<1?'面积收缩（|det|<1）':det<0?'翻转了定向（det<0）':'面积放大（|det|>1）';
    $('[data-r=det]',wrap).textContent=fmt(det);$('[data-r=tr]',wrap).textContent=fmt(tr);
    $('[data-r=rk]',wrap).textContent=rank;$('[data-r=area]',wrap).textContent=fmt(Math.abs(det))+'×';
    $('[data-r=eig]',wrap).textContent=eigTxt;$('[data-r=say]',wrap).textContent=say;
    $$('.matgrid input',wrap).forEach(i=>{if(document.activeElement!==i)i.value=fmt(M[i.dataset.k],1)});
  }
  let h1,h2;
  function svgPoint(e){
    const r=svg.getBoundingClientRect();
    const vx=(e.clientX-r.left)*(W/r.width),vy=(e.clientY-r.top)*(H/r.height);
    return[(vx-CX)/S,(CY-vy)/S];
  }
  function bindDrag(handle,kx,ky){
    handle.onpointerdown=e=>{
      e.preventDefault();handle.setPointerCapture(e.pointerId);
      const move=ev=>{const[x,y]=svgPoint(ev);M[kx]=clamp(Math.round(x*10)/10,-4.5,4.5);M[ky]=clamp(Math.round(y*10)/10,-4.5,4.5);draw()};
      handle.onpointermove=move;
      handle.onpointerup=()=>{handle.onpointermove=null};
    };
  }
  $$('.matgrid input',wrap).forEach(i=>i.oninput=()=>{const v=parseFloat(i.value);if(!isNaN(v)){M[i.dataset.k]=clamp(v,-9,9);draw()}});
  const PRE={I:{a:1,b:0,c:0,d:1},rot:{a:0,b:-1,c:1,d:0},shear:{a:1,b:1,c:0,d:1},stretch:{a:2,b:0,c:0,d:1},proj:{a:1,b:0,c:0,d:0},sing:{a:1,b:1,c:1,d:1}};
  $$('.presets button',wrap).forEach(b=>b.onclick=()=>{Object.assign(M,PRE[b.dataset.p]);draw()});
  // AI 之手：幽灵光标拖列1到目标再返回
  const aiBtn=$('[data-ai]',wrap);
  if(aiBtn)aiBtn.onclick=()=>{
    const hand=$('.aihand',wrap);hand.classList.add('on');
    const from={a:M.a,c:M.c},to={a:1.8,c:0.9};let t0=null;
    const animate=ts=>{
      if(!t0)t0=ts;const p=(ts-t0)/2600;
      if(p<0.5){const q=p/0.5,e=q<.5?2*q*q:-1+(4-2*q)*q;M.a=from.a+(to.a-from.a)*e;M.c=from.c+(to.c-from.c)*e}
      else{const q=(p-0.5)/0.5,e=q<.5?2*q*q:-1+(4-2*q)*q;M.a=to.a-(to.a-from.a)*e;M.c=to.c-(to.c-from.c)*e}
      draw();
      const[x,y]=px(M.a,M.c);const r=wrap.getBoundingClientRect(),sr=svg.getBoundingClientRect();
      hand.style.left=(sr.left-r.left+x/640*sr.width-15)+'px';hand.style.top=(sr.top-r.top+y/380*sr.height-15)+'px';
      if(p<1)requestAnimationFrame(animate);else{M.a=from.a;M.c=from.c;draw();hand.classList.remove('on')}
    };
    toast('AI 正在把第一列拖向 (1.8, 0.9)，看它怎么做');requestAnimationFrame(animate);
  };
  draw();
  return{set(m){Object.assign(M,m);draw()}};
}

/* ================================================================
   对象工厂 2：函数曲线 y = a·x² + b（最简活对象）
   ================================================================ */
function FormulaCurve(mount,opt={}){
  const P=Object.assign({a:1,b:0},opt.params);
  const W=560,H=300,CX=280,CY=190,S=52;
  const wrap=document.createElement('div');wrap.className='objwrap';
  wrap.innerHTML=`<svg class="objsvg" viewBox="0 0 ${W} ${H}"></svg>
    <div class="opanel"><div class="grp"><div class="gt">参数</div>
      <div class="mrow"><label>a</label><input type="range" min="-2" max="2" step="0.1" value="${P.a}"><span class="val" data-v="a"></span></div>
      <div class="mrow"><label>b</label><input type="range" min="-3" max="3" step="0.1" value="${P.b}"><span class="val" data-v="b"></span></div>
      </div><div class="grp"><div class="gt">读数</div>
      <div class="readouts"><div class="ro"><span>y(2)</span><b data-r="y2"></b></div>
      <div class="ro"><span>零点</span><b data-r="zero" style="font-size:11px"></b></div></div></div>
    </div>`;
  mount.appendChild(wrap);
  const svg=$('svg',wrap),px=(x,y)=>[CX+x*S,CY-y*S];
  for(let k=-4;k<=4;k++){
    el('line',{x1:px(k,-4)[0],y1:px(k,-4)[1],x2:px(k,4)[0],y2:px(k,4)[1],stroke:'#EDE7DA'},svg);
    el('line',{x1:px(-5,k)[0],y1:px(-5,k)[1],x2:px(5,k)[0],y2:px(5,k)[1],stroke:'#EDE7DA'},svg);
  }
  el('line',{x1:0,y1:CY,x2:W,y2:CY,stroke:'#D5CCB9','stroke-width':1.2},svg);
  el('line',{x1:CX,y1:0,x2:CX,y2:H,stroke:'#D5CCB9','stroke-width':1.2},svg);
  const curve=el('path',{fill:'none',stroke:'#4F46E5','stroke-width':2.2,'stroke-linecap':'round'},svg);
  const f=x=>P.a*x*x+P.b;
  function draw(){
    let d='';for(let x=-4.5;x<=4.5;x+=0.05){const y=clamp(f(x),-3.5,3.5);const p=px(x,y);d+=(d?'L':'M')+fmt(p[0],1)+','+fmt(p[1],1)}
    curve.setAttribute('d',d);
    $('[data-v=a]',wrap).textContent=fmt(P.a,1);$('[data-v=b]',wrap).textContent=fmt(P.b,1);
    $('[data-r=y2]',wrap).textContent=fmt(f(2));
    const disc=P.a?(-P.b/P.a):0;
    $('[data-r=zero]',wrap).textContent=P.a===0?(P.b===0?'恒 0':'无'):(disc>=0?`x=±${fmt(Math.sqrt(disc))}`:'无实零点');
  }
  $$('input[type=range]',wrap).forEach((r,i)=>r.oninput=()=>{P[i?'b':'a']=+r.value;draw()});
  draw();
}

/* ================================================================
   对象工厂 3：梯度下降（学习率滑杆 + 播放）
   ================================================================ */
function GradientDescent(mount,opt={}){
  const P=Object.assign({lr:0.3,x0:2.4},opt.params);
  const W=560,H=300,CX=280,CY=255,S=72,SY=52;
  const wrap=document.createElement('div');wrap.className='objwrap';
  wrap.innerHTML=`<svg class="objsvg" viewBox="0 0 ${W} ${H}"></svg>
    <div class="opanel"><div class="grp"><div class="gt">参数</div>
      <div class="mrow"><label>学习率 η</label><input type="range" min="0.05" max="1.1" step="0.01" value="${P.lr}"><span class="val" data-v="lr"></span></div>
      <div class="mrow"><label>起点 x₀</label><input type="range" min="-2.8" max="2.8" step="0.1" value="${P.x0}"><span class="val" data-v="x0"></span></div>
      </div>
      <div class="grp"><div class="gt">执行</div>
      <div style="display:flex;gap:6px"><button class="btn sm primary" data-play style="flex:1">▶ 逐步下降</button><button class="btn sm" data-reset>重置</button></div>
      <div class="readouts" style="margin-top:8px"><div class="ro"><span>迭代 n</span><b data-r="n">0</b></div>
      <div class="ro"><span>xₙ</span><b data-r="x"></b></div>
      <div class="ro"><span>f(xₙ)</span><b data-r="f"></b></div>
      <div class="ro"><span>状态</span><b data-r="st" style="font-size:11px"></b></div></div></div>
    </div>`;
  mount.appendChild(wrap);
  const svg=$('svg',wrap),f=x=>x*x,df=x=>2*x;
  const px=(x,y)=>[CX+x*S,CY-y*SY];
  for(let k=-4;k<=4;k++){
    el('line',{x1:px(k,0)[0],y1:0,x2:px(k,0)[0],y2:H,stroke:'#EDE7DA'},svg);
    el('line',{x1:0,y1:px(0,k)[1],x2:W,y2:px(0,k)[1],stroke:'#EDE7DA'},svg);
  }
  el('line',{x1:0,y1:CY,x2:W,y2:CY,stroke:'#D5CCB9','stroke-width':1.2},svg);
  let cd='';for(let x=-3.6;x<=3.6;x+=0.05){const p=px(x,f(x));cd+=(cd?'L':'M')+fmt(p[0],1)+','+fmt(p[1],1)}
  el('path',{d:cd,fill:'none',stroke:'#2F3A49','stroke-width':2},svg);
  const trace=el('polyline',{fill:'none',stroke:'#FF7A59','stroke-width':1.8,'stroke-dasharray':'3 3'},svg);
  const dot=el('circle',{r:6.5,fill:'#FF7A59',stroke:'#fff','stroke-width':2},svg);
  const lab=el('text',{'font-size':10.5,fill:'#B8431F','font-family':'var(--mono)'},svg);
  let x=P.x0,n=0,timer=null;
  function place(){const p=px(x,f(x));dot.setAttribute('cx',p[0]);dot.setAttribute('cy',p[1]);
    lab.setAttribute('x',p[0]+9);lab.setAttribute('y',p[1]-9);lab.textContent='x'+n;
    $('[data-r=n]',wrap).textContent=n;$('[data-r=x]',wrap).textContent=fmt(x,3);
    $('[data-r=f]',wrap).textContent=fmt(f(x),4);
    const st=Math.abs(x)>4?'发散（η 过大）':Math.abs(x)<0.02?'已收敛':'下降中';
    $('[data-r=st]',wrap).textContent=st;
    let pts=trace.getAttribute('points')||'';trace.setAttribute('points',pts+(pts?' ':'')+fmt(p[0],1)+','+fmt(p[1],1));
    if(Math.abs(x)>4||n>40)stop();
  }
  function step(){x=x-P.lr*df(x);n++;place()}
  function stop(){clearInterval(timer);timer=null;$('[data-play]',wrap).textContent='▶ 逐步下降'}
  $('[data-play]',wrap).onclick=()=>{if(timer){stop();return}trace.setAttribute('points','');
    $('[data-play]',wrap).textContent='⏸ 暂停';timer=setInterval(step,380)};
  $('[data-reset]',wrap).onclick=()=>{stop();x=P.x0;n=0;trace.setAttribute('points','');place()};
  $$('input[type=range]',wrap).forEach(r=>r.oninput=()=>{P[r.previousElementSibling.textContent.includes('η')?'lr':'x0']=+r.value;
    $('[data-v=lr]',wrap).textContent=fmt(P.lr);$('[data-v=x0]',wrap).textContent=fmt(P.x0,1);
    stop();x=P.x0;n=0;trace.setAttribute('points','');place()});
  $('[data-v=lr]',wrap).textContent=fmt(P.lr);$('[data-v=x0]',wrap).textContent=fmt(P.x0,1);
  trace.setAttribute('points','');place();
}

/* ================================================================
   对象工厂 4：交换律对比（R∘S vs S∘R —— 矩阵乘法不可交换）
   ================================================================ */
function OrderCompare(mount,opt={}){
  const P=Object.assign({th:45,k:1.8},opt.params);
  const wrap=document.createElement('div');wrap.className='objwrap';
  wrap.innerHTML=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div><svg class="objsvg" viewBox="0 0 300 220" data-cv="0"></svg><div style="text-align:center;font-size:11.5px;color:var(--ink-500);margin-top:4px">先旋转 <b>R</b> → 再拉伸 <b>S</b></div></div>
      <div><svg class="objsvg" viewBox="0 0 300 220" data-cv="1"></svg><div style="text-align:center;font-size:11.5px;color:var(--ink-500);margin-top:4px">先拉伸 <b>S</b> → 再旋转 <b>R</b></div></div>
    </div>
    <div class="opanel"><div class="grp"><div class="gt">参数</div>
      <div class="mrow"><label>旋转 θ</label><input type="range" min="0" max="180" step="1" value="${P.th}"><span class="val" data-v="th"></span></div>
      <div class="mrow"><label>拉伸 k</label><input type="range" min="0.5" max="3" step="0.1" value="${P.k}"><span class="val" data-v="k"></span></div>
      </div><div class="grp"><div class="gt">结论</div>
      <div style="font-size:12.5px;line-height:1.6;color:var(--ink-500)" data-r="verdict"></div>
      <div class="readouts" style="margin-top:6px"><div class="ro"><span>(1,0) 去向 A</span><b data-r="pA"></b></div>
      <div class="ro"><span>(1,0) 去向 B</span><b data-r="pB"></b></div></div></div>
    </div>`;
  mount.appendChild(wrap);
  const CW=300,CH=220,CCX=150,CCY=120,CS=52;
  function drawSide(svg,M){
    svg.innerHTML='';const px=(x,y)=>[CCX+x*CS,CCY-y*CS];
    for(let k=-2;k<=3;k++){
      el('line',{x1:px(k,-2)[0],y1:px(k,-2)[1],x2:px(k,2)[0],y2:px(k,2)[1],stroke:'#EDE7DA'},svg);
      el('line',{x1:px(-2,k)[0],y1:px(-2,k)[1],x2:px(3,k)[0],y2:px(3,k)[1],stroke:'#EDE7DA'},svg);
    }
    el('line',{x1:0,y1:CCY,x2:CW,y2:CCY,stroke:'#D5CCB9'},svg);
    el('line',{x1:CCX,y1:0,x2:CCX,y2:CH,stroke:'#D5CCB9'},svg);
    const sq=[[0,0],[1,0],[1,1],[0,1]];
    const ghost=sq.map(p=>px(p[0],p[1]).join(',')).join(' ');
    el('polygon',{points:ghost,fill:'none',stroke:'#C7BFAE','stroke-dasharray':'4 3'},svg);
    const ts=sq.map(p=>px(M[0][0]*p[0]+M[0][1]*p[1],M[1][0]*p[0]+M[1][1]*p[1]).join(',')).join(' ');
    el('polygon',{points:ts,fill:'rgba(79,70,229,.14)',stroke:'#4F46E5','stroke-width':2},svg);
    const e=px(M[0][0],M[1][0]);
    el('circle',{cx:e[0],cy:e[1],r:4.5,fill:'#FF7A59',stroke:'#fff','stroke-width':1.5},svg);
  }
  function draw(){
    const t=P.th*Math.PI/180,cs=Math.cos(t),sn=Math.sin(t);
    const R=[[cs,-sn],[sn,cs]],S=[[P.k,0],[0,1]];
    const mul=(X,Y)=>[[X[0][0]*Y[0][0]+X[0][1]*Y[1][0],X[0][0]*Y[0][1]+X[0][1]*Y[1][1]],
                     [X[1][0]*Y[0][0]+X[1][1]*Y[1][0],X[1][0]*Y[0][1]+X[1][1]*Y[1][1]]];
    const M1=mul(S,R),M2=mul(R,S);
    drawSide($('[data-cv="0"]',wrap),M1);drawSide($('[data-cv="1"]',wrap),M2);
    $('[data-v=th]',wrap).textContent=P.th+'°';$('[data-v=k]',wrap).textContent=fmt(P.k,1)+'×';
    $('[data-r=pA]',wrap).textContent=`(${fmt(M1[0][0])},${fmt(M1[1][0])})`;
    $('[data-r=pB]',wrap).textContent=`(${fmt(M2[0][0])},${fmt(M2[1][0])})`;
    const diff=Math.abs(M1[0][0]-M2[0][0])+Math.abs(M1[0][1]-M2[0][1])+Math.abs(M1[1][0]-M2[1][0])+Math.abs(M1[1][1]-M2[1][1]);
    $('[data-r=verdict]',wrap).innerHTML=diff<0.01?
      '此时 <b>R∘S = S∘R</b>：该组参数下两种顺序恰好同结果（θ=0 或 k=1）。':
      `<b style="color:var(--coral-ink)">R∘S ≠ S∘R</b>：同一个动作，顺序不同结果不同——矩阵乘法不可交换，亲眼可见。`;
  }
  $$('input[type=range]',wrap).forEach((r,i)=>r.oninput=()=>{P[i?'k':'th']=+r.value;draw()});
  draw();
}

/* ---------- 模板注册表 ---------- */
const TPL={
  matrix:{name:'矩阵变换实验',src:'manual',fact:MatrixPlay,desc:'拖列向量 / 改矩阵，det·特征值实时跳动'},
  curve:{name:'函数曲线',src:'manual',fact:FormulaCurve,desc:'y=a·x²+b，滑杆调参'},
  gd:{name:'梯度下降',src:'manual',fact:GradientDescent,desc:'学习率滑杆，逐步执行可发散'},
  order:{name:'顺序对比实验',src:'manual',fact:OrderCompare,desc:'R∘S vs S∘R，矩阵乘法不可交换'},
};
const TPL_SOON=[
  {name:'特征探针',desc:'沿方向探特征向量'},{name:'SVD 圆→椭圆',desc:'三步分解动画'},
  {name:'BFS 逐步执行',desc:'真实队列与层级'},{name:'堆删除堆顶',desc:'下滤动画'},
  {name:'积分曲面积分',desc:'截面可移动'},{name:'经营沙盘',desc:'需求-利润-敏感性'},
  {name:'特征基换基',desc:'同一动作两个矩阵'},{name:'秩与维度',desc:'像空间可视化'},
];

/* ================================================================
   文档模型 + 渲染（编辑 / 读者两副面孔）
   ================================================================ */
const docModel=[
  {type:'h2',text:'为什么要看特征值'},
  {type:'p',html:'矩阵 A 是<b>一个动作</b>。大多数方向经过它都会偏转，但有几个方向只被<b>拉长或缩短</b>——这些方向叫特征向量，倍率就是特征值。下面这个对象里可以直接拖矩阵的两列，看网格、单位圆和 det 怎么变。'},
  {type:'obj',tpl:'matrix',src:'manual',caption:'图 1 · 拖列向量端点，或在右侧改矩阵元素；虚线方向是特征方向',params:{a:1.6,b:0.4,c:0.2,d:1.2}},
  {type:'p',html:'注意 <b>det</b> 的读数：它是面积倍率。把 det 压到 0（比如两列共线），空间被压成一条线——这就是"奇异"的几何含义。'},
  {type:'h2',text:'顺手复习：迭代法收敛'},
  {type:'p',html:'解 A<b>x</b>=<b>b</b> 的迭代法本质是梯度下降。学习率太大不但不慢，反而<b>发散</b>——把 η 拖到 1.0 以上试试。'},
  {type:'obj',tpl:'gd',src:'manual',caption:'图 2 · 学习率 η 超过 1 时迭代震荡发散',params:{lr:0.3,x0:2.4}},
  {type:'blk-note',text:'待办：把第 22 页"同一个动作两个矩阵"也做成对象插在这里 → 走"拍"入口导入课件页'},
];
let freshIdx=-1;
function renderDoc(){
  const body=$('#docBody');body.innerHTML=`<h1>特征值与特征向量 · 考研线代笔记</h1>
    <div class="docmeta"><span>曹文印</span><span>3 个活对象</span><span>更新于刚刚</span></div>`;
  docModel.forEach((b,i)=>{
    if(b.type==='p'){const d=document.createElement('div');d.className='blk p';d.innerHTML=b.html;body.appendChild(d)}
    else if(b.type==='h2'){const d=document.createElement('div');d.className='blk h2';d.textContent=b.text;body.appendChild(d)}
    else if(b.type==='blk-note'){const d=document.createElement('div');d.className='blk-note';d.textContent='📌 '+b.text;body.appendChild(d)}
    else if(b.type==='obj'){body.appendChild(objBlock(b,i))}
  });
  if(freshIdx>=0){const el=body.querySelectorAll('.objblock.fresh');el.forEach(e=>e.scrollIntoView({behavior:'smooth',block:'center'}));freshIdx=-1}
}
const SRC_NAME={manual:'模板组装',ai:'AI 生成',snap:'拍照识别',lab:'题目实验室'};
function objBlock(b,i){
  const t=TPL[b.tpl];
  const w=document.createElement('div');w.className='objblock'+(i===freshIdx?' fresh':'');
  w.innerHTML=`<div class="ohead"><span style="font-size:13px">⚙️</span><span class="tpl">${t.name}</span>
    <span class="src ${b.src}">${SRC_NAME[b.src]||'模板'}</span><div class="sp"></div>
    <button class="iconbtn" title="进入组装台">调参</button>
    <button class="iconbtn" title="单独发布此对象" onclick="event.stopPropagation();toast('已生成对象链接 wanxiang.local/o/'+Math.random().toString(36).slice(2,7))">发链接</button>
    <button class="iconbtn" title="删除" onclick="this.closest('.objblock').remove();toast('对象已移除（概念站不持久化）')">×</button></div>
    <div class="obody"></div>
    <div class="ofoot">💬<input class="cap" value="${b.caption}" spellcheck="false"></div>`;
  t.fact($('.obody',w),{params:b.params,aiHand:b.tpl==='matrix'});
  return w;
}

/* ---------- 读者视图 ---------- */
function renderShare(){
  const body=$('#shareBody');body.innerHTML='';
  const h=document.createElement('div');h.innerHTML=`<h1>特征值与特征向量 · 考研线代笔记</h1>
    <div class="docmeta"><span>曹文印 分享</span><span>只读 · 对象可玩</span><span>wanxiang.local/d/tezhengzhi</span></div>`;
  body.appendChild(h);
  let predictDone=false;
  docModel.forEach((b,i)=>{
    if(b.type==='p'){const d=document.createElement('div');d.className='blk p';d.innerHTML=b.html;body.appendChild(d)}
    else if(b.type==='h2'){const d=document.createElement('div');d.className='blk h2';d.textContent=b.text;body.appendChild(d)}
    else if(b.type==='blk-note')return;
    else if(b.type==='obj'){
      const w=document.createElement('div');w.className='objblock';
      w.innerHTML=`<div class="ohead"><span style="font-size:13px">⚙️</span><span class="tpl">${TPL[b.tpl].name}</span>
        <span class="src ${b.src}">${SRC_NAME[b.src]}</span><div class="sp"></div>
        <button class="iconbtn" onclick="event.stopPropagation();toast('已拿进你的对象库（概念站演示）')">拿进我的文档</button></div>
        <div class="obody"></div>
        <div class="ofoot">💬<span class="cap" style="flex:1">${b.caption}</span></div>`;
      TPL[b.tpl].fact($('.obody',w),{params:b.params,aiHand:false});
      body.appendChild(w);
      // 在第一个对象后插预测闸门
      if(!predictDone&&b.tpl==='matrix'){body.appendChild(predictCard());predictDone=true}
    }
  });
  const f=document.createElement('div');f.className='sharefoot';
  f.innerHTML='<span>由 <b>万象活文档</b> 生成 · 对象保持作者的参数状态</span><span>举报 / 反馈</span>';
  body.appendChild(f);
}
function predictCard(){
  const w=document.createElement('div');w.className='predict';
  w.innerHTML=`<h6>🎯 先猜再看 · 检验你是不是真懂了</h6>
    <div class="q">如果把矩阵改成 <span class="num">A = [[1.5, 0.3],[0.5, 1.2]]</span>，你猜 <b>det A</b> 是多少？先写下你的猜测，再看真相。</div>
    <div class="grow">
      <input placeholder="你的猜测" id="pguess" type="number" step="0.01">
      <button class="btn sm primary" onclick="revealPredict()">揭示真相</button>
      <span style="font-size:11.5px;color:var(--ink-400)">提示：det = ad − bc</span>
    </div>
    <div class="verdict" id="pverdict"></div>`;
  return w;
}
function revealPredict(){
  const truth=1.5*1.2-0.3*0.5; // 1.65
  const g=parseFloat($('#pguess').value),v=$('#pverdict');
  if(isNaN(g)){v.className='verdict show';v.innerHTML='先写个猜测数字嘛。';return}
  const dev=Math.abs(g-truth)/Math.abs(truth);
  let say=dev<0.1?'✅ <b>偏差 '+fmt(dev*100,0)+'%</b> —— 理解在线，det 的几何感是对的。':
    dev<0.4?'🟡 <b>偏差 '+fmt(dev*100,0)+'%</b> —— 大概知道方向，回去拖一拖两列共线的情况巩固一下。':
    '🔴 <b>偏差 '+fmt(dev*100,0)+'%</b> —— 概念还没立住，建议回到图 1 把 det 拖到 0 感受一下"压扁"。';
  v.className='verdict show';
  v.innerHTML=`真实值 <span class="live">det = ${fmt(truth)}</span>，你的猜测 ${fmt(g)}。${say}<br><span style="color:var(--ink-400);font-size:11.5px">这次检验已记入你的"理解档案"（概念站示意）。</span>`;
}

/* ================================================================
   插入流程：说 / 拍 / 模板
   ================================================================ */
function setItab(k){
  $$('.itabs button').forEach(b=>b.classList.toggle('on',b.dataset.itab===k));
  $$('.ipane').forEach(p=>p.style.display=p.dataset.ipane===k?'':'none');
}
function sayFill(btn){$('#sayInput').value='我想看看'+btn.textContent;$('#sayInput').focus()}
function generateFromSay(){
  const q=$('#sayInput').value.trim()||'我想看看矩阵乘法为什么不满足交换律';
  const bar=$('#genbar'),fill=bar.firstElementChild;bar.style.display='block';fill.style.width='15%';
  toast('AI 正在选模板、定参数…',1600);
  setTimeout(()=>fill.style.width='62%',400);
  setTimeout(()=>{
    fill.style.width='100%';
    setTimeout(()=>{
      bar.style.display='none';fill.style.width='0';
      let blk;
      if(/顺序|交换|先后/.test(q))blk={type:'obj',tpl:'order',src:'ai',caption:'AI 生成 · 拖 θ 和 k，看两种顺序的结果差异',params:{th:50,k:2}};
      else if(/梯度|学习率|收敛|迭代/.test(q))blk={type:'obj',tpl:'gd',src:'ai',caption:'AI 生成 · 学习率过大试试',params:{lr:0.55,x0:2.6}};
      else if(/特征|矩阵|向量|行列式/.test(q))blk={type:'obj',tpl:'matrix',src:'ai',caption:'AI 生成 · 教学示例参数，可继续调',params:{a:1.4,b:0.6,c:0.3,d:1.1}};
      else blk={type:'obj',tpl:'curve',src:'ai',caption:'AI 生成 · 未命中专门模板，先给通用函数曲线',params:{a:0.8,b:-0.5}};
      docModel.push(blk);freshIdx=docModel.length-1;renderDoc();
      toast('已生成并插进文档底部（参数为教学示例，可改）');
    },350);
  },900);
}
function openSnap(){
  $('#snapModal').classList.add('on');
  $('#scanline').style.display='block';$('#recogBox').style.display='none';$('#snapInsertBtn').style.display='none';
  setTimeout(()=>{$('#scanline').style.display='none';$('#recogBox').style.display='block';$('#snapInsertBtn').style.display=''},1400);
}
function insertSnapped(){
  closeModal('snapModal');
  docModel.push({type:'obj',tpl:'matrix',src:'lab',caption:'拍题 · A=[[2,1],[1,2]]，λ=3 与 1，已核对原题',params:{a:2,b:1,c:1,d:2}});
  freshIdx=docModel.length-1;renderDoc();
  toast('题目已编译成对象插进文档（走题目实验室管线）');
}
/* 模板面板 & 库页 */
const TPL_ICONS={
  matrix:'<svg width="90" height="52" viewBox="0 0 90 52"><g stroke="#4F46E5" stroke-width="1"><line x1="10" y1="26" x2="80" y2="26"/><line x1="45" y1="4" x2="45" y2="48"/></g><path d="M45 26 L68 12 M45 26 L74 40" stroke="#FF7A59" stroke-width="2" fill="none"/><circle cx="68" cy="12" r="3" fill="#4F46E5"/><circle cx="74" cy="40" r="3" fill="#B8431F"/></svg>',
  curve:'<svg width="90" height="52" viewBox="0 0 90 52"><line x1="10" y1="44" x2="82" y2="44" stroke="#D5CCB9"/><path d="M14 44 Q45 -14 76 44" stroke="#4F46E5" stroke-width="2.4" fill="none"/></svg>',
  gd:'<svg width="90" height="52" viewBox="0 0 90 52"><path d="M8 12 Q45 60 82 12" stroke="#2F3A49" stroke-width="2" fill="none"/><circle cx="20" cy="20" r="4" fill="#FF7A59"/><circle cx="34" cy="36" r="4" fill="#FF7A59"/><circle cx="44" cy="41" r="4" fill="#FF7A59"/></svg>',
  order:'<svg width="90" height="52" viewBox="0 0 90 52"><rect x="8" y="14" width="22" height="22" fill="none" stroke="#C7BFAE" stroke-dasharray="3 2"/><path d="M10 14 L38 18 L34 40 L10 36 Z" fill="rgba(79,70,229,.15)" stroke="#4F46E5"/><path d="M56 14 L84 10 L80 38 L56 36 Z" fill="rgba(255,122,89,.15)" stroke="#FF7A59"/></svg>',
};
function tplCard(key){
  const t=TPL[key];
  const d=document.createElement('button');d.className='tplcard';
  d.innerHTML=`<div class="thumb">${TPL_ICONS[key]}</div><b>${t.name}</b><span>${t.desc}</span>`;
  d.onclick=()=>{docModel.push({type:'obj',tpl:key,src:'manual',caption:'模板插入 · '+t.desc,params:undefined});
    freshIdx=docModel.length-1;renderDoc();toast('已插入「'+t.name+'」')};
  return d;
}
Object.keys(TPL).forEach(k=>$('#tplGrid').appendChild(tplCard(k)));
/* 库页 */
(function(){
  const g=$('#libGrid');
  for(const k of Object.keys(TPL)){
    const t=TPL[k],d=document.createElement('div');d.className='libcard';
    d.innerHTML=`<div class="thumb">${TPL_ICONS[k]}</div><b>${t.name} <span style="font-size:10px;color:var(--pass);background:var(--pass-soft);padding:1px 7px;border-radius:99px;margin-left:4px">可插</span></b>
      <p>${t.desc}</p><div class="foot"><span class="used">模板 · 数学</span><button class="btn sm primary">插入文档</button></div>`;
    $('button',d).onclick=()=>{location.hash='#/doc';setTimeout(()=>{docModel.push({type:'obj',tpl:k,src:'manual',caption:'从对象库插入',params:undefined});freshIdx=docModel.length-1;renderDoc()},60)};
    g.appendChild(d);
  }
  for(const s of TPL_SOON){
    const d=document.createElement('div');d.className='libcard';d.style.opacity=.72;
    d.innerHTML=`<div class="thumb"><span style="font-size:22px">◇</span></div><b>${s.name}</b>
      <p>${s.desc} · <span style="color:var(--ink-300)">来自现有 16 场景/算法池</span></p>
      <div class="foot"><span class="used">待接入</span><button class="btn sm">插入</button></div>`;
    $('button',d).onclick=()=>toast('概念站只实装了前 4 种，其余为占位');
    g.appendChild(d);
  }
})();

/* ---------- 发布 / fork ---------- */
function openPublish(){
  $('#pubModal').classList.add('on');
  const q=$('#qr');if(!q.children.length){
    let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
    for(let i=0;i<21*21;i++){const cell=document.createElement('i');
      const r=i%21,c=(i/21)|0,inEye=(r<7&&c<7)||(r<7&&c>13)||(r>13&&c<7);
      if(inEye?((r%6&&c%6&&r<6&&c<6)||r===0||c===0||r===6||c===6)&&((r>1&&r<5&&c>1&&c<5)||r===0||r===6||c===0||c===6):rnd()>.52)cell.className='d';
      q.appendChild(cell)}
  }
}
function forkDoc(){
  const b=$('#forkBtn');b.textContent='✓ 已在我的空间';b.disabled=true;
  toast('整篇文档（含 3 个活对象和当前参数）已复制到你的空间');
}
$$('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)m.classList.remove('on')}));

/* ================================================================
   画布页：对象互联 —— 源对象发数据，视图对象收数据，线即数据流
   ================================================================ */
const cv={nodes:[],wires:[],seq:0,inner:null,wsvg:null,zoom:1};
function portC(el){const r=el.getBoundingClientRect(),ir=cv.inner.getBoundingClientRect();
  return[(r.left+r.width/2-ir.left)/cv.zoom,(r.top+r.height/2-ir.top)/cv.zoom]}
function setZoom(z){cv.zoom=clamp(z,0.4,1.6);cv.inner.style.transform=`scale(${cv.zoom})`;
  $('#czoom').textContent=Math.round(cv.zoom*100)+'%';redrawWires()}
function wirePath(p1,p2){const dx=Math.max(50,Math.abs(p2[0]-p1[0])/2);
  return`M${p1[0]},${p1[1]} C${p1[0]+dx},${p1[1]} ${p2[0]-dx},${p2[1]} ${p2[0]},${p2[1]}`}

/* ---- 源：矩阵 ---- */
function MatrixSourceNode(body){
  const M={a:1.6,b:0.4,c:0.2,d:1.2};let cb=null;
  body.innerHTML=`<div class="matgrid" style="max-width:160px">
      <input data-k="a" value="1.6"><input data-k="b" value="0.4">
      <input data-k="c" value="0.2"><input data-k="d" value="1.2"></div>
    <div class="presets" style="margin:8px 0">
      <button data-p="I">单位</button><button data-p="rot">旋转90°</button>
      <button data-p="shear">剪切</button><button data-p="stretch">拉伸×2</button>
      <button data-p="sing">奇异</button></div>
    <div style="font-size:11.5px;color:var(--ink-400)">det <b class="live" data-r="det"></b> · tr <b class="live" data-r="tr"></b></div>`;
  const upd=()=>{$('[data-r=det]',body).textContent=fmt(M.a*M.d-M.b*M.c);
    $('[data-r=tr]',body).textContent=fmt(M.a+M.d);cb&&cb({...M})};
  $$('input',body).forEach(i=>i.oninput=()=>{const v=parseFloat(i.value);
    if(!isNaN(v)){M[i.dataset.k]=clamp(v,-9,9);upd()}});
  const PRE={I:[1,0,0,1],rot:[0,-1,1,0],shear:[1,1,0,1],stretch:[2,0,0,1],sing:[1,1,1,1]};
  $$('.presets button',body).forEach(b=>b.onclick=()=>{const p=PRE[b.dataset.p];
    [M.a,M.b,M.c,M.d]=p;$$('input',body).forEach(i=>i.value=fmt(M[i.dataset.k],1));upd()});
  upd();
  return{getValue:()=>({...M}),onChange:f=>cb=f};
}
/* ---- 视图：变换画布（只读） ---- */
function drawTransformSvg(svg,M){
  const W=560,H=330,CX=280,CY=170,S=40,RN=5;
  const px=(x,y)=>[CX+x*S,CY-y*S];
  svg.innerHTML='';
  for(let k=-RN;k<=RN;k++){
    el('line',{x1:px(k,-RN)[0],y1:px(k,-RN)[1],x2:px(k,RN)[0],y2:px(k,RN)[1],stroke:'#EDE7DA'},svg);
    el('line',{x1:px(-RN,k)[0],y1:px(-RN,k)[1],x2:px(RN,k)[0],y2:px(RN,k)[1],stroke:'#EDE7DA'},svg);
  }
  el('line',{x1:0,y1:CY,x2:W,y2:CY,stroke:'#D5CCB9'},svg);
  el('line',{x1:CX,y1:0,x2:CX,y2:H,stroke:'#D5CCB9'},svg);
  const{a,b,c,d}=M;
  const lat=el('g',{stroke:'#C9C4F5'},svg);
  for(let k=-RN;k<=RN;k++){
    el('line',{x1:px(a*k-b*RN,c*k-d*RN)[0],y1:px(a*k-b*RN,c*k-d*RN)[1],x2:px(a*k+b*RN,c*k+d*RN)[0],y2:px(a*k+b*RN,c*k+d*RN)[1]},lat);
    el('line',{x1:px(-a*RN+b*k,-c*RN+d*k)[0],y1:px(-a*RN+b*k,-c*RN+d*k)[1],x2:px(a*RN+b*k,c*RN+d*k)[0],y2:px(a*RN+b*k,c*RN+d*k)[1]},lat);
  }
  el('circle',{cx:CX,cy:CY,r:S,fill:'none',stroke:'#C7BFAE','stroke-dasharray':'4 4'},svg);
  let dp='';for(let i=0;i<=64;i++){const t=i/64*2*Math.PI,
    p=px(a*Math.cos(t)+b*Math.sin(t),c*Math.cos(t)+d*Math.sin(t));dp+=(i?'L':'M')+fmt(p[0],1)+','+fmt(p[1],1)}
  el('path',{d:dp+'Z',fill:'rgba(79,70,229,.06)',stroke:'#4F46E5','stroke-width':1.6},svg);
  const arr=(x,y,col,lab)=>{const[ex,ey]=px(x,y);const g=el('g',{},svg);
    el('line',{x1:CX,y1:CY,x2:ex,y2:ey,stroke:col,'stroke-width':2.2,'stroke-linecap':'round'},g);
    const an=Math.atan2(ey-CY,ex-CX),h=9;
    el('path',{d:`M${ex},${ey}L${ex-h*Math.cos(an-.4)},${ey-h*Math.sin(an-.4)}L${ex-h*Math.cos(an+.4)},${ey-h*Math.sin(an+.4)}Z`,fill:col},g);
    const t=el('text',{x:ex+6,y:ey-8,fill:col,'font-size':11,'font-weight':700},g);t.textContent=lab};
  arr(a,c,'#4F46E5','i′');arr(b,d,'#B8431F','j′');
}
function TransformViewNode(body){
  body.innerHTML='<svg class="objsvg" viewBox="0 0 560 330" style="min-height:225px"></svg>';
  const svg=body.firstElementChild;
  return{setValue(M){drawTransformSvg(svg,M)}};
}
/* ---- 视图：det 仪表 ---- */
function DetGaugeNode(body){
  body.innerHTML='<svg class="objsvg" viewBox="0 0 200 130" style="min-height:120px"></svg>';
  const svg=body.firstElementChild;
  return{setValue(M){
    const det=M.a*M.d-M.b*M.c,ad=Math.abs(det);
    svg.innerHTML='';
    const cx=100,cy=112,r=78;
    el('path',{d:`M${cx-r},${cy} A${r},${r} 0 0 1 ${cx+r},${cy}`,fill:'none',stroke:'#EDE7DA','stroke-width':11,'stroke-linecap':'round'},svg);
    for(let v=0;v<=4;v++){const an=Math.PI-v/4*Math.PI;
      el('line',{x1:cx+Math.cos(an)*(r-9),y1:cy-Math.sin(an)*(r-9),x2:cx+Math.cos(an)*(r+1),y2:cy-Math.sin(an)*(r+1),stroke:'#A8AFBA','stroke-width':1.4},svg);
      const t=el('text',{x:cx+Math.cos(an)*(r+15),y:cy-Math.sin(an)*(r+15)+3,'font-size':8.5,fill:'#A8AFBA','text-anchor':'middle'},svg);t.textContent=v}
    const val=Math.min(ad,4),an=Math.PI-val/4*Math.PI;
    el('line',{x1:cx,y1:cy,x2:cx+Math.cos(an)*62,y2:cy-Math.sin(an)*62,stroke:'#FF7A59','stroke-width':3,'stroke-linecap':'round'},svg);
    el('circle',{cx,cy,r:5,fill:'#FF7A59'},svg);
    const lab=ad<0.05?'压扁 · 丢维度':ad<1?'面积收缩':(det<0?'翻转 + 放大':'面积放大');
    const t1=el('text',{x:cx,y:cy-18,'font-size':15,'font-weight':700,'font-family':'var(--mono)',fill:'#B8431F','text-anchor':'middle'},svg);t1.textContent='|det| = '+fmt(ad);
    const t2=el('text',{x:cx,y:cy+14,'font-size':10,fill:'#7C8694','text-anchor':'middle'},svg);t2.textContent=lab;
  }};
}
/* ---- 视图：特征值读数 ---- */
function EigNode(body){
  body.innerHTML=`<div class="readouts"><div class="ro"><span>λ₁</span><b data-e="1"></b></div>
    <div class="ro"><span>λ₂</span><b data-e="2"></b></div></div>
    <div data-e="s" style="font-size:11px;color:var(--ink-400);margin-top:6px;line-height:1.5"></div>`;
  return{setValue(M){
    const tr=M.a+M.d,det=M.a*M.d-M.b*M.c,disc=tr*tr-4*det;
    if(disc>=0){const s=Math.sqrt(disc);
      $('[data-e="1"]',body).textContent=fmt((tr+s)/2);$('[data-e="2"]',body).textContent=fmt((tr-s)/2)}
    else{$('[data-e="1"]',body).textContent=fmt(tr/2)+'+'+fmt(Math.sqrt(-disc)/2)+'i';
      $('[data-e="2"]',body).textContent=fmt(tr/2)+'−'+fmt(Math.sqrt(-disc)/2)+'i'}
    $('[data-e="s"]',body).textContent=Math.abs(det)<1e-9?'奇异：像被压成低维':
      (disc<0?'含旋转成分（共轭复特征值）':'两个实特征方向：沿它们只缩放不旋转');
  }};
}
/* ---- 视图：单位正方形的像 ---- */
function SquareViewNode(body){
  body.innerHTML='<svg class="objsvg" viewBox="0 0 200 150" style="min-height:140px"></svg><div data-a style="font-size:11.5px;text-align:center;margin-top:2px"></div>';
  const svg=body.firstElementChild,lab=$('[data-a]',body);
  return{setValue(M){
    svg.innerHTML='';
    const cx=100,cy=112,S=52,px=(x,y)=>[cx+x*S,cy-y*S];
    el('line',{x1:0,y1:cy,x2:200,y2:cy,stroke:'#D5CCB9'},svg);
    el('line',{x1:cx,y1:6,x2:cx,y2:148,stroke:'#D5CCB9'},svg);
    const sq=[[0,0],[1,0],[1,1],[0,1]];
    el('polygon',{points:sq.map(p=>px(p[0],p[1]).join(',')).join(' '),fill:'none',stroke:'#C7BFAE','stroke-dasharray':'4 3'},svg);
    const{a,b,c,d}=M;
    el('polygon',{points:sq.map(p=>px(a*p[0]+b*p[1],c*p[0]+d*p[1]).join(',')).join(' '),fill:'rgba(255,122,89,.16)',stroke:'#FF7A59','stroke-width':2},svg);
    lab.innerHTML=`面积 = <b class="live">${fmt(Math.abs(a*d-b*c))}</b>（原面积 1）`;
  }};
}

/* ---- 便签：自由文字（无端口，纯注释） ---- */
function TextNode(body){
  body.innerHTML='<div class="ctx" contenteditable spellcheck="false">双击改字：这里可以直接写笔记、公式注释、思路……</div>';
  return{};
}

/* ---- 节点 / 连线引擎 ---- */
const CNODES={
  text:{title:'便签',dot:'#7C8694',badge:'文字',w:230,factory:TextNode,ports:[]},
  matrixsrc:{title:'矩阵源',dot:'var(--coral)',badge:'源',w:196,factory:MatrixSourceNode,ports:['out']},
  transform:{title:'变换视图',dot:'var(--indigo)',badge:'视图',w:400,factory:TransformViewNode,ports:['in']},
  detgauge:{title:'det 仪表',dot:'var(--indigo)',badge:'视图',w:200,factory:DetGaugeNode,ports:['in']},
  eigread:{title:'特征值读数',dot:'var(--indigo)',badge:'视图',w:196,factory:EigNode,ports:['in']},
  sqview:{title:'像的形状',dot:'var(--indigo)',badge:'视图',w:200,factory:SquareViewNode,ports:['in']},
};
function addNode(type,x,y){
  const def=CNODES[type],id='n'+(++cv.seq);
  const card=document.createElement('div');card.className='cnode';card.id='node-'+id;
  card.style.left=x+'px';card.style.top=y+'px';card.style.width=def.w+'px';
  card.innerHTML=`<div class="cn-head"><span class="cn-dot" style="background:${def.dot}"></span>${def.title}
    <span class="cn-badge ${def.ports.includes('out')?'':'sink'}">${def.badge}</span>
    <button class="cn-x" title="移除">×</button></div><div class="cn-body"></div>
    ${def.ports.includes('in')?`<div class="port in" id="pin-${id}" title="输入端口"></div>`:''}
    ${def.ports.includes('out')?`<div class="port out" id="pout-${id}" title="输出 · 拖到蓝色输入端口连线"></div>`:''}`;
  cv.inner.appendChild(card);
  const node={id,type,el:card,api:def.factory($('.cn-body',card))};
  cv.nodes.push(node);
  if(node.api.onChange)node.api.onChange(()=>propagate(node));
  $('.cn-head',card).onpointerdown=e=>startNodeDrag(e,node);
  $('.cn-x',card).onclick=()=>{removeNode(node);toast('已移除对象')};
  const po=$('#pout-'+id,card);
  if(po)po.onpointerdown=e=>startWireDrag(e,node);
  return node;
}
function startNodeDrag(e,node){
  if(e.target.closest('.cn-x'))return;
  e.preventDefault();
  const sx=e.clientX,sy=e.clientY,ox=node.el.offsetLeft,oy=node.el.offsetTop;
  const mv=ev=>{node.el.style.left=Math.max(0,ox+(ev.clientX-sx)/cv.zoom)+'px';
    node.el.style.top=Math.max(0,oy+(ev.clientY-sy)/cv.zoom)+'px';redrawWires()};
  const up=()=>{document.removeEventListener('pointermove',mv);document.removeEventListener('pointerup',up)};
  document.addEventListener('pointermove',mv);document.addEventListener('pointerup',up);
}
function startWireDrag(e,fromNode){
  e.preventDefault();e.stopPropagation();
  const tp=el('path',{stroke:'#FF7A59','stroke-width':2,fill:'none','stroke-dasharray':'5 4'},cv.wsvg);
  const p1=portC($('#pout-'+fromNode.id,cv.inner));
  $$('.port.in',cv.inner).forEach(p=>p.classList.add('armed'));
  const mv=ev=>{const ir=cv.inner.getBoundingClientRect();
    tp.setAttribute('d',wirePath(p1,[(ev.clientX-ir.left)/cv.zoom,(ev.clientY-ir.top)/cv.zoom]))};
  const up=ev=>{
    document.removeEventListener('pointermove',mv);document.removeEventListener('pointerup',up);
    tp.remove();$$('.port.in',cv.inner).forEach(p=>p.classList.remove('armed'));
    const target=$$('.port.in',cv.inner).find(p=>{const r=p.getBoundingClientRect();
      return ev.clientX>r.left-10&&ev.clientX<r.right+10&&ev.clientY>r.top-10&&ev.clientY<r.bottom+10});
    if(target){const toId=target.id.replace('pin-','');
      if(toId!==fromNode.id){connect(fromNode.id,toId);toast('已连线：源数据现在流进这个视图')}
      else toast('不能连自己')}
  };
  document.addEventListener('pointermove',mv);document.addEventListener('pointerup',up);
  mv(e);
}
function connect(fromId,toId){
  cv.wires.filter(w=>w.to===toId).slice().forEach(removeWire); /* 一个输入只接一条线 */
  const path=el('path',{stroke:'#8A84E8','stroke-width':2.2,fill:'none'},cv.wsvg);
  const hit=el('path',{stroke:'rgba(0,0,0,0)','stroke-width':14,fill:'none'},cv.wsvg);
  const pc=el('circle',{r:4,fill:'#FF7A59'},cv.wsvg);
  const am=el('animateMotion',{dur:'0.55s',begin:'indefinite',fill:'freeze'},pc);
  const w={from:fromId,to:toId,path,hit,am};
  hit.style.pointerEvents='stroke';hit.style.cursor='pointer';
  hit.onpointerenter=()=>path.setAttribute('stroke','#B8431F');
  hit.onpointerleave=()=>path.setAttribute('stroke','#8A84E8');
  hit.onclick=()=>{removeWire(w);toast('连线已删除')};
  cv.wires.push(w);redrawWires();
  const src=cv.nodes.find(n=>n.id===fromId);
  cv.nodes.find(n=>n.id===toId).api.setValue(src.api.getValue());
  pulse(w);
}
function removeWire(w){w.path.remove();w.hit.remove();w.am.parentNode.remove();cv.wires=cv.wires.filter(x=>x!==w)}
function removeNode(node){node.el.remove();cv.nodes=cv.nodes.filter(n=>n!==node);
  cv.wires.filter(w=>w.from===node.id||w.to===node.id).slice().forEach(removeWire)}
function pulse(w){try{w.am.beginElement()}catch(_){}}
function redrawWires(){
  if(!cv.inner)return;
  for(const w of cv.wires){
    const po=$('#pout-'+w.from,cv.inner),pi=$('#pin-'+w.to,cv.inner);
    if(!po||!pi)continue;
    const d=wirePath(portC(po),portC(pi));
    w.path.setAttribute('d',d);w.hit.setAttribute('d',d);w.am.setAttribute('path',d);
  }
}
function propagate(node){
  for(const w of cv.wires.filter(w=>w.from===node.id)){
    cv.nodes.find(n=>n.id===w.to).api.setValue(node.api.getValue());pulse(w);
  }
}
/* ---- 自由手写墨迹层 ---- */
const ink={tool:'select',color:'#2F3A49',strokes:[]};
function strokePath(pts){
  if(pts.length<3)return'M'+pts.map(p=>fmt(p[0],1)+','+fmt(p[1],1)).join('L');
  let d=`M${fmt(pts[0][0],1)},${fmt(pts[0][1],1)}`;
  for(let i=1;i<pts.length-1;i++){
    const mx=(pts[i][0]+pts[i+1][0])/2,my=(pts[i][1]+pts[i+1][1])/2;
    d+=` Q${fmt(pts[i][0],1)},${fmt(pts[i][1],1)} ${fmt(mx,1)},${fmt(my,1)}`;
  }
  return d;
}
function inkXY(e){const ir=cv.inner.getBoundingClientRect();
  return[(e.clientX-ir.left)/cv.zoom,(e.clientY-ir.top)/cv.zoom]}
function startStroke(e){
  e.preventDefault();
  const pts=[inkXY(e)];
  const p=el('path',{fill:'none',stroke:ink.color,'stroke-width':2.4,'stroke-linecap':'round','stroke-linejoin':'round'},cv.ink);
  cv.strokes.push({pts,path:p});
  const mv=ev=>{pts.push(inkXY(ev));p.setAttribute('d',strokePath(pts))};
  const up=()=>{document.removeEventListener('pointermove',mv);document.removeEventListener('pointerup',up)};
  document.addEventListener('pointermove',mv);document.addEventListener('pointerup',up);
  mv(e);
}
function eraseAt(e){
  const[x,y]=inkXY(e),R=16;
  ink.strokes=ink.strokes.filter(s=>{
    const hit=s.pts.some(p=>Math.hypot(p[0]-x,p[1]-y)<R);
    if(hit)s.path.remove();return!hit});
}
function beginErase(e){e.preventDefault();eraseAt(e);
  const mv=ev=>eraseAt(ev);
  const up=()=>{document.removeEventListener('pointermove',mv);document.removeEventListener('pointerup',up)};
  document.addEventListener('pointermove',mv);document.addEventListener('pointerup',up)}
function setTool(t){
  ink.tool=ink.tool===t?'select':t;
  $$('[data-tool]').forEach(b=>b.classList.toggle('tool-on',
    (b.dataset.tool==='pen'&&ink.tool==='pen')||(b.dataset.tool==='erase'&&ink.tool==='erase')));
  cv.inner.classList.toggle('inkmode',ink.tool==='pen'||ink.tool==='erase');
}
function initInk(){
  cv.ink=$('#ink');
  cv.inner.addEventListener('pointerdown',e=>{
    if(ink.tool==='erase'){beginErase(e);return}
    const pen=ink.tool==='pen'||e.pointerType==='pen';   // 手写笔落下即写
    if(!pen)return;
    if(e.target.closest('.port'))return;                 // 端口优先连线
    startStroke(e);
  });
  $$('[data-tool]').forEach(b=>b.onclick=()=>{
    if(b.dataset.tool==='clear'){ink.strokes.forEach(s=>s.path.remove());ink.strokes=[];toast('墨迹已清');return}
    setTool(b.dataset.tool)});
  $$('#inkcolors .ic').forEach(i=>i.onclick=()=>{
    $$('#inkcolors .ic').forEach(x=>x.classList.remove('on'));i.classList.add('on');
    ink.color=i.dataset.ic;if(ink.tool!=='pen')setTool('pen')});
}

function initCanvas(){
  cv.inner=$('#cinner');cv.wsvg=$('#wires');
  initInk();
  addNode('text',70,40);
  addNode('matrixsrc',70,170);
  addNode('transform',390,60);
  addNode('detgauge',900,80);
  addNode('eigread',900,310);
  addNode('sqview',1130,90);
  requestAnimationFrame(()=>{connect('n2','n3');connect('n2','n4');connect('n2','n5');connect('n2','n6')});
  $$('.cpal [data-add]').forEach(b=>b.onclick=()=>{
    const t=b.dataset.add;
    addNode(t,110+cv.nodes.length*34,120+cv.nodes.length*28);
    toast(t==='text'?'便签已添加，点进去直接写':'已添加「'+CNODES[t].title+'」——从红点拖到蓝圈连线')});
  $$('.cpal [data-zoom]').forEach(b=>b.onclick=()=>
    setZoom(cv.zoom+(b.dataset.zoom==='in'?0.15:-0.15)));
}

/* ---------- 启动 ---------- */
renderDoc();initCanvas();route();
