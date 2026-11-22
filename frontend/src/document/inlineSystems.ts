import type {DiagramDoc} from '../living/diagram';

export function defaultDiagram():DiagramDoc {
  return {version:1,nodes:[
    {id:'input',label:'输入',x:.14,y:.5,shape:'rounded'},
    {id:'transform',label:'处理 / 变换',x:.5,y:.5,shape:'rect'},
    {id:'output',label:'输出',x:.86,y:.5,shape:'rounded'},
  ],edges:[{from:'input',to:'transform',label:''},{from:'transform',to:'output',label:''}],
    order:['input','transform','output'],confidence:1,warnings:[]};
}
