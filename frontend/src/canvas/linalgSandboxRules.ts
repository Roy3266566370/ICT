/** 可随画布保存、在规则 Worker 中离线执行的线性代数规则。 */

const la01SharedInput = String.raw`
  const scalar = port => upstream.find(value => value.kind === "scalar" &&
    (port === "aux" ? value.port === "aux" : value.port !== "aux"))?.v;
  const scene = Math.max(0, Math.min(3, Math.round(scalar("in") ?? params.scene ?? 0)));
  const amount = Math.max(0, Math.min(2, scalar("aux") ?? params.amount ?? 1));
  const eps = 1e-9;
  const fmt = value => Math.abs(value) < eps ? 0 : Number(value.toFixed(5));
  const entries = vector => "(" + vector.map(fmt).join(", ") + ")";
  const range = count => Array.from({length: count}, (_, index) => index);
  const product = (A, B) => A.map(row => B[0].map((_, col) => row.reduce((sum, item, k) => sum + item * B[k][col], 0)));
`;

const la01Geometry = String.raw`
  const ink = "#283242", blue = "#2659b3", teal = "#0b736b", red = "#af391f";
  const line = (from, to, stroke, strokeWidth = 1.2, dashed = false) =>
    ({kind:"line", x1:from[0], y1:from[1], x2:to[0], y2:to[1], stroke, strokeWidth, dashed});
  const arrow = (from, to, stroke, strokeWidth = 2) =>
    ({kind:"arrow", x1:from[0], y1:from[1], x2:to[0], y2:to[1], stroke, strokeWidth});
  const dot = (point, fill, r = 4.5) => ({kind:"circle", cx:point[0], cy:point[1], fill, r, stroke:"#fffdf8", strokeWidth:1.2});
  const label = (x, y, text, fill = ink, size = 12) => ({kind:"text", x, y, text, fill, size, anchor:"middle"});
  const polygon = (points, fill, stroke, strokeWidth = 1.6) => ({kind:"polygon", points, fill, stroke, strokeWidth});
  const plot = (centerX, centerY, scale) => point => [centerX + point[0] * scale, centerY - point[1] * scale];
  const axes = (map, span) => [
    line(map([-span,0]), map([span,0]), "#9098a5"),
    line(map([0,-span]), map([0,span]), "#9098a5"),
  ];
  const lattice = (map, transform, color) => [-1, -0.5, 0, 0.5, 1].flatMap(n => [
    line(map(transform([-1.25,n])), map(transform([1.25,n])), color, 1),
    line(map(transform([n,-1.25])), map(transform([n,1.25])), color, 1),
  ]);
  const unit = range(40).map(k => [Math.cos(k * Math.PI / 20), Math.sin(k * Math.PI / 20)]);
  const square = [[0,0],[1,0],[1,1],[0,1]];
`;

const la01Matrix = String.raw`
  const theta = Math.PI * amount / 4;
  const angle = Math.PI * (amount - 1) / 4;
  const matrices = [
    [[Math.cos(theta),-Math.sin(theta)],[Math.sin(theta),Math.cos(theta)]],
    [[1,amount],[0,1]],
    [[Math.cos(angle),Math.sin(angle)],[Math.sin(angle),-Math.cos(angle)]],
    [[1,amount/2],[0,0]],
  ];
  const A = matrices[scene];
  const caseName = ["旋转 " + fmt(amount * 45) + "°", "水平剪切", "镜像翻转", "奇异降维"][scene];
  const apply = (M, v) => M.map(row => row[0] * v[0] + row[1] * v[1]);
  const det2 = M => M[0][0] * M[1][1] - M[0][1] * M[1][0];
  const trace2 = M => M[0][0] + M[1][1];
  const matrix = M => M.map(entries).join(" / ");
  const det = det2(A), trace = trace2(A);
  const rank = Math.abs(det) > eps ? 2 : A.flat().some(value => Math.abs(value) > eps) ? 1 : 0;
`;

export const la01GridRule = `function run({params, upstream}) {
  ${la01SharedInput}
  ${la01Geometry}
  ${la01Matrix}
  const transform = point => apply(A, point);
  const bound = Math.max(1.5, ...[[-1.25,-1.25],[-1.25,1.25],[1.25,-1.25],[1.25,1.25]]
    .flatMap(point => transform(point).map(Math.abs))) + .12;
  const map = plot(220, 137, 92 / bound);
  const singular = Math.abs(det) < .001;
  const focus = det < 0 || singular ? red : teal;
  const notice = singular ? "奇异降维" : det < 0 ? "定向翻转" : "定向保持";
  const items = [
    ...lattice(map, point => point, "#c0c7d1"),
    ...lattice(map, transform, "#85a7de"),
    ...axes(map, bound),
    polygon(unit.map(map), "none", "#758092", 1.2),
    polygon(unit.map(point => map(transform(point))), "none", blue, 2),
    polygon(square.map(point => map(transform(point))), det < 0 ? "#f3c3b5" : "#c3e4db", focus),
    arrow(map([0,0]), map(transform([1,0])), red),
    arrow(map([0,0]), map(transform([0,1])), teal),
    label(220, 33, caseName + " · " + notice, focus),
    label(220, 258, "灰：原网格和单位圆   蓝：变换网格和椭圆   填色：像的面积"),
  ];
  return { data: { A, det, trace, rank, invertible: rank === 2 }, frames: [{
    title: "单位网格、圆与有向面积",
    summary: "单位正方形的像面积 |det A| = " + fmt(Math.abs(det)) + "；det A = " + fmt(det) + "，" + notice + "。",
    shapes: { viewBox:[440,288], items },
    columns: ["核对项","结果"], rows: [["矩阵 A",matrix(A)],["det A",fmt(det)],["tr A",fmt(trace)],["rank A",rank],["可逆",rank === 2]],
  }] };
}`;

export const la01ComposeRule = `function run({params, upstream}) {
  ${la01SharedInput}
  ${la01Geometry}
  ${la01Matrix}
  const B = [[1.25,.25],[.35,.65]], v = [.85,.65];
  const AB = product(A, B), BA = product(B, A);
  const Bv = apply(B,v), Av = apply(A,v), ABv = apply(AB,v), BAv = apply(BA,v);
  const difference = Math.max(...AB.flatMap((row,i) => row.map((x,j) => Math.abs(x-BA[i][j]))));
  const bound = Math.max(1.4, ...[v,Bv,Av,ABv,BAv].flatMap(pair => pair.map(Math.abs))) + .14;
  const maps = [plot(139,143,87/bound),plot(401,143,87/bound)];
  const mix = (from,to,t) => from.map((value,i) => value + t*(to[i] - value));
  const route = (map, mid, end, step, color) => {
    const position = step <= 8 ? mix(v,mid,step/8) : mix(mid,end,(step-8)/8);
    return [
      ...axes(map,bound),
      line(map(v),map(mid),"#9aabc1",1.6,true),
      line(map(mid),map(end),"#9aabc1",1.6,true),
      dot(map(v),"#667489",3.2), dot(map(mid),"#667489",3.2), dot(map(end),color,3.2),
      arrow(map(v),map(step <= 8 ? position : mid),color),
      ...(step > 8 ? [arrow(map(mid),map(position),color)] : []),
      dot(map(position),color,5.1),
    ];
  };
  const frames = range(17).map(step => ({
    title: step === 0 ? "同一个初始向量 v" : step <= 8 ? "先作用右侧矩阵" : "再作用左侧矩阵",
    summary: "左侧先 B 后 A，右侧先 A 后 B。此情景 " + (difference > eps ? "AB ≠ BA" : "AB = BA") +
      "，最大矩阵元素差 " + fmt(difference) + "。",
    shapes: {viewBox:[540,288], items:[
      label(139,36,"A(Bv) · 先 B 后 A",blue),
      label(401,36,"B(Av) · 先 A 后 B",teal),
      line([270,55],[270,235],"#d7dce4"),
      ...route(maps[0],Bv,ABv,step,blue), ...route(maps[1],Av,BAv,step,teal),
      label(139,258,"终点 " + entries(ABv),blue), label(401,258,"终点 " + entries(BAv),teal),
    ]},
    columns:["路径","中间落点","最终落点","矩阵乘积"],
    rows:[["先 B 后 A",entries(Bv),entries(ABv),matrix(AB)],["先 A 后 B",entries(Av),entries(BAv),matrix(BA)]],
  }));
  return {data:{A,B,AB,BA,v,ABv,BAv,commutatorError:difference,commute:difference<=eps},frames};
}`;

export const la01BasisRule = `function run({params, upstream}) {
  ${la01SharedInput}
  ${la01Geometry}
  ${la01Matrix}
  const P=[[1,.55],[.25,1]], v=[.9,.65];
  const inverse = [[P[1][1],-P[0][1]],[-P[1][0],P[0][0]]].map(row => row.map(value => value/det2(P)));
  const Aprime = product(product(inverse,A),P);
  const coords = apply(inverse,v), result = apply(A,v), resultCoords = apply(Aprime,coords);
  const Pcoord = point => apply(P,point);
  const baseDet = det2(Aprime), baseTrace = trace2(Aprime);
  const bound = Math.max(1.95, ...result.map(Math.abs), ...resultCoords.map(Math.abs)) + .1;
  const left = plot(145,141,89/bound), right = plot(419,141,89/bound);
  const firstComponent = Pcoord([coords[0],0]);
  const step = (map, from, to, color) => Math.hypot(...from.map((x,i) => x-to[i])) > eps
    ? [arrow(map(from),map(to),color)] : [dot(map(to),color)];
  const items = [
    label(145,35,"标准坐标中的斜基 P",blue), label(419,35,"以 P 为基的坐标表示",teal),
    line([282,54],[282,233],"#d7dce4"),
    ...lattice(left,point => point,"#d9dde3"), ...lattice(left,Pcoord,"#a0b5dc"),
    ...axes(left,bound), ...axes(right,bound),
    arrow(left([0,0]),left([1,.25]),red), arrow(left([0,0]),left([.55,1]),teal),
    line(left([0,0]),left(firstComponent),"#718195",1.2,true),
    line(left(firstComponent),left(v),"#718195",1.2,true),
    ...step(left,[0,0],v,blue), ...step(left,v,result,red),
    ...step(right,[0,0],coords,blue), ...step(right,coords,resultCoords,red),
    label(145,258,"v = " + entries(v),blue), label(419,258,"P⁻¹v = " + entries(coords),teal),
  ];
  return {data:{A,P,Aprime,v,vPrime:coords,det,trace,detPrime:baseDet,tracePrime:baseTrace,
    determinantError:Math.abs(det-baseDet),traceError:Math.abs(trace-baseTrace)},frames:[{
    title:"斜基坐标与相似矩阵",
    summary:"蓝箭头表示输入坐标，朱红箭头表示从输入到变换结果的位移。换基前后，行列式与迹相同。",
    shapes:{viewBox:[564,288],items}, columns:["核对项","标准基","斜基 P"],
    rows:[["输入向量",entries(v),entries(coords)],["输出向量",entries(result),entries(resultCoords)],
      ["变换矩阵",matrix(A),matrix(Aprime)],["行列式",fmt(det),fmt(baseDet)],["迹",fmt(trace),fmt(baseTrace)]],
  }]};
}`;

const la02System = String.raw`
  const slope = .5 + .3*amount;
  const factor = 1.7 + .3*amount;
  const x0 = .9 + .25*amount, y0 = -.5 + .2*amount, z0 = .45 + .1*amount;
  const xy = [1,slope,.5];
  const independent = [2,-1,1];
  const z = [0,0,1];
  const dependent = xy.map(value => value * factor);
  const A = [
    [xy,independent,z],
    [xy,dependent,z],
    [xy,dependent,z],
    [z,xy,independent],
  ][scene];
  const b = A.map(row => row[0]*x0 + row[1]*y0 + row[2]*z0);
  if (scene === 2) b[1] += .65 + .2 * amount;
  const clean = A => A.map(row => row.map(fmt));
`;

const la02Gaussian = String.raw`
  const R = A.map((row,index) => [...row,b[index]]);
  const operations = [];
  const pivots = [];
  const save = (summary, activeCell) => operations.push({summary, activeCell, cells: R.map(row => [...row])});
  save("原始增广矩阵 [A | b]。");
  let r = 0;
  for (let col = 0; col < 4 && r < 3; col++) {
    let pivot = r;
    for (let row = r + 1; row < 3; row++) if (Math.abs(R[row][col]) > Math.abs(R[pivot][col])) pivot = row;
    if (Math.abs(R[pivot][col]) < eps) continue;
    if (r !== pivot) {
      [R[r],R[pivot]] = [R[pivot],R[r]];
      save("R" + (r+1) + " ↔ R" + (pivot+1) + "：交换两行以选取非零主元。", [r,col]);
    }
    pivots.push([r,col]);
    for (let row = r + 1; row < 3; row++) {
      const scale = R[row][col] / R[r][col];
      if (Math.abs(scale) < eps) continue;
      R[row] = R[row].map((value,j) => value - scale*R[r][j]);
      R[row][col] = 0;
      save("R" + (row+1) + " ← R" + (row+1) + " − (" + fmt(scale) + ")R" + (r+1) + "：消去主元下方元素。", [r,col]);
    }
    r++;
  }
  for (const [row,col] of [...pivots].reverse()) {
    const pivot = R[row][col];
    if (Math.abs(pivot-1) > eps) {
      R[row] = R[row].map(value => value/pivot);
      R[row][col] = 1;
      save("R" + (row+1) + " ← R" + (row+1) + " / (" + fmt(pivot) + ")：主元归一化。", [row,col]);
    }
    for (let above = row-1; above >= 0; above--) {
      const scale = R[above][col];
      if (Math.abs(scale) < eps) continue;
      R[above] = R[above].map((value,j) => value - scale*R[row][j]);
      R[above][col] = 0;
      save("R" + (above+1) + " ← R" + (above+1) + " − (" + fmt(scale) + ")R" + (row+1) + "：回代消去主元上方元素。", [row,col]);
    }
  }
  const rankA = pivots.filter(pair => pair[1] < 3).length, rankAb = pivots.length;
  const solutionType = rankAb > rankA ? "none" : rankA === 3 ? "unique" : "infinite";
  const typeName = {unique:"唯一解",infinite:"无穷多解",none:"无解"}[solutionType];
  save("得到 RREF。rank(A) = " + rankA + "，rank([A|b]) = " + rankAb + "，" + typeName + "。", pivots[0]);
`;

export const la02RrefRule = `function run({params, upstream}) {
  ${la01SharedInput}
  ${la02System}
  ${la02Gaussian}
  const bound = Math.max(1,...operations.flatMap(frame => frame.cells.flat().map(Math.abs)));
  const frames = operations.map((step,index) => ({
    title: index === operations.length - 1 ? "最简行阶梯形 RREF" : "消元步骤 " + index,
    summary:step.summary,
    grid:{cells:clean(step.cells),colLabels:["x","y","z","b"],rowLabels:["R1","R2","R3"],
      palette:"diverging",min:-bound,max:bound,showValues:true,activeCell:step.activeCell},
    columns:["行","x","y","z","b"],rows:clean(step.cells).map((row,j) => ["R" + (j+1),...row]),
  }));
  return {data:{A,b,rankA,rankAb,solutionType,rref:R,pivots},frames};
}`;

export const la02LuRule = `function run({params, upstream}) {
  ${la01SharedInput}
  ${la02System}
  const U = A.map(row => [...row]);
  const identity = () => range(3).map(i => range(3).map(j => Number(i === j)));
  const L = identity(), P = identity();
  const exchanges = [];
  for(let k = 0; k < 3; k++) {
    let pivot = k;
    for (let row = k+1; row < 3; row++) if (Math.abs(U[row][k]) > Math.abs(U[pivot][k])) pivot = row;
    if (Math.abs(U[pivot][k]) < eps) continue;
    if (pivot !== k) {
      [U[k],U[pivot]] = [U[pivot],U[k]];
      [P[k],P[pivot]] = [P[pivot],P[k]];
      for (let col = 0; col < k; col++) [L[k][col],L[pivot][col]] = [L[pivot][col],L[k][col]];
      exchanges.push("R" + (k+1) + " ↔ R" + (pivot+1));
    }
    for (let row = k+1; row < 3; row++) {
      const scale = U[row][k] / U[k][k];
      L[row][k] = scale;
      for (let col = k; col < 3; col++) U[row][col] -= scale * U[k][col];
      U[row][k] = 0;
    }
  }
  const PA = product(P,A), LU = product(L,U);
  const luError = Math.max(...PA.flatMap((row,i) => row.map((x,j) => Math.abs(x-LU[i][j]))));
  const cells = clean([...L,...U]);
  const bound = Math.max(1,...cells.flat().map(Math.abs));
  return {data:{A,L,U,P,PA,LU,luError,reconstructionError:luError,swapCount:exchanges.length},frames:[{
    title:"部分主元分解 PA = LU",
    summary:"上三行为单位下三角 L，下三行为上三角 U。行交换：" + (exchanges.join("、") || "无") +
      "。最大元素重构残差 " + luError.toExponential(2) + "。",
    grid:{cells,colLabels:["列 1","列 2","列 3"],rowLabels:["L₁","L₂","L₃","U₁","U₂","U₃"],
      palette:"diverging",min:-bound,max:bound,showValues:true},
    columns:["核对对象","第 1 行","第 2 行","第 3 行"],
    rows:[["P",...P.map(entries)],["PA",...PA.map(entries)],["LU",...LU.map(entries)]],
  }]};
}`;

export const la02SolutionRule = `function run({params, upstream}) {
  ${la01SharedInput}
  ${la01Geometry}
  ${la02System}
  ${la02Gaussian}
  const primary = pivots.filter(pair => pair[1] < 3);
  const free = [0,1,2].filter(col => !primary.some(pair => pair[1] === col));
  const particular = solutionType === "none" ? null : [0,0,0];
  if (particular) for (const [row,col] of primary) particular[col]=R[row][3];
  const nullBasis = free.map(col => {
    const direction = [0,0,0];
    direction[col]=1;
    for (const [row,pivotCol] of primary) direction[pivotCol]=-R[row][col];
    return direction;
  });
  const span=2.45;
  const map = plot(255,154,105/span);
  const slice = (a,b,c) => {
    const candidates = [];
    if (Math.abs(a)>eps) candidates.push([(c+b*span)/a,-span],[(c-b*span)/a,span]);
    if (Math.abs(b)>eps) candidates.push([-span,(c+a*span)/b],[span,(c-a*span)/b]);
    return candidates.filter(point => point.every(x => Math.abs(x) <= span+eps))
      .filter((point,index,all) => all.findIndex(other => Math.hypot(point[0]-other[0],point[1]-other[1])<eps)===index).slice(0,2);
  };
  const traces = A.flatMap((row,i) => {
    if (Math.hypot(row[0],row[1])<eps) return [];
    return [{index:i,color:row===xy ? blue : red, endpoints:slice(row[0],row[1],b[i]-z0*row[2])}];
  });
  const items=[
    label(255,36,"固定 z = " + fmt(z0) + " 后，观察 x–y 截面"),
    ...axes(map,span),
    ...traces.flatMap((entry,i) => entry.endpoints.length<2 ? [] : [
      line(map(entry.endpoints[0]),map(entry.endpoints[1]),entry.color,i===0?3.8:2,i!==0),
    ]),
    ...traces.map((entry,i) => label(142+226*i,298,"方程 R" + (entry.index+1),entry.color)),
  ];
  if (solutionType === "unique" && particular) items.push(dot(map(particular),teal,5));
  if (solutionType === "infinite" && particular && nullBasis[0]) {
    for (const t of [-1,0,1]) items.push(dot(map(particular.map((value,i) => value+t*nullBasis[0][i])),teal,4));
  }
  const notes = {
    none:"两条平行直线互不相交。消元得到矛盾行 0 = 1。",
    unique:"两条直线相交于 " + (particular ? entries(particular) : "—") + "，三条方程确定唯一解。",
    infinite:"两条直线完全重合。绿色点是同一直线上取 t = −1、0、1 的样本，解为 x = xₚ + t xₙ。",
  };
  return {data:{A,b,rankA,rankAb,solutionType,particular,nullBasis},frames:[{
    title:"方程组几何 · " + typeName, summary:notes[solutionType],
    shapes:{viewBox:[510,330],items},columns:["核对项","结果"],
    rows:[["rank(A) / rank([A|b])",rankA + " / " + rankAb],["z 截面",fmt(z0)],
      ["特解 xₚ",particular ? entries(particular) : "不存在"],
      ["齐次零空间基 xₙ",nullBasis.length ? nullBasis.map(entries).join(" / ") : "零空间只含零向量"]],
  }]};
}`;

/** 线性代数第 3–4 章。规则随 CanvasDoc 进入同一 Worker 和离线播放器。 */
const la03Inputs = String.raw`
  const scalar = (port) => upstream.find((item) => item.kind === "scalar" && (item.port ?? "in") === port)?.v;
  const scene = Math.max(0, Math.min(3, Math.round(scalar("in") ?? params.scene ?? 0)));
  const amount = Math.max(0, Math.min(2, scalar("aux") ?? params.amount ?? 1));
`;

const la03VectorMath = String.raw`
  const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
  const norm = (v) => Math.sqrt(dot(v, v));
  const scale = (v, c) => v.map((n) => n * c);
  const plus = (a, b) => a.map((n, i) => n + b[i]);
  const minus = (a, b) => plus(a, scale(b, -1));
  const transpose = (matrix) => matrix[0].map((_, j) => matrix.map((row) => row[j]));
  const product = (a, b) => {
    const columns = transpose(b);
    return a.map((row) => columns.map((column) => dot(row, column)));
  };
  const maxAbs = (values) => Math.max(0, ...values.map(Math.abs));
  const maxRowSum = (matrix) => Math.max(0, ...matrix.map((row) => row.reduce((s, n) => s + Math.abs(n), 0)));
  const matrixMinus = (a, b) => a.map((row, i) => minus(row, b[i]));
  const unitVector = (n, i) => Array.from({ length: n }, (_, j) => Number(i === j));
  const identity = (n) => Array.from({ length: n }, (_, i) => unitVector(n, i));
  const fmt = (n) => Number(n.toPrecision(5));
  const vectorText = (v) => "(" + v.map(fmt).join(", ") + ")";
`;

const la03Spaces = String.raw`
  const eps = 1e-10;
  const independent = (vectors, against = []) => {
    const basis = [...against];
    for (const vector of vectors) {
      let remainder = vector.slice();
      // Reorthogonalization avoids loss of orthogonality for nearly dependent rows.
      for (let pass = 0; pass < 2; pass++) {
        for (const q of basis) remainder = minus(remainder, scale(q, dot(remainder, q)));
      }
      const length = norm(remainder);
      if (length > eps) basis.push(scale(remainder, 1 / length));
    }
    return basis.slice(against.length);
  };
  const n = scene === 3 ? 3 : 2;
  const alpha = scene === 1 ? amount - 1 : amount;
  const row = n === 3 ? [1, .5, -.5] : [1, .5];
  const direction = n === 3 ? [-.5, 1, 0] : [-.5, 1];
  const A = [row, plus(scale(row, 2), scale(direction, alpha))];
  if (scene === 2) A.push(plus(scale(row, -1), scale(direction, .5 * alpha)));
  const m = A.length;
  const rowBasis = independent(A);
  const columnBasis = independent(transpose(A));
  const nullBasis = independent(identity(n), rowBasis);
  const leftNullBasis = independent(identity(m), columnBasis);
  const rank = rowBasis.length;
  const orthCheck = maxAbs([
    ...rowBasis.flatMap((r) => nullBasis.map((v) => dot(r, v))),
    ...columnBasis.flatMap((c) => leftNullBasis.map((v) => dot(c, v))),
  ]);
  const spaceData = { A, alpha, m, n, rank, nullity: nullBasis.length, leftNullity: leftNullBasis.length, orthCheck,
    rowBasis, columnBasis, nullBasis, leftNullBasis };
  const basisRows = [
    ["行空间 C(Aᵀ)", rank, rowBasis.map(vectorText).join("；") || "零子空间"],
    ["零空间 N(A)", nullBasis.length, nullBasis.map(vectorText).join("；") || "零子空间"],
    ["列空间 C(A)", columnBasis.length, columnBasis.map(vectorText).join("；") || "零子空间"],
    ["左零空间 N(Aᵀ)", leftNullBasis.length, leftNullBasis.map(vectorText).join("；") || "零子空间"],
  ];
`;

const la03Drawing = String.raw`
  const viewBox = [600, 280];
  const blue = "#3459b4", teal = "#167e78", red = "#b94838", gray = "#9aa6ab", ink = "#253842";
  const line = (from, to, stroke, dashed = false) => ({
    kind: "line", x1: from[0], y1: from[1], x2: to[0], y2: to[1], stroke, strokeWidth: 1.4, dashed,
  });
  const arrow = (from, to, stroke) => ({ ...line(from, to, stroke), kind: "arrow", strokeWidth: 2.5 });
  const box = (x, y, w, h, fill, stroke) => ({ kind: "rect", x, y, w, h, rx: 9, fill, stroke });
  const dotAt = ([cx, cy], fill, r = 4) => ({ kind: "circle", cx, cy, r, fill });
  const label = (x, y, text, fill = ink, size = 13) => ({ kind: "text", x, y, text, fill, size, anchor: "middle" });
  const xy = (v) => [v[0] + .44 * (v[2] ?? 0), v[1] + .36 * (v[2] ?? 0)];
  const projector = (vectors, origin = [300, 144]) => {
    const bound = Math.max(1, ...vectors.flatMap((v) => xy(v).map(Math.abs)));
    const factor = 81 / bound;
    return (v) => {
      const [x, y] = xy(v);
      return [origin[0] + factor * x, origin[1] - factor * y];
    };
  };
  const axes = (origin) => [
    line([origin[0] - 122, origin[1]], [origin[0] + 122, origin[1]], "#d0d9da"),
    line([origin[0], origin[1] - 90], [origin[0], origin[1] + 90], "#d0d9da"),
    line([origin[0] - 88, origin[1] + 60], [origin[0] + 88, origin[1] - 60], "#dfdfd7", true),
  ];
`;

export const la03MapRule = `
function run({ params, upstream }) {
  ${la03Inputs}
  ${la03VectorMath}
  ${la03Spaces}
  ${la03Drawing}
  const left = 141, right = 459;
  const items = [
    label(left, 43, "输入空间 ℝ" + (n === 3 ? "³" : "²"), ink, 16),
    label(right, 43, "输出空间 ℝ" + (m === 3 ? "³" : "²"), ink, 16),
    box(44, 63, 194, 68, "#e6edf8", blue),
    box(362, 63, 194, 68, "#e6f2ef", teal),
    box(44, 172, 194, 68, "#f7eae4", red),
    box(362, 172, 194, 68, "#f1eee7", gray),
    label(left, 91, "行空间 C(Aᵀ)", blue, 14),
    label(right, 91, "列空间 C(A)", teal, 14),
    label(left, 200, "零空间 N(A)", red, 14),
    label(right, 200, "左零空间 N(Aᵀ)", ink, 14),
    label(left, 114, "维数 " + rank, blue, 12),
    label(right, 114, "维数 " + columnBasis.length, teal, 12),
    label(left, 223, "维数 " + nullBasis.length, red, 12),
    label(right, 223, "维数 " + leftNullBasis.length, ink, 12),
    arrow([250, 101], [350, 101], blue),
    label(300, 85, "A", ink, 14),
    label(300, 125, "一一对应", ink, 11),
    arrow([250, 206], [334, 206], red),
    label(300, 189, "A", ink, 14),
    dotAt([350, 206], red),
    label(350, 229, "0", red, 11),
    label(left, 156, "正交直和 ⊕", ink, 12),
    label(right, 156, "正交直和 ⊕", ink, 12),
  ];
  return { data: spaceData, frames: [{
    title: "四大基本子空间",
    summary: "A 将行空间双射到列空间，将零空间送到零向量。秩 " + rank + " + 零度 " + nullBasis.length + " = " + n + "；秩 + 左零度 = " + m + "。",
    shapes: { viewBox, items }, columns: ["子空间", "维数", "标准正交基"], rows: basisRows,
  }] };
}
`;

export const la03DecomposeRule = `
function run({ params, upstream }) {
  ${la03Inputs}
  ${la03VectorMath}
  ${la03Spaces}
  ${la03Drawing}
  const component = (value, fallback) => Math.max(-3, Math.min(3, value ?? fallback));
  const x = [component(params.x1, 2), component(params.x2, 1), component(params.x3, 1.5)].slice(0, n);
  const xr = rowBasis.reduce((sum, q) => plus(sum, scale(q, dot(x, q))), scale(x, 0));
  const xn = minus(x, xr);
  const ax = A.map((r) => dot(r, x));
  const axr = A.map((r) => dot(r, xr));
  const axn = A.map((r) => dot(r, xn));
  const orthogonalDot = dot(xr, xn);
  const imageError = maxAbs(minus(ax, axr));
  const kernelError = maxAbs(axn);
  const origin = [300, 143], point = projector([x, xr, xn], origin);
  const items = [...axes(origin)];
  if (norm(xr) > eps) items.push(arrow(origin, point(xr), blue));
  if (norm(xn) > eps) items.push(arrow(point(xr), point(x), red), line(origin, point(xn), red, true));
  if (norm(x) > eps) items.push(line(origin, point(x), teal, true), dotAt(point(x), teal));
  items.push(dotAt(origin, ink, 3), label(144, 42, "行空间分量 xᵣ", blue), label(300, 42, "零空间分量 xₙ", red),
    label(452, 42, "原向量 x", teal), label(300, 253, n === 3 ? "三维向量的斜投影，正交性以数值核对为准" : "红线平移到 xᵣ 末端后，恰好到达 x", ink, 12));
  return { data: { ...spaceData, x, xr, xn, ax, axr, axn, orthogonalDot, imageError, kernelError }, frames: [{
    title: "向量的行空间与零空间分解",
    summary: "x = xᵣ + xₙ，xᵣ·xₙ = " + fmt(orthogonalDot) + "；‖Ax − Axᵣ‖∞ = " + fmt(imageError) + "；‖Axₙ‖∞ = " + fmt(kernelError) + "。",
    shapes: { viewBox, items }, columns: ["向量", "分量", "经 A 映射"],
    rows: [["原向量 x", vectorText(x), vectorText(ax)], ["行空间 xᵣ", vectorText(xr), vectorText(axr)],
      ["零空间 xₙ", vectorText(xn), vectorText(axn)]],
  }] };
}
`;

export const la03RankRule = `
function run({ params, upstream }) {
  ${la03Inputs}
  ${la03VectorMath}
  ${la03Spaces}
  return { data: spaceData, frames: [{
    title: "秩变敏感度与基矩阵核对",
    summary: "第 2 行 = 2 × 第 1 行 + α × 独立方向。当前 α = " + fmt(alpha) + "，秩 = " + rank
      + "。α 到达 0 时，独立方向消失。矩阵热图红正蓝负。",
    grid: { cells: A, showValues: true, palette: "diverging",
      rowLabels: A.map((_, i) => "行 " + (i + 1)), colLabels: A[0].map((_, i) => "列 " + (i + 1)) },
    columns: ["子空间", "维数", "标准正交基"], rows: basisRows,
  }] };
}
`;

const la04Inputs = String.raw`
  const scalar = (port) => upstream.find((item) => item.kind === "scalar" && (item.port ?? "in") === port)?.v;
  const scene = Math.max(0, Math.min(3, Math.round(scalar("in") ?? params.scene ?? 0)));
  const degreeMode = Math.max(0, Math.min(2, Math.round(scalar("aux") ?? params.amount ?? 0)));
  const degree = degreeMode || [2, 1, 2, 2][scene];
`;

const la04Design = String.raw`
  const xs = [-1.8, -1.3, -.8, -.3, .2, .7, 1.2, 1.7];
  const basisAt = (x) => Array.from({ length: degree + 1 }, (_, k) => x ** k);
  const A = xs.map(basisAt);
  const AT = transpose(A);
  const gram = product(AT, A);
  const solve = (matrix, rhs) => {
    const n = rhs.length;
    const rows = matrix.map((row, i) => [...row, rhs[i]]);
    for (let j = 0; j < n; j++) {
      let pivot = j;
      for (let i = j + 1; i < n; i++) if (Math.abs(rows[i][j]) > Math.abs(rows[pivot][j])) pivot = i;
      [rows[j], rows[pivot]] = [rows[pivot], rows[j]];
      const d = rows[j][j];
      rows[j] = scale(rows[j], 1 / d);
      for (let i = 0; i < n; i++) if (i !== j) rows[i] = minus(rows[i], scale(rows[j], rows[i][j]));
    }
    return rows.map((row) => row[n]);
  };
`;

export const la04QrRule = `
function run({ params, upstream }) {
  ${la04Inputs}
  ${la03VectorMath}
  ${la03Drawing}
  const s = Math.SQRT1_2;
  const vectorSets = [
    [[1, .82, .44], [1, .90, .38], [.2, -.32, 1]],
    [[1, .32, .16], [.56, 1, .3], [.35, .52, 1]],
    [[1, .44, .26], [.44, 1, .56], [.62, .18, 1]],
    [[s, s, 0], [-s, s, 0], [0, 0, 1]],
  ];
  const vectors = vectorSets[scene].slice(0, degree + 1);
  const original = transpose(vectors);
  const basis = [];
  const frames = [];
  const origin = [300, 143], point = projector(vectors, origin);
  const color = [blue, teal, red];
  const frame = (title, summary, current, index) => {
    const items = [...axes(origin)];
    for (let j = 0; j < basis.length && j < index; j++) {
      items.push(arrow(origin, point(basis[j]), color[j]));
    }
    if (norm(current) > 1e-12) items.push(arrow(origin, point(current), color[index]));
    items.push(dotAt(origin, ink, 3), label(300, 42, title, ink, 15),
      label(300, 253, "斜投影表示三维向量，表中给出真实三维坐标", ink, 12));
    frames.push({ title, summary, shapes: { viewBox, items }, columns: ["向量", "三维坐标"],
      rows: [...basis.slice(0, index).map((q, j) => ["q" + (j + 1), vectorText(q)]),
        ["当前", vectorText(current)]] });
  };
  for (let i = 0; i < vectors.length; i++) {
    let residual = vectors[i].slice();
    frame("取第 " + (i + 1) + " 个输入向量", "读取 v" + (i + 1) + "，随后减去它在已知正交方向上的分量。", residual, i);
    for (let j = 0; j < basis.length; j++) {
      const coefficient = dot(residual, basis[j]);
      residual = minus(residual, scale(basis[j], coefficient));
      frame("减去 q" + (j + 1) + " 方向投影",
        "w ← w − (q" + (j + 1) + "·w) q" + (j + 1) + "，本步投影系数为 " + fmt(coefficient) + "。", residual, i);
    }
    for (const q of basis) residual = minus(residual, scale(q, dot(residual, q)));
    const length = norm(residual);
    const q = scale(residual, 1 / length);
    basis.push(q);
    frame("单位化得到 q" + (i + 1), "用余向量的长度 " + fmt(length) + " 做归一化，得到单位向量 q" + (i + 1) + "。", q, i);
  }
  const Q = transpose(basis);
  const R = basis.map((q, i) => vectors.map((v, j) => i <= j ? dot(q, v) : 0));
  const orthoError = maxRowSum(matrixMinus(product(transpose(Q), Q), identity(basis.length)));
  const qrError = maxRowSum(matrixMinus(product(Q, R), original));
  const last = frames[frames.length - 1];
  last.title = "QR 分解与误差核对";
  last.summary += " ‖QᵀQ − I‖∞ = " + fmt(orthoError) + "；‖QR − A‖∞ = " + fmt(qrError) + "。";
  last.columns = ["矩阵", "行向量"];
  last.rows = [...Q.map((row, i) => ["Q 第 " + (i + 1) + " 行", vectorText(row)]),
    ...R.map((row, i) => ["R 第 " + (i + 1) + " 行", vectorText(row)])];
  return { data: { A: original, Q, R, degree, orthoError, qrError }, frames };
}
`;

export const la04LeastSquaresRule = `
function run({ params, upstream }) {
  ${la04Inputs}
  ${la03VectorMath}
  ${la04Design}
  ${la03Drawing}
  const noise = Math.max(0, Math.min(2, params.noise ?? 1)) * [.17, .075, .78, .22][scene];
  const offsets = [.35, -.9, .65, -.25, .75, -.62, .9, -.36];
  const quadratic = [.46, 0, .86, .28][scene];
  const b = xs.map((x, i) => .4 + .8 * x + quadratic * x * x + noise * offsets[i]);
  const rhs = AT.map((row) => dot(row, b));
  const coefficients = solve(gram, rhs);
  const fitted = A.map((row) => dot(row, coefficients));
  const residual = minus(b, fitted);
  const normalResidual = AT.map((row) => dot(row, residual));
  const residualOrthogonality = maxAbs(normalResidual);
  const mean = b.reduce((sum, value) => sum + value, 0) / b.length;
  const tss = b.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  const r2 = tss > 1e-12 ? 1 - dot(residual, residual) / tss : 1;
  const samples = Array.from({ length: 65 }, (_, i) => {
    const x = xs[0] + (xs[xs.length - 1] - xs[0]) * i / 64;
    return [x, dot(basisAt(x), coefficients)];
  });
  const lo = Math.min(...b, ...samples.map((p) => p[1]));
  const hi = Math.max(...b, ...samples.map((p) => p[1]));
  const margin = Math.max(.12, (hi - lo) * .09);
  const point = (x, y) => [72 + 456 * (x - xs[0]) / (xs[xs.length - 1] - xs[0]), 216 - 150 * (y - lo + margin) / (hi - lo + 2 * margin)];
  const items = [label(158, 43, "观测点", blue), label(300, 43, "拟合曲线", teal), label(441, 43, "竖直残差", red)];
  for (let t = 0; t <= 4; t++) {
    const y = lo - margin + (hi - lo + 2 * margin) * t / 4;
    const yy = point(xs[0], y)[1];
    items.push(line([69, yy], [531, yy], "#d0d9da"), label(48, yy + 4, String(Number(y.toFixed(1))), ink, 10));
  }
  xs.forEach((x, i) => {
    const observed = point(x, b[i]), predicted = point(x, fitted[i]);
    items.push(line(observed, predicted, red, true));
    items.push(label(observed[0], 238, String(x), ink, 10));
  });
  for (let j = 1; j < samples.length; j++) items.push(line(point(...samples[j - 1]), point(...samples[j]), teal));
  xs.forEach((x, i) => items.push(dotAt(point(x, b[i]), blue)));
  items.push(label(300, 254, "x", ink, 11));
  return { data: { A, b, coefficients, fitted, residual, normalResidual, residualOrthogonality, r2, degree, noise }, frames: [{
    title: "最小二乘拟合与残差正交",
    summary: "通过正规方程求得 " + degree + " 阶拟合。R² = " + fmt(r2) + "，‖Aᵀe‖∞ = " + fmt(residualOrthogonality)
      + "；残差 e 与设计矩阵的所有列正交。",
    shapes: { viewBox, items }, columns: ["x", "观测 b", "拟合值", "残差 e"],
    rows: xs.map((x, i) => [x, fmt(b[i]), fmt(fitted[i]), fmt(residual[i])]),
  }] };
}
`;

export const la04ProjectionRule = `
function run({ params, upstream }) {
  ${la04Inputs}
  ${la03VectorMath}
  ${la04Design}
  const inverse = transpose(identity(gram.length).map((column) => solve(gram, column)));
  const P = product(product(A, inverse), AT);
  const symmetryError = maxRowSum(matrixMinus(transpose(P), P));
  const idempotenceError = maxRowSum(matrixMinus(product(P, P), P));
  const trace = P.reduce((sum, row, i) => sum + row[i], 0);
  const labels = xs.map((x) => "x = " + x);
  return { data: { A, P, degree, rank: degree + 1, trace, symmetryError, idempotenceError }, frames: [{
    title: "投影矩阵 P 的对称性与幂等性",
    summary: "P = A(AᵀA)⁻¹Aᵀ，与拟合视角共享设计矩阵。矩阵元素红正蓝负；迹 P = " + fmt(trace) + "，等于投影子空间维数。",
    grid: { cells: P, rowLabels: labels, colLabels: labels, palette: "diverging", showValues: true },
    columns: ["核对项", "结果"], rows: [
      ["‖Pᵀ − P‖∞", fmt(symmetryError)], ["‖P² − P‖∞", fmt(idempotenceError)],
      ["tr(P)", fmt(trace)], ["列空间维数", degree + 1],
    ],
  }] };
}
`;

/** 特征谱、线性动力系统和低秩逼近。规则随画布保存，由既有沙箱运行。 */
const la05Inputs = `
  const source = port => upstream.find(v => v.kind === "scalar" && (v.port || "in") === port)?.v;
  const scene = Math.round(Math.max(0, Math.min(3, source("in") ?? params.scene ?? 0)));
  const amount = Math.max(0, Math.min(2, source("aux") ?? params.amount ?? 1));
  const fmt = v => Number(v.toPrecision(5));
`;
const la05Algebra = `
  const dot = (a,b) => a.reduce((sum,x,j) => sum + x*b[j], 0);
  const transpose = A => A[0].map((_,j) => A.map(row => row[j]));
  const product = (A,B) => {
    const columns = transpose(B);
    return A.map(row => columns.map(col => dot(row,col)));
  };
  const apply = (A,v) => A.map(row => dot(row,v));
  const det2 = A => A[0][0]*A[1][1] - A[0][1]*A[1][0];
  const rotation = angle => [[Math.cos(angle),-Math.sin(angle)],[Math.sin(angle),Math.cos(angle)]];
  const norm = v => Math.hypot(...v);
`;
const la05Drawing = `
  const blue = "#2346a0", red = "#b93e2d", green = "#187669", faint = "#c2c7d1", ink = "#26334b";
  const line = (a,b,stroke=faint,dashed=false) =>
    ({kind:"line",x1:a[0],y1:a[1],x2:b[0],y2:b[1],stroke,strokeWidth:1.5,dashed});
  const arrow = (a,b,stroke) => ({
    kind:"arrow",x1:a[0],y1:a[1],x2:b[0],y2:b[1],stroke,strokeWidth:2,
  });
  const point = (p,fill,r=3) => ({kind:"circle",cx:p[0],cy:p[1],fill,r});
  const label = (x,y,text,fill=ink) => ({kind:"text",x,y,text,fill,size:12,anchor:"middle"});
  const axis = (x,y,w,h) => [line([x-w,y],[x+w,y]),line([x,y-h],[x,y+h])];
  const project = (p,x,y,s) => [x+p[0]*s,y-p[1]*s];
  const segments = (points,color,dashed=false) =>
    points.slice(1).map((p,j) => line(points[j],p,color,dashed));
`;

const la05Dynamics = `
  const models = [
    [[1.14 + .13*amount,.23],[0,.66 - .05*amount]],
    rotation(.28 + .3*amount).map(row => row.map(x => x*(.55 + .18*amount))),
    [[1,.35 + .22*amount],[0,1]],
    [[.59 + .09*amount,.27],[.41 - .09*amount,.73]],
  ];
  const A = models[scene];
  const [[a,b],[c,d]] = A;
  const trace = a+d, det = det2(A);
  const rawDiscriminant = (a-d)*(a-d)+4*b*c;
  const discriminant = Math.abs(rawDiscriminant) < 1e-13 ? 0 : rawDiscriminant;
  const isComplex = discriminant < 0;
  const root = Math.sqrt(Math.abs(discriminant))/2;
  const eigenvalues = isComplex ? [[trace/2,root],[trace/2,-root]] : [[trace/2+root,0],[trace/2-root,0]];
  const spectralRadius = Math.max(...eigenvalues.map(norm));
  const scalar = Math.max(Math.abs(b),Math.abs(c),Math.abs(a-d)) < 1e-12;
  const diagonalizable = discriminant !== 0 || scalar;
  const traceError = Math.hypot(eigenvalues[0][0]+eigenvalues[1][0]-trace,eigenvalues[0][1]+eigenvalues[1][1]);
  const detError = Math.hypot(
    eigenvalues[0][0]*eigenvalues[1][0]-eigenvalues[0][1]*eigenvalues[1][1]-det,
    eigenvalues[0][0]*eigenvalues[1][1]+eigenvalues[0][1]*eigenvalues[1][0],
  );
  const dynamics = {trace,det,discriminant,isComplex,spectralRadius,diagonalizable,
    diagonalizableOverReal:diagonalizable && !isComplex,eigenvalues,traceError,detError};
  const orbit = initial => {
    const points = [initial];
    for (let j=1;j<=16;j++) points.push(apply(A,points[j-1]));
    return points;
  };
  const eigenvector = lambda => {
    const u = [-b,a-lambda], v = [d-lambda,-c];
    const best = norm(u) >= norm(v) ? u : v;
    return best.map(x => x/norm(best));
  };
  const directions = isComplex ? [] : scalar ? [[1,0],[0,1]] :
    (discriminant === 0 ? eigenvalues.slice(0,1) : eigenvalues).map(pair => eigenvector(pair[0]));
  const spectrumRows = [["tr A",fmt(trace)],["det A",fmt(det)],["判别式 Δ",fmt(discriminant)],
    ["谱半径 ρ",fmt(spectralRadius)],["特征值和残差",fmt(traceError)],["特征值积残差",fmt(detError)]];
  const eigenLabel = ([re,im]) => im === 0 ? String(fmt(re)) : fmt(re)+" "+(im < 0 ? "− " : "+ ")+fmt(Math.abs(im))+"i";
`;

export const la05EigenRule = `function run({params,upstream}) {
  ${la05Inputs}
  ${la05Algebra}
  ${la05Drawing}
  ${la05Dynamics}
  const items = [...axis(118,136,85,70),...axis(340,136,87,70),
    label(118,42,isComplex ? "实平面 · 旋转轨线" : "实平面 · 不变方向"),
    label(340,42,"复平面 · 特征根")];
  if (isComplex) {
    const spiral = orbit([1,0]).map(p => project(p,118,136,62));
    items.push(...segments(spiral,green),point(spiral[0],blue),point(spiral.at(-1),red));
    items.push(label(118,224,"首点为蓝，末点为朱"));
  } else {
    directions.forEach((v,j) => {
      const color = j === 0 ? blue : red;
      items.push(line(project(v,118,136,63),project(v,118,136,-63),color,true));
      items.push(arrow([118,136],project(v,118,136,43*eigenvalues[j][0]),color));
    });
    items.push(label(118,224,"箭头长度及方向由 λ 决定"));
  }
  const scale = 63 / Math.max(1.55,spectralRadius);
  const roots = eigenvalues.map(p => project(p,340,136,scale));
  if (discriminant === 0) items.push(point(roots[0],blue,5));
  else roots.forEach((p,j) => items.push(point(p,j === 0 ? blue : red,4)));
  items.push(label(340,224,discriminant === 0 ? "重根 λ = "+eigenLabel(eigenvalues[0]) : "两根见下方核对表"));
  const summary = isComplex ? "共轭复根没有实特征直线；在复数域可对角化，实平面呈旋转轨线。"
    : diagonalizable ? "特征方向在 A 作用下保持不变，负特征值会反转箭头。"
    : "代数重数为 2，几何重数为 1，只有一条特征直线；不能相似对角化。";
  return { data: dynamics, frames: [{
    title:"特征直线与复根", summary,
    shapes:{viewBox:[460,252],items},
    columns:["核对项","数值"], rows:[["λ₁",eigenLabel(eigenvalues[0])],["λ₂",eigenLabel(eigenvalues[1])],...spectrumRows],
  }] };
}`;

export const la05PowersRule = `function run({params,upstream}) {
  ${la05Inputs}
  ${la05Algebra}
  ${la05Drawing}
  ${la05Dynamics}
  const points = orbit([.42,.76]);
  const scale = 73 / Math.max(1.1,...points.map(norm));
  const projected = points.map(p => project(p,230,137,scale));
  const behavior = spectralRadius < 1-1e-10 ? "谱半径小于 1，所有初值衰减"
    : spectralRadius > 1+1e-10 ? "谱半径大于 1，含主特征分量的初值增长"
    : diagonalizable ? "谱半径等于 1，主模态保留" : "谱半径等于 1，但 Jordan 剪切可导致线性增长";
  const frames = points.map((p,k) => ({
    title:"第 "+k+" 次迭代", summary:behavior+"；‖xₖ‖₂ = "+fmt(norm(p))+"。所有帧共用比例尺。",
    shapes:{viewBox:[460,252],items:[...axis(230,137,166,75),
      label(230,42,"xₖ = Aᵏx₀"),
      ...segments(projected, faint,true),...segments(projected.slice(0,k+1),green),
      point(projected[0],blue),point(projected[k],red,5),
      label(230,220,"xₖ = ("+fmt(p[0])+", "+fmt(p[1])+")")]},
    columns:["k","x₁","x₂","‖xₖ‖₂"],
    rows:points.slice(0,k+1).map((value,i) => [i,fmt(value[0]),fmt(value[1]),fmt(norm(value))]),
    highlightRows:[k],
  }));
  return {data:{...dynamics,trajectory:points},frames};
}`;

export const la05MarkovRule = String.raw`function run({text,params,upstream}) {
  ${la05Inputs}
  ${la05Algebra}
  const defaults = [
    [[.40,.20,.25],[.45,.65,.25],[.15,.15,.50]],
    [[.35,.20,.50],[.40,.55,.20],[.25,.25,.30]],
    [[.75,.10,.10],[.15,.78,.16],[.10,.12,.74]],
    [[.62,.20,.15],[.24,.65,.25],[.14,.15,.60]],
  ];
  const raw = (text || "").trim();
  const draft = raw ? raw.split(/[;\r\n]+/).map(row => row.trim().split(/[\s,，]+/).map(Number)) : defaults[scene];
  const valid = draft.length === 3
    && draft.every(row => row.length === 3 && row.every(v => Number.isFinite(v) && v >= 0))
    && [0,1,2].every(j => draft.some(row => row[j] > 0));
  const supplied = valid ? draft : defaults[scene];
  const B = supplied.map(row => row.slice());
  for (let j=0;j<3;j++) {
    const max = Math.max(...B.map(row => row[j]));
    const sum = B.reduce((total,row) => total+row[j]/max,0);
    B.forEach(row => row[j] = (row[j]/max)/sum);
  }
  const fast = product(B,B);
  const mix = amount <= 1 ? .35+.65*amount : .6*(amount-1);
  const P = B.map((row,i) => row.map((v,j) => amount <= 1 ? mix*v+(i === j ? 1-mix : 0) : (1-mix)*v+mix*fast[i][j]));
  // Replace one dependent balance equation with total mass 1, then solve by partial pivoting.
  const system = [
    P[0].map((v,j) => v-(j === 0 ? 1 : 0)).concat(0),
    P[1].map((v,j) => v-(j === 1 ? 1 : 0)).concat(0),
    [1,1,1,1],
  ];
  let stationary = null;
  for (let j=0;j<3;j++) {
    let pivot = j;
    for (let i=j+1;i<3;i++) if (Math.abs(system[i][j]) > Math.abs(system[pivot][j])) pivot = i;
    if (Math.abs(system[pivot][j]) < 1e-12) break;
    [system[j],system[pivot]] = [system[pivot],system[j]];
    const divisor = system[j][j];
    system[j] = system[j].map(v => v/divisor);
    for (let i=0;i<3;i++) {
      if (i === j) continue;
      const multiplier = system[i][j];
      system[i] = system[i].map((v,k) => v-multiplier*system[j][k]);
    }
    if (j === 2) stationary = system.map(row => Math.max(0,row[3]));
  }
  const trajectory = [[.80,.15,.05]];
  for (let k=1;k<=32;k++) trajectory.push(apply(P, trajectory[k-1]));
  const observed = trajectory.at(-1);
  const stationaryError = stationary ? Math.max(...apply(P,stationary).map((v,j) => Math.abs(v-stationary[j]))) : null;
  const endpointError = stationary ? Math.max(...observed.map((v,j) => Math.abs(v-stationary[j]))) : null;
  const notice = valid ? "" : "输入未组成非负且各列非零的 3×3 矩阵，已显示本情景的矩阵。";
  const summary = notice + (stationary
    ? "π 由 (P−I)π=0、Σπ=1 解出；第 32 步距 π 的最大偏差为 "+fmt(endpointError)+"。"
    : "稳态分布不唯一；曲线显示从指定初值开始的迭代，并不假定必然收敛。");
  const states = ["状态 1","状态 2","状态 3"];
  return {data:{P,trajectory,stationary,stationaryError,endpointError,valid},frames:[{
    title:"列随机转移与稳态分布", summary,
    series:states.map((label,j) => ({label,values:trajectory.map(value => 100*value[j])})),
    grid:{cells:P,rowLabels:states,colLabels:states,min:0,max:1,showValues:true},
    columns:["状态","第 0 步 / %","第 32 步 / %","稳态 π / %","转移矩阵 P（按行）"],
    rows:states.map((s,j) => [s,fmt(100*trajectory[0][j]),fmt(100*observed[j]),
      stationary ? fmt(100*stationary[j]) : "非唯一",P[j].map(fmt).join("，")]),
  }]};
}`;

const la06Jacobi = `
  // 对称 2×2 矩阵只需一次 Jacobi 旋转，V 的列是按特征值降序排列的单位向量。
  const jacobi = S => {
    const angle = Math.atan2(2*S[0][1],S[0][0]-S[1][1])/2;
    const V = rotation(angle);
    const basis = transpose(V);
    const values = basis.map(v => dot(v,apply(S,v)));
    return {angle,V,basis,values};
  };
`;
const la06Symmetric = `
  const skinnyAngle = .38 + .15*amount;
  const skinny = rotation(skinnyAngle);
  const pair = product(product(skinny,[[2.5,0],[0,.011*amount]]),transpose(skinny));
  const symmetricModels = [
    [[2,.24+.35*amount],[.24+.35*amount,1.25]],
    [[amount-.55,.15],[.15,amount-1.55]],
    pair,
    [[1.3,.52+.28*amount],[.52+.28*amount,1.25]],
  ];
`;

export const la06QuadraticRule = `function run({params,upstream}) {
  ${la05Inputs}
  ${la05Algebra}
  ${la06Jacobi}
  ${la06Symmetric}
  const A = symmetricModels[scene];
  const delta1 = A[0][0], delta2 = det2(A);
  const tolerance = 1e-10;
  const [lambda1,lambda2] = jacobi(A).values.map(v => Math.abs(v) <= tolerance ? 0 : v);
  const definiteness = lambda2 > 0 ? "positive-definite" : lambda1 < 0 ? "negative-definite"
    : lambda1 > 0 && lambda2 < 0 ? "indefinite" : lambda1 > 0 ? "positive-semidefinite"
    : lambda2 < 0 ? "negative-semidefinite" : "zero";
  const labels = {"positive-definite":"正定 · 椭圆", "negative-definite":"负定 · 等高线为椭圆",
    indefinite:"不定 · 马鞍面", "positive-semidefinite":"半正定 · 有零方向",
    "negative-semidefinite":"半负定 · 有零方向", zero:"零二次型"};
  const xAxis = Array.from({length:17},(_,i) => (i-8)/4), yAxis = xAxis.slice().reverse();
  const cells = yAxis.map(y => xAxis.map(x => dot([x,y],apply(A,[x,y]))));
  const maxAbs = Math.max(.01,...cells.flat().map(Math.abs));
  return {data:{A,definiteness,lambda1,lambda2,delta1,delta2},frames:[{
    title:"二次型 f(x,y) = xᵀAx",summary:labels[definiteness]+"。热图红正蓝负；主子式与特征值共同核对定性。",
    grid:{cells,rowLabels:yAxis.map(String),colLabels:xAxis.map(String),palette:"diverging",min:-maxAbs,max:maxAbs,
      showValues:false,activeCell:[8,8]},
    columns:["核对项","值"],rows:[["Δ₁ = a",fmt(delta1)],["Δ₂ = ac−b²",fmt(delta2)],["λ₁",fmt(lambda1)],["λ₂",fmt(lambda2)],
      ["定性",labels[definiteness]]],
  }]};
}`;

export const la06SvdRule = `function run({params,upstream}) {
  ${la05Inputs}
  ${la05Algebra}
  ${la05Drawing}
  ${la06Jacobi}
  ${la06Symmetric}
  const models = [
    symmetricModels[0],
    [[.2+.32*amount,1.05],[.96,-.35]],
    symmetricModels[2],
    [[1.22,.35+.35*amount],[.19,.4]],
  ];
  const A = models[scene], determinant = det2(A);
  const {angle,V,basis} = jacobi(product(transpose(A),A));
  const Av1 = apply(A,basis[0]);
  const sigma1 = norm(Av1);
  const sigma2 = sigma1 ? Math.abs(determinant)/sigma1 : 0;
  const u1 = sigma1 ? Av1.map(v => v/sigma1) : [1,0];
  const handedness = determinant < 0 ? -1 : 1;
  const U = [[u1[0],-u1[1]*handedness],[u1[1],u1[0]*handedness]];
  const sigma = [[sigma1,0],[0,sigma2]];
  const Vt = transpose(V);
  const reconstructed = product(product(U,sigma),Vt);
  const reconstructionError = Math.max(...A.map((row,i) => row.reduce((sum,v,j) => sum+Math.abs(v-reconstructed[i][j]),0)));
  const determinantError = Math.abs(det2(reconstructed)-determinant);
  const conditionNumber = sigma2 > 1e-12 ? sigma1/sigma2 : null;
  const spine = Array.from({length:33},(_,j) => {
    const theta = Math.PI*2*j/32; return [Math.cos(theta),Math.sin(theta)];
  });
  const scale = 75/Math.max(1,sigma1), origin = [230,137];
  const projectPoint = p => project(p,origin[0],origin[1],scale);
  const ghostCircle = segments(spine.map(projectPoint),faint,true);
  const turnU = Math.atan2(u1[1],u1[0]);
  const stageNames = ["① Vᵀ · 转到右奇异向量坐标","② Σ · 沿主轴拉伸","③ U · 进入像空间"];
  const frames = Array.from({length:37},(_,i) => {
    const phase = Math.min(2,Math.floor(i/12));
    const t = (i-12*phase)/12;
    let transform;
    if (phase === 0) transform = rotation(-angle*t);
    else if (phase === 1) transform = product([[1+t*(sigma1-1),0],[0,1+t*(sigma2-1)]],Vt);
    else {
      const partialU = product(rotation(turnU*t),[[1,0],[0,1+t*(handedness-1)]]);
      transform = product(product(partialU,sigma),Vt);
    }
    const map = p => projectPoint(apply(transform,p));
    const points = spine.slice(0,-1).map(map);
    const basisTips = [[1,0],[0,1]].map(map);
    const items = [...axis(origin[0],origin[1],164,80),...ghostCircle,
      {kind:"polygon",points,stroke:green,strokeWidth:2,fill:"#b6e3df",opacity:.85},
      label(230,42,stageNames[phase]),label(230,220,"虚线：单位圆　实线：当前像")];
    basisTips.forEach((tip,j) => {
      const stroke = j === 0 ? blue : red;
      if (norm(tip.map((v,k) => v-origin[k])) > 1) items.push(arrow(origin,tip,stroke));
    });
    const summary = phase === 2 && handedness < 0 ? "U 含镜像，垂直分量穿过零后反向，再到达最终像。" :
      "按 Vᵀ → Σ → U 的顺序演化。三个阶段共用比例尺。";
    return { title: stageNames[phase], summary,
      shapes:{viewBox:[460,252],items}, columns:["核对项","数值"],
      rows:[["σ₁",fmt(sigma1)],["σ₂",fmt(sigma2)],["‖UΣVᵀ−A‖∞",fmt(reconstructionError)],
        ["条件数",conditionNumber === null ? "奇异 · ∞" : fmt(conditionNumber)]] };
  });
  return {data:{A,sigma1,sigma2,U,Vt,reconstructionError,determinantError,conditionNumber},frames};
}`;

export const la06PcaRule = `function run({params,upstream}) {
  ${la05Inputs}
  ${la05Algebra}
  ${la05Drawing}
  ${la06Jacobi}
  const k = Math.round(Math.max(0,Math.min(2,params.k ?? 1)));
  const angle = [-.26,.36,1.05,.67][scene] + .2*(amount-1);
  const minorScale = [.64,.77,.12,.21][scene] * (.55+.45*amount);
  const R = rotation(angle);
  const cloud = Array.from({length:28},(_,i) => {
    const theta = 2*Math.PI*i/28;
    const x = 1.43*Math.cos(theta)+.38*Math.cos(3*theta);
    const y = minorScale*(Math.sin(2*theta)+.37*Math.sin(5*theta));
    const v = apply(R,[x,y]);
    return [v[0]+.25,v[1]-.18];
  });
  const count = cloud.length;
  const mean = transpose(cloud).map(col => col.reduce((sum,v) => sum+v,0)/count);
  const centered = cloud.map(p => p.map((v,j) => v-mean[j]));
  const C = product(transpose(centered),centered).map(row => row.map(v => v/(count-1)));
  const {basis,values} = jacobi(C);
  const energy = values.map(v => Math.max(0,v)*(count-1));
  const sigma = energy.map(Math.sqrt);
  const total = energy[0]+energy[1];
  const explainedVariance = energy.slice(0,k).reduce((sum,v) => sum+v,0)/total;
  const reconstructed = centered.map(p => {
    const scores = basis.slice(0,k).map(v => dot(v,p));
    return mean.map((value,j) => scores.reduce((sum,score,i) => sum+score*basis[i][j],value));
  });
  const reconstructionError = Math.sqrt(cloud.reduce((sum,p,i) =>
    sum + p.reduce((row,v,j) => row+(v-reconstructed[i][j])**2,0),0));
  const scale = 66 / Math.max(1,...centered.map(norm));
  const relative = p => p.map((value,j) => value-mean[j]);
  const original = cloud.map(p => project(relative(p),118,137,scale));
  const reduced = reconstructed.map(p => project(relative(p),342,137,scale));
  const items = [...axis(118,137,85,72),...axis(342,137,85,72),
    label(118,42,"原始点云"),label(342,42,"保留 "+k+" 个主成分"),
    label(118,220,"坐标轴交点为样本均值"),label(342,220,"累计方差 "+fmt(100*explainedVariance)+"%")];
  basis.forEach((v,j) => {
    const color = j === 0 ? green : red;
    items.push(line(project(v,118,137,-68),project(v,118,137,68),color,true));
    if (j < k) items.push(line(project(v,342,137,-68),project(v,342,137,68),color,true));
  });
  original.forEach(p => items.push(point(p,blue)));
  reduced.forEach(p => items.push(point(p,green,k === 0 ? 4 : 3)));
  return {data:{k,explainedVariance,reconstructionError,sigma,relativeError:reconstructionError/Math.sqrt(total)},frames:[{
    title:"PCA 主成分和低秩重构", summary:"对居中样本求协方差特征向量，保留前 k 项后加回均值；方差占比为保留奇异值的平方和与总平方和之比。",
    shapes:{viewBox:[460,252],items},
    series:[{label:"奇异值 σ",values:sigma},{label:"累计能量比例",values:[energy[0]/total,1]}],
    columns:["项目","数值"],rows:[["σ₁",fmt(sigma[0])],["σ₂",fmt(sigma[1])],
      ["λ₁ / (λ₁+λ₂)",fmt(energy[0]/total)],["保留方差",fmt(100*explainedVariance)+"%"],
      ["重构误差 ‖X−Xₖ‖F",fmt(reconstructionError)]],
  }]};
}`;
