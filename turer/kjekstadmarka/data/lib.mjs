import fs from 'fs';
const data=JSON.parse(fs.readFileSync('osm.json','utf8'));
const els=data.elements; export const nodes=new Map();
for(const e of els)if(e.type==='node')nodes.set(e.id,e);
const R=6371000,rad=Math.PI/180;
export function hav(a,b){const dlat=(b.lat-a.lat)*rad,dlon=(b.lon-a.lon)*rad,la1=a.lat*rad,la2=b.lat*rad;
  const h=Math.sin(dlat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dlon/2)**2;return 2*R*Math.asin(Math.sqrt(h));}
const adj=new Map();const addE=(a,b,w)=>{if(!adj.has(a))adj.set(a,[]);adj.get(a).push({to:b,w});};
const pen=hw=>({tertiary:1.5,residential:1.15,service:1.1}[hw]||1.0);
for(const e of els){if(e.type!=='way'||!e.tags||!e.tags.highway)continue;const hw=e.tags.highway;
  if(['motorway','trunk','primary','secondary'].includes(hw))continue;const p=pen(hw);
  for(let i=0;i+1<e.nodes.length;i++){const a=nodes.get(e.nodes[i]),b=nodes.get(e.nodes[i+1]);if(!a||!b)continue;
    const len=hav(a,b);addE(a.id,b.id,len*p);addE(b.id,a.id,len*p);}}
const comp=new Map();let cid=0;const sizes=[];
for(const s of adj.keys()){if(comp.has(s))continue;let sz=0;const q=[s];comp.set(s,cid);
  while(q.length){const u=q.pop();sz++;for(const {to} of adj.get(u)||[])if(!comp.has(to)){comp.set(to,cid);q.push(to);}}sizes.push(sz);cid++;}
const giant=sizes.indexOf(Math.max(...sizes));
const gNodes=[...adj.keys()].filter(id=>comp.get(id)===giant).map(id=>nodes.get(id));
export function nearest(lat,lon){let best=null,bd=1e18;for(const n of gNodes){const d=(n.lat-lat)**2+(n.lon-lon)**2;if(d<bd){bd=d;best=n;}}return best;}
function dijkstra(src,dst){const dist=new Map(),prev=new Map(),vis=new Set();dist.set(src,0);const pq=[[0,src]];
  while(pq.length){pq.sort((a,b)=>a[0]-b[0]);const [d,u]=pq.shift();if(vis.has(u))continue;vis.add(u);if(u===dst)break;
    for(const {to,w} of adj.get(u)||[]){if(vis.has(to))continue;const nd=d+w;if(nd<(dist.get(to)??1e18)){dist.set(to,nd);prev.set(to,u);pq.push([nd,to]);}}}
  if(src!==dst&&!prev.has(dst))return null;const path=[dst];let c=dst;while(c!==src){c=prev.get(c);if(c===undefined)return null;path.push(c);}path.reverse();
  let len=0;for(let i=0;i+1<path.length;i++)len+=hav(nodes.get(path[i]),nodes.get(path[i+1]));return {path,len};}
export function routeThrough(wps){const snapped=wps.map(w=>({...w,node:nearest(w.lat,w.lon)}));
  let full=[],total=0,ok=true,legs=[];
  for(let i=0;i+1<snapped.length;i++){const r=dijkstra(snapped[i].node.id,snapped[i+1].node.id);
    if(!r){ok=false;continue;}total+=r.len;legs.push({from:snapped[i].name,to:snapped[i+1].name,km:+(r.len/1000).toFixed(2)});
    if(i>0)r.path.shift();full.push(...r.path);}
  const coords=full.map(id=>{const n=nodes.get(id);return [+n.lon.toFixed(6),+n.lat.toFixed(6)];});
  return {coords,total,ok,legs,snapped};}
