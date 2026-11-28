import type {DeckTheme} from '@/document/types';

export function MasterLayer({theme,index,total}:{theme:DeckTheme;index:number;total:number}) {
  const master=theme.master;
  if(!master)return null;
  const label={position:'absolute',fontSize:13,color:theme.palette.muted,fontFamily:theme.fonts.body} as const;
  const bar=master.accent_bar;
  return <div aria-hidden="true" style={{position:'absolute',inset:0,pointerEvents:'none'}}>
    {bar&&bar!=='none'&&<span style={{position:'absolute',background:theme.palette.accent,
      ...(bar==='left'?{left:0,top:0,bottom:0,width:5}:{
        left:0,right:0,height:5,[bar]:0,
      })}}/>}
    {master.header_text&&<span style={{...label,left:24,top:14}}>{master.header_text}</span>}
    {master.footer_text&&<span style={{...label,left:24,bottom:14}}>{master.footer_text}</span>}
    {master.show_page_number&&<span style={{...label,right:24,bottom:14}}>{index} / {total}</span>}
  </div>;
}
