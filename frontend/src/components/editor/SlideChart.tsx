import type {ChartData,DeckTheme} from '@/document/types';

export function SlideChart({data,theme}:{data:ChartData;theme?:DeckTheme}) {
  const palette=theme?.palette;
  const colors=[palette?.primary??'#3159ae',palette?.accent??'#b8431f',palette?.secondary??'#087b6d',
    '#7760a1','#b18739','#408b8d'];
  const color=(i:number)=>colors[i%colors.length]!;
  const title=data.title??'数据图表';
  const width=400,height=240,left=60,right=376,top=36,bottom=190;
  const categories=data.categories;
  const series=data.series;
  const indexWidth=(right-left)/Math.max(1,categories.length);
  const values=series.flatMap(item=>item.values);
  const min=Math.min(0,...values),max=Math.max(0,...values);
  const y=(value:number)=>bottom-(value-min)/(max-min||1)*(bottom-top);
  const x=(index:number)=>left+(index+.5)*indexWidth;
  const kind=data.chart_type??'COLUMN_CLUSTERED';
  const pie=kind==='PIE'||kind==='DOUGHNUT';
  const horizontal=kind==='BAR_CLUSTERED';
  const area=kind==='AREA',line=kind==='LINE'||area;
  const pieValues=categories.map((_,index)=>Math.max(0,series[0]?.values[index]??0));
  const total=pieValues.reduce((sum,value)=>sum+value,0);
  let running=0;
  const horizontalX=(value:number)=>left+(value-min)/(max-min||1)*(right-left);
  const band=(bottom-top)/Math.max(1,categories.length);
  return <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" role="img" aria-label={title}>
    <rect width={width} height={height} fill={palette?.surface??'#ffffff'}/>
    <text x={width/2} y={20} textAnchor="middle" fontSize={14} fill={palette?.text??'#263044'}>{title}</text>
    {pie?<>
      {pieValues.map((value,index)=>{
        if(!value||!total)return null;
        const arc=value/total*2*Math.PI,start=running-Math.PI/2;
        running+=arc;
        const point=(angle:number)=>[125+72*Math.cos(angle),117+72*Math.sin(angle)].join(' ');
        return arc>=2*Math.PI?<circle key={index} cx={125} cy={117} r={72} fill={color(index)}/>:
          <path key={index} d={`M 125 117 L ${point(start)} A 72 72 0 ${arc>Math.PI?1:0} 1 ${point(start+arc)} Z`}
            fill={color(index)}><title>{categories[index]} {value}</title></path>;
      })}
      {kind==='DOUGHNUT'&&total>0&&<circle cx={125} cy={117} r={32} fill={palette?.surface??'#fff'}/>}
      {categories.slice(0,9).map((label,index)=><g key={index} transform={`translate(228 ${50+20*index})`}>
        <rect width={9} height={9} fill={color(index)}/><text x={15} y={9} fontSize={11} fill={palette?.text}>{label.slice(0,16)}</text>
      </g>)}
    </>:<>
      <path d={`M${left},${top}V${bottom}H${right}`} fill="none" stroke={palette?.border??'#c5ccda'}/>
      {horizontal?categories.map((label,i)=><text key={i} x={left-6} y={top+(i+.6)*band}
        textAnchor="end" fontSize={10} fill={palette?.text}>{label.slice(0,8)}</text>):
        categories.map((label,i)=><text key={i} x={x(i)} y={bottom+16} textAnchor="middle" fontSize={10}
          fill={palette?.text}>{label.slice(0,10)}</text>)}
      {series.map((item,k)=>{
        const points=categories.map((_,i)=>`${x(i)},${y(item.values[i]??0)}`).join(' ');
        if(line)return <g key={k}>
          {area&&categories.length>0&&<polygon points={`${x(0)},${y(0)} ${points} ${x(categories.length-1)},${y(0)}`}
            fill={color(k)} fillOpacity={.24}/>}
          <polyline points={points} fill="none" stroke={color(k)} strokeWidth={2}/>
          {categories.map((label,i)=><circle key={i} cx={x(i)} cy={y(item.values[i]??0)} r={2} fill={color(k)}>
            <title>{label} {item.values[i]??0}</title></circle>)}
        </g>;
        return <g key={k}>{categories.map((label,i)=>{
          const value=item.values[i]??0;
          const size=(horizontal?band:indexWidth)*.72/Math.max(1,series.length);
          return <rect key={i} x={horizontal?Math.min(horizontalX(value),horizontalX(0)):left+i*indexWidth+indexWidth*.14+k*size}
            y={horizontal?top+i*band+band*.14+k*size:Math.min(y(value),y(0))}
            width={horizontal?Math.abs(horizontalX(value)-horizontalX(0)):size}
            height={horizontal?size:Math.abs(y(value)-y(0))} fill={color(k)}><title>{label} {value}</title></rect>;
        })}</g>;
      })}
      {series.slice(0,4).map((item,i)=><g key={i} transform={`translate(${left+i*82} 221)`}>
        <rect width={9} height={9} fill={color(i)}/><text x={13} y={9} fontSize={10} fill={palette?.text}>{item.name.slice(0,10)}</text>
      </g>)}
    </>}
  </svg>;
}
