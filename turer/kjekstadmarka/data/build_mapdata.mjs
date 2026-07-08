import fs from 'fs';
import {nodes,hav,routeThrough} from './lib.mjs';
const data=JSON.parse(fs.readFileSync('osm.json','utf8'));
const els=data.elements;
const wayById=new Map(); for(const e of els) if(e.type==='way') wayById.set(e.id,e);

const V={name:'Verkensvannet',lat:59.8066,lon:10.3677};
const P={
  jernverk:{name:'Dikemark Jernverk',lat:59.8046,lon:10.3717},
  heggedalsbonn:{name:'Heggedalsbonn',lat:59.7910,lon:10.3825},
  smavannsbu:{name:'Småvannsbu',lat:59.7862,lon:10.3763},
  blafjell:{name:'Blåfjell',lat:59.7787,lon:10.3884},
  storvom:{name:'Storvomåsen',lat:59.7736,lon:10.3836},
  bertelsmyr:{name:'Bertelsmyråsen',lat:59.7783,lon:10.3577},
  torsbraatan:{name:'Torsbråtan',lat:59.7864,lon:10.3583},
  stinalokka:{name:'Stinaløkka',lat:59.7973,lon:10.3737},
};
const R1=[V,P.jernverk,P.heggedalsbonn,P.blafjell,P.storvom,P.smavannsbu,P.stinalokka,V];
const R2=[V,P.jernverk,P.smavannsbu,P.bertelsmyr,P.torsbraatan,P.stinalokka,V];
const r1=routeThrough(R1), r2=routeThrough(R2);

// water polygons (closed ways natural=water) within bbox
const BB=[59.766,10.290,59.847,10.446];
const inBB=(la,lo)=>la>=BB[0]&&la<=BB[2]&&lo>=BB[1]&&lo<=BB[3];
const lakes=[];
for(const e of els){
  if(e.type!=='way'||!e.tags||e.tags.natural!=='water')continue;
  if(e.nodes.length<4||e.nodes[0]!==e.nodes[e.nodes.length-1])continue;
  const ring=e.nodes.map(id=>nodes.get(id)).filter(Boolean);
  if(ring.length<4)continue;
  const cx=ring.reduce((s,n)=>s+n.lon,0)/ring.length, cy=ring.reduce((s,n)=>s+n.lat,0)/ring.length;
  if(!inBB(cy,cx))continue;
  // area filter (drop tiny)
  let a=0; for(let i=0;i<ring.length-1;i++)a+=ring[i].lon*ring[i+1].lat-ring[i+1].lon*ring[i].lat;
  a=Math.abs(a)/2;
  if(a<2e-7)continue;
  lakes.push({name:e.tags.name||'',coords:ring.map(n=>[+n.lon.toFixed(6),+n.lat.toFixed(6)]),salt:false});
}
lakes.sort((a,b)=>b.coords.length-a.coords.length);

// streams (waterway)
const streams=[];
for(const e of els){
  if(e.type!=='way'||!e.tags||!/stream|river/.test(e.tags.waterway||''))continue;
  const pts=e.nodes.map(id=>nodes.get(id)).filter(Boolean);
  if(pts.length<2)continue;
  const cy=pts[0].lat,cx=pts[0].lon; if(!inBB(cy,cx))continue;
  streams.push(pts.map(n=>[+n.lon.toFixed(6),+n.lat.toFixed(6)]));
}

// point features
const feats={charcoal:[],works:[],shieling:[],croft:[],peak:[],hut:[],ruins:[]};
for(const e of els){
  const t=e.tags||{}; let lat=e.lat,lon=e.lon;
  if(e.type==='way'){const pts=e.nodes.map(id=>nodes.get(id)).filter(Boolean);if(!pts.length)continue;
    lat=pts.reduce((s,n)=>s+n.lat,0)/pts.length;lon=pts.reduce((s,n)=>s+n.lon,0)/pts.length;}
  if(lat==null||!inBB(lat,lon))continue;
  const nm=t.name||'';
  if(t.historic==='charcoal_pile') feats.charcoal.push({name:nm,lat,lon,to:t.to||'',operator:t.operator||'',note:t['note:no']||'',ruin:t.ruin||''});
  else if(t.historic==='works') feats.works.push({name:nm,lat,lon});
  else if(t.historic==='shieling') feats.shieling.push({name:nm,lat,lon});
  else if(t.historic==='croft') feats.croft.push({name:nm,lat,lon});
  else if(t.historic==='ruins') feats.ruins.push({name:nm||'Ruin',lat,lon});
  else if(t.natural==='peak'&&nm) feats.peak.push({name:nm,ele:t.ele?Math.round(+t.ele):null,lat,lon});
  else if(t.tourism==='wilderness_hut'||t.tourism==='alpine_hut') feats.hut.push({name:nm,lat,lon});
}

// distance from point to route polyline (approx, meters)
function distToRoute(lat,lon,coords){
  let best=1e18;
  for(let i=0;i<coords.length;i++){
    const d=hav({lat,lon},{lat:coords[i][1],lon:coords[i][0]});
    if(d<best)best=d;
  }
  return best;
}
function nearRoute(coords,buf){
  const res={charcoal:[],works:[],shieling:[],croft:[],peak:[],hut:[],ruins:[]};
  for(const k of Object.keys(feats)){
    for(const f of feats[k]){
      const d=distToRoute(f.lat,f.lon,coords);
      if(d<=buf) res[k].push({...f,d:Math.round(d)});
    }
  }
  for(const k of Object.keys(res)) res[k].sort((a,b)=>a.d-b.d);
  return res;
}
const out={
  bbox:BB, start:V,
  route1:{name:'Kullmilerunden',km:+(r1.total/1000).toFixed(1),coords:r1.coords,legs:r1.legs,
    near:nearRoute(r1.coords,200)},
  route2:{name:'Vestrunden',km:+(r2.total/1000).toFixed(1),coords:r2.coords,legs:r2.legs,
    near:nearRoute(r2.coords,200)},
  lakes:lakes.slice(0,80), streams, feats,
};
fs.writeFileSync('mapdata.json',JSON.stringify(out));
console.log('routes:',out.route1.km,'km /',out.route2.km,'km');
console.log('lakes:',lakes.length,'streams:',streams.length);
console.log('feats:',Object.fromEntries(Object.entries(feats).map(([k,v])=>[k,v.length])));
console.log('\nR1 kulturminner ≤200m: charcoal',out.route1.near.charcoal.length,
  'works',out.route1.near.works.map(x=>x.name),'shieling/croft',
  [...out.route1.near.shieling,...out.route1.near.croft].map(x=>x.name),
  'peaks',out.route1.near.peak.map(x=>x.name),'huts',out.route1.near.hut.map(x=>x.name));
console.log('R2 kulturminner ≤200m: charcoal',out.route2.near.charcoal.length,
  'works',out.route2.near.works.map(x=>x.name),'shieling/croft',
  [...out.route2.near.shieling,...out.route2.near.croft].map(x=>x.name),
  'peaks',out.route2.near.peak.map(x=>x.name),'huts',out.route2.near.hut.map(x=>x.name));
