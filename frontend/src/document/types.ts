export interface TextStyle {
  font_size:number;font_family:string;color:string;bold?:boolean;italic?:boolean;underline?:boolean;letter_spacing?:number;
  align?:'left'|'center'|'right'|'justify';vertical_align?:'top'|'middle'|'bottom';line_height?:number;
  padding_left?:number;padding_right?:number;padding_top?:number;padding_bottom?:number;
  fill?:string;stroke?:string;stroke_width?:number;
}
export interface ChartData {categories:string[];series:Array<{name:string;values:number[]}>;title?:string;chart_type?:string;}
export type InteractionTemplate='grid_transform'|'circle_ellipse'|'vectors'|'eigen_probe'|'inverse_map'|'det_area'|'basis_change';
export interface NodeInteraction {
  kind:'formula'|'matrix'|'figure'|'chart';
  title?:string;
  formula?:string;
  defaults?:Record<string,number>;
  allowed?:string[];
  ranges?:Record<string,{min?:number;max?:number;step?:number}>;
  matrix?:number[][];
  vector?:number[];
  template?:InteractionTemplate;
  categories?:string[];
  series?:Array<{name:string;values:number[]}>;
  status?:'active'|'paused';
  reason?:string;
  source?:'user'|'auto';
}
export interface SceneNode {
  id:string;name:string;type:'text'|'image'|'shape'|'chart'|'table';x:number;y:number;width:number;height:number;
  rotation:number;z:number;opacity:number;locked:boolean;hidden:boolean;deleted:boolean;text:string;
  style:TextStyle;base_style:TextStyle;base_text:string|null;base_x?:number;base_y?:number;base_width?:number;base_height?:number;
  source_element_id?:string|null;source_shape_id?:number|null;whole_group?:boolean;content_changed?:boolean;
  paragraphs?:Array<{text:string;align?:TextStyle['align'];line_height?:number;line_spacing_pt?:number;space_before?:number;space_after?:number;runs:Array<{text:string;style:Partial<TextStyle>}>}>;
  image_url?:string|null;background_url?:string|null;image_data?:string;asset_id?:string|null;background_asset_id?:string|null;
  image_frame?:[number,number];image_scale?:number;image_size?:[number,number];
  background_frame?:[number,number];background_scale?:number;background_size?:[number,number];word_wrap?:boolean;
  shape?:'rect'|'ellipse';duplicate_from?:string;table?:string[][];base_table?:string[][];chart?:ChartData|null;base_chart?:ChartData|null;
  style_modified?:string[];crop?:{left:number;right:number;top:number;bottom:number};interaction?:NodeInteraction|null;
}
export interface ScenePage {
  page_no:number;id?:string;width:number;height:number;nodes:SceneNode[];modified?:boolean;background_url?:string;
  preparation?:{status:'unprepared'|'queued'|'preparing'|'ready'|'failed';message?:string;errors?:string[];frozen_ids?:string[];seconds?:number};
}
export interface SceneDocument {schema_version:string;revision:number;title:string;source_key?:string;pages:ScenePage[];}
export type NodePatch=Partial<Pick<SceneNode,'x'|'y'|'width'|'height'|'rotation'|'z'|'opacity'|'locked'|'hidden'|'deleted'|'text'|'table'|'chart'|'crop'|'interaction'>> & {style?:Partial<TextStyle>};
export interface NodeChange {page_no:number;id:string;patch?:NodePatch;create?:Record<string,unknown>;}
