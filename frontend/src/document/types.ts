import type {SceneShape} from './shapeCatalog';

export interface TextStyle {
  line_style?: 'solid'|'dashed'|'dotted'; arrow_start?: boolean; arrow_end?: boolean;
  anim_step?: number; bind_mode?: 'none'|'scale'|'rotate';
  font_size:number;font_family:string;color:string;bold?:boolean;italic?:boolean;underline?:boolean;letter_spacing?:number;
  align?:'left'|'center'|'right'|'justify';vertical_align?:'top'|'middle'|'bottom';line_height?:number;
  padding_left?:number;padding_right?:number;padding_top?:number;padding_bottom?:number;
  fill?:string;stroke?:string;stroke_width?:number;
  baseline?:number;highlight?:string;
}
export interface SceneParagraph {
  text:string;align?:TextStyle['align'];line_height?:number;line_spacing_pt?:number;space_before?:number;space_after?:number;
  bullet?:boolean;runs:Array<{text:string;style:Partial<TextStyle>}>;
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
export interface BasisOverlay {
  firstId: string; secondId: string; resultId: string; title: [number, number]; fontSize: number;
}
export type FigureProvenance='native'|'pixel'|'vision'|'user_confirmed';
export type RelationProvenance='auto'|'user'|'legacy';
export type ViewerParameter='geometry'|'style'|'flow'|'start'|'end'|'length'|'angle'|'color'|'line_style'|'stroke_width';
export type RelationSourceProperty='x1'|'y1'|'x2'|'y2'|'dx'|'dy'|'length'|'angle'|'x'|'y'|'width'|'height'|'rotation'|'opacity';
export type RelationTargetProperty='length'|'angle'|'x'|'y'|'width'|'height'|'rotation'|'opacity'|'text'|'x1'|'y1'|'x2'|'y2';
export type GuideAnchor='start'|'end'|'center';
export interface ExprBindingSource {nodeId:string;property:RelationSourceProperty;}
export interface BasisDecomposeRelation {
  id:string;kind:'basis_decompose';name?:string;enabled?:boolean;provenance?:RelationProvenance;
  firstId:string;secondId:string;resultId:string;
  guideIds?:string[];labelId?:string;labelTemplate?:string;degenerateText?:string;
  title?:[number,number];fontSize?:number;
}
export interface LinearComboRelation {
  id:string;kind:'linear_combo';name?:string;enabled?:boolean;provenance?:RelationProvenance;
  firstId:string;secondId:string;targetId:string;
  a:number|string;b:number|string;guideIds?:string[];
}
export interface GuideBindRelation {
  id:string;kind:'guide_bind';name?:string;enabled?:boolean;provenance?:RelationProvenance;
  targetId:string;
  from:{nodeId:string;anchor:GuideAnchor};
  to:{nodeId:string;anchor:GuideAnchor};
}
export interface ExprRelation {
  id:string;kind:'expr';name?:string;enabled?:boolean;provenance?:RelationProvenance;
  targetId:string;targetProperty:RelationTargetProperty;expression:string;
  bindings?:Record<string,ExprBindingSource>;formatTemplate?:string;precision?:number;
}
export type SceneRelation=BasisDecomposeRelation|LinearComboRelation|GuideBindRelation|ExprRelation;
export interface RelationViewerUpdate {
  nodeId:string;
  viewer_editable?:boolean;
  viewer_parameters?:ViewerParameter[];
}
export interface RelationSuggestion {
  summary:string;
  relations:SceneRelation[];
  viewer_updates:RelationViewerUpdate[];
  warnings:string[];
  source_revision:number;
  diagnostics?:{elapsed_ms:number;attempts:number;cache_hit:boolean};
}
export interface FigureScene {
  version:1;
  frame:{width:number;height:number};
  systems:Array<{id:string;origin_px:[number,number];unit_px:number}>;
  objects:Array<{
    id:string;type:'axis'|'segment'|'vector'|'polyline'|'dashed'|'text';points:Array<[number,number]>;
    system_id:string|null;text:string|null;style:{stroke:string;width:number};provenance:FigureProvenance;
    evidence:string[];confidence:number|null;bbox:[number,number,number,number]|null;label_id:string|null;
    role?:'basis_vector'|'result_vector'|'coordinate_axis'|'guide'|'coordinate_label'|null;
  }>;
  warnings:string[];
  relations:Array<{kind:string;objects:string[]}>;
}
export interface FigureVectorization {
  preview_id:string;
  source_node_id:string;
  source_revision:number;
  scene:FigureScene;
  nodes:SceneNode[];
  relations?:SceneRelation[];
  cleaned_asset_id:string|null;
  cleaned_url:string|null;
  source_url?:string|null;
  vision_available:boolean;
  diagnostics?:{elapsed_ms:number;cache_hit:boolean;warnings?:string[];vision_status?:'applied'|'skipped'|'failed'};
}
export interface WorkshopPluginPreset {
  id: string;
  label: string;
  params: Record<string, number>;
  cursor?: number;
}
export interface WorkshopPluginConfig {
  template_kind: string;
  title: string;
  category?: string;
  work_id?: string;
  doc?: import('../canvas/types').CanvasDoc;
  display_mode?: 'full' | 'compact' | 'stage_only';
  transparent_bg?: boolean;
  hide_border?: boolean;
  theme?: 'auto' | 'light' | 'dark';
  visible_params?: string[];
  presets?: WorkshopPluginPreset[];
  preview_data?: string;
}
export interface SceneNode {
  diagram?: import('../living/diagram').DiagramDoc;
  demo?: import('../ppt-ai/pageLabTypes').PageLab|null;
  workshop_plugin?: WorkshopPluginConfig | null;
  flow?: {enabled: boolean; speed: number};
  viewer_editable?: boolean;
  viewer_parameters?: ViewerParameter[];
  basis?: BasisOverlay | null;
  id:string;name:string;type:'text'|'image'|'shape'|'chart'|'table'|'vector'|'diagram'|'demo'|'workshop_plugin';x:number;y:number;width:number;height:number;
  rotation:number;z:number;opacity:number;locked:boolean;hidden:boolean;deleted:boolean;text:string;
  style:TextStyle;base_style:TextStyle;base_text:string|null;base_x?:number;base_y?:number;base_width?:number;base_height?:number;
  source_element_id?:string|null;source_shape_id?:number|null;whole_group?:boolean;content_changed?:boolean;
  paragraphs?:SceneParagraph[];base_paragraphs?:SceneParagraph[];rich_text_edited?:boolean;
  image_url?:string|null;background_url?:string|null;image_data?:string;asset_id?:string|null;background_asset_id?:string|null;
  cleaned_asset_id?:string|null;cleaned_url?:string|null;figure_scene?:FigureScene|null;
  figure_source_id?:string;figure_object_id?:string;figure_provenance?:FigureProvenance;text_transform?:[number,number,number,number];
  image_frame?:[number,number];image_scale?:number;image_size?:[number,number];
  background_frame?:[number,number];background_scale?:number;background_size?:[number,number];word_wrap?:boolean;
  shape?:SceneShape;duplicate_from?:string;table?:string[][];base_table?:string[][];chart?:ChartData|null;base_chart?:ChartData|null;
  shape_paths?:Array<{width:number;height:number;path:string;fill:boolean;stroke:boolean}>;
  style_modified?:string[];crop?:{left:number;right:number;top:number;bottom:number};interaction?:NodeInteraction|null;
}
export interface ScenePage {
  page_no:number;id?:string;width:number;height:number;nodes:SceneNode[];modified?:boolean;auto_vectors?:boolean;background_url?:string;
  source_page_no?:number|null;copy_from_page_no?:number;notes?:string;background_color?:string|null;background_modified?:boolean;native_fallback?:boolean;
  figure_scenes?:Record<string,FigureScene>;
  relations?:SceneRelation[];
  preparation?:{status:'unprepared'|'queued'|'preparing'|'ready'|'failed';fallback_status?:'unprepared'|'queued'|'preparing'|'ready'|'failed'|'unavailable';message?:string;errors?:string[];frozen_ids?:string[];seconds?:number};
}
export interface SceneDocument {schema_version:string;revision:number;title:string;source_key?:string;pages:ScenePage[];archived_pages?:ScenePage[];structure_modified?:boolean;}
export type NodePatch=Partial<Pick<SceneNode,'x'|'y'|'width'|'height'|'rotation'|'z'|'opacity'|'locked'|'hidden'|'deleted'|'text'|'paragraphs'|'table'|'chart'|'crop'|'interaction'|'basis'|'flow'|'viewer_editable'|'viewer_parameters'|'diagram'|'demo'|'workshop_plugin'|'cleaned_asset_id'|'figure_scene'>> & {style?:Partial<TextStyle>};
export type PageMetadata=Pick<ScenePage,'notes'|'background_color'>;
export type PageAction=
  | {kind:'add_page';width:number;height:number}
  | {kind:'duplicate_page';from:number}
  | {kind:'delete_page'|'restore_page'}
  | {kind:'reorder_pages';order:number[]}
  | {kind:'page_metadata';patch:PageMetadata&{background_modified?:boolean}};
export interface NodeChange {page_no:number;id:string;patch?:NodePatch;create?:Record<string,unknown>;relations?:SceneRelation[];page_action?:PageAction;}
