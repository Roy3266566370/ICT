import type {DeckTheme} from './types';

export const THEMES = [
  ['academic-paper','象牙学术','#FAF7EE','#233A63','#A44929','#263044', '#FFFCF5', '#526EA1', '#69717D', '#DED7C8'],
  ['midnight-tech','深海科技','#151B36','#83E8EA','#FFC267','#F0F4FF', '#202A49', '#A89CF4', '#ABB8D1', '#394765'],
  ['minimal-ink','清墨极简','#FFFFFF','#252A35','#345ADD','#343C4A', '#F4F6F9', '#737D93', '#697384', '#D9DEE6'],
  ['warm-chalk','学院黑板','#193831','#F7EED5','#F2C96F','#F5F2E6', '#24473E', '#86BEAD', '#B7C7BB', '#47665B'],
  ['executive-slate','商务青蓝','#EDF2F6','#243A55','#087D72','#26364A', '#F9FBFD', '#55769F', '#5F7082', '#CDD8E2'],
  ['editorial-sand','燕麦人文','#F5EADD','#74442E','#3E6354','#352F30', '#FFF7ED', '#A16C46', '#72645C', '#DDCCBB'],
] as const;

export function presetTheme(id:string, aspect_ratio:DeckTheme['aspect_ratio']):DeckTheme|undefined {
  const item=THEMES.find(theme=>theme[0]===id);
  if(!item)return;
  const [,name,background,primary,accent,text,surface,secondary,muted,border]=item;
  return {id,name,aspect_ratio,palette:{background,surface,primary,secondary,accent,text,muted,border},fonts:{heading:'Arial',body:'Arial'}};
}
